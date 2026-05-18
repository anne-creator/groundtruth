import { useCallback, useEffect, useRef, useState } from 'react';
import { insforge, callFn, ensureRealtime } from './lib/insforge';
import type { Plan, Decision, EventLogEntry, SessionState } from './types';
import { AGENTS } from './types';
import MemoryPanel from './components/MemoryPanel';
import TopBar, { type ViewTab } from './components/TopBar';
import DecisionContextPanel from './components/DecisionContextPanel';
import CouncilChat from './components/CouncilChat';
import DecisionPanel from './components/DecisionPanel';

type RtStatus = 'connecting' | 'connected' | 'error';

const CHANNEL = 'groundtruth:session';

export default function App() {
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [callState, setCallState] = useState<'idle' | 'calling' | 'called'>('idle');
  const [smsState, setSmsState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Tracks whether this browser tab initiated the current session.
  // Prevents the SMS auto-orchestration from double-firing when the web UI starts a session.
  const selfInitiated = useRef(false);

  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [rtStatus, setRtStatus] = useState<RtStatus>('connecting');
  const [activeTab, setActiveTab] = useState<ViewTab>('chat');

  const chatScrollRef = useRef<HTMLDivElement>(null);

  // ── DB refresh (source-of-truth backstop) ────────────────────────────────
  // Realtime is best-effort. After each orchestrator phase we re-fetch from
  // DB so the UI stays in sync even if a broadcast was dropped. Merge logic
  // is union-by-id so a refresh racing with an in-flight realtime delivery
  // never duplicates or downgrades rows.
  const refreshFromDb = useCallback(async () => {
    const [stateRes, plansRes, decisionsRes, eventsRes] = await Promise.all([
      insforge.database.from('current_state').select('*').eq('id', 1).maybeSingle(),
      insforge.database.from('plans').select('*'),
      insforge.database.from('decisions').select('*'),
      insforge.database.from('event_log').select('*').order('created_at', { ascending: true }),
    ]);

    if (stateRes.error) console.error('[refresh] current_state', stateRes.error);
    if (plansRes.error) console.error('[refresh] plans', plansRes.error);
    if (decisionsRes.error) console.error('[refresh] decisions', decisionsRes.error);
    if (eventsRes.error) console.error('[refresh] event_log', eventsRes.error);

    if (stateRes.data) {
      const fresh = stateRes.data as SessionState;
      setSessionState((prev) =>
        !prev || new Date(fresh.updated_at) >= new Date(prev.updated_at) ? fresh : prev,
      );
    }
    if (plansRes.data) {
      const fresh = plansRes.data as Plan[];
      setPlans((prev) => {
        const map = new Map(prev.map((p) => [p.id, p]));
        for (const p of fresh) map.set(p.id, p);
        return Array.from(map.values());
      });
    }
    if (decisionsRes.data) {
      const fresh = decisionsRes.data as Decision[];
      setDecisions((prev) => {
        const map = new Map(prev.map((d) => [d.id, d]));
        for (const d of fresh) map.set(d.id, d);
        return Array.from(map.values());
      });
    }
    if (eventsRes.data) {
      const fresh = eventsRes.data as EventLogEntry[];
      setEvents((prev) => {
        const map = new Map(prev.map((ev) => [ev.id, ev]));
        for (const ev of fresh) map.set(ev.id, ev);
        return Array.from(map.values()).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });
    }
  }, []);

  // ── Realtime subscription + initial hydration ─────────────────────────────
  // Notes on StrictMode: connect/subscribe is hoisted to a module-level
  // singleton in lib/insforge.ts so it isn't torn down by the dev double-
  // mount. This effect only owns the per-mount listener registrations.
  useEffect(() => {
    let cancelled = false;

    const onPlan = (e: Plan & { meta?: unknown }) => {
      setPlans((prev) => {
        const exists = prev.some((p) => p.id === e.id);
        return exists ? prev.map((p) => (p.id === e.id ? e : p)) : [...prev, e];
      });
    };
    const onVote = (e: Decision & { meta?: unknown }) => {
      setDecisions((prev) => (prev.some((d) => d.id === e.id) ? prev : [...prev, e]));
    };
    const onEvent = (e: EventLogEntry & { meta?: unknown }) => {
      setEvents((prev) => (prev.some((ev) => ev.id === e.id) ? prev : [...prev, e]));
    };
    const onState = (e: SessionState & { meta?: unknown }) => {
      setSessionState((prev) =>
        !prev || new Date(e.updated_at) >= new Date(prev.updated_at) ? e : prev,
      );
    };

    // Register listeners BEFORE awaiting connect/hydrate so events broadcast
    // during startup aren't dropped. The handlers are stable refs so cleanup
    // can off() exactly the ones this mount registered.
    insforge.realtime.on<Plan & { meta?: unknown }>('plan_posted', onPlan);
    insforge.realtime.on<Decision & { meta?: unknown }>('vote_posted', onVote);
    insforge.realtime.on<EventLogEntry & { meta?: unknown }>('event_logged', onEvent);
    insforge.realtime.on<SessionState & { meta?: unknown }>('state_changed', onState);

    ensureRealtime(CHANNEL)
      .then(async () => {
        if (cancelled) return;
        setRtStatus('connected');
        await refreshFromDb();
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[realtime init]', err);
        setRtStatus('error');
      });

    return () => {
      cancelled = true;
      insforge.realtime.off('plan_posted', onPlan);
      insforge.realtime.off('vote_posted', onVote);
      insforge.realtime.off('event_logged', onEvent);
      insforge.realtime.off('state_changed', onState);
      // Don't disconnect or unsubscribe — the singleton outlives this effect
      // so a StrictMode remount finds the connection still healthy.
    };
  }, []);

  // ── Orchestrator ──────────────────────────────────────────────────────────
  // Runs rounds 1-3 of the debate. Called by both the web UI (via ask()) and
  // automatically when an SMS-triggered session is detected via realtime.
  const runDebate = useCallback(async () => {
    setRunning(true);
    setPlans([]);
    setDecisions([]);
    setEvents([]);
    setError(null);
    setCallState('idle');
    setSmsState('idle');

    try {
      await Promise.all(AGENTS.map((id) => callFn('agent-plan', { agent_id: id })));
      await refreshFromDb();

      await callFn('tally-round', { round: 1 });
      await refreshFromDb();

      await Promise.all(AGENTS.map((id) => callFn('agent-vote', { agent_id: id, round: 2 })));
      await refreshFromDb();

      await callFn('tally-round', { round: 2 });
      await refreshFromDb();

      const stateRes = await insforge.database
        .from('current_state')
        .select('status')
        .eq('id', 1)
        .single();

      if (stateRes.data?.status === 'round3') {
        await Promise.all(AGENTS.map((id) => callFn('agent-vote', { agent_id: id, round: 3 })));
        await refreshFromDb();

        await callFn('tally-round', { round: 3 });
        await refreshFromDb();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }, [refreshFromDb]);

  // Web UI trigger: start a new session then run the debate.
  async function ask(q: string) {
    selfInitiated.current = true;
    setSessionState(null);
    try {
      await callFn('start-session', { query: q });
      await refreshFromDb();
      await runDebate();
    } finally {
      selfInitiated.current = false;
    }
  }

  // Auto-scroll center column to bottom whenever new content arrives. Watching counts
  // (not arrays) keeps the effect from firing on no-op re-renders.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [plans.length, decisions.length, events.length, sessionState?.status]);

  // SMS trigger: when realtime delivers status=round1 and this tab didn't start it,
  // auto-orchestrate the debate so the dashboard shows the live session.
  useEffect(() => {
    if (sessionState?.status === 'round1' && !running && !selfInitiated.current) {
      runDebate();
    }
  }, [sessionState?.status, running, runDebate]);

  // Auto-call + auto-text: when the debate finishes and a caller_phone is on
  // record, place the outbound AgentPhone call AND send an SMS in parallel.
  // The SMS contains the recommendation and instructs the user to reply
  // APPROVE/REJECT — handled by the inbound branch of /agentphone-webhook.
  useEffect(() => {
    if (
      sessionState?.status === 'complete' &&
      sessionState.caller_phone &&
      !running &&
      callState === 'idle'
    ) {
      setCallState('calling');
      callFn('call-user', {})
        .then(() => setCallState('called'))
        .catch((err) => {
          console.error('[call-user]', err);
          setCallState('idle');
        });
    }
  }, [sessionState?.status, sessionState?.caller_phone, running, callState]);

  useEffect(() => {
    if (
      sessionState?.status === 'complete' &&
      sessionState.caller_phone &&
      !running &&
      smsState === 'idle'
    ) {
      setSmsState('sending');
      callFn('text-user', {})
        .then(() => setSmsState('sent'))
        .catch((err) => {
          console.error('[text-user]', err);
          setSmsState('idle');
        });
    }
  }, [sessionState?.status, sessionState?.caller_phone, running, smsState]);

  async function handleReset() {
    if (running) return;
    setError(null);
    try {
      await callFn('reset-session', {});
      setPlans([]);
      setDecisions([]);
      setEvents([]);
      setSessionState(null);
      setCallState('idle');
      setSmsState('idle');
      await refreshFromDb();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    }
  }

  async function handleApprove(planId: string) {
    setActionLoading(true);
    try {
      await callFn('execute-action', { plan_id: planId, decision: 'approved' });
      await refreshFromDb();
    } finally { setActionLoading(false); }
  }

  async function handleReject(planId: string) {
    setActionLoading(true);
    try {
      await callFn('execute-action', { plan_id: planId, decision: 'rejected' });
      await refreshFromDb();
    } finally { setActionLoading(false); }
  }

  const showCallSmsRow =
    running || callState !== 'idle' || smsState !== 'idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#FBF7EF', color: '#2A2118' }}>
      <TopBar
        state={sessionState}
        rtStatus={rtStatus}
        running={running}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onReset={handleReset}
      />

      {(error || showCallSmsRow) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '6px 20px',
            background: '#FFFDF8',
            borderBottom: '1px solid #EFE3D2',
            fontSize: 12,
          }}
        >
          {error && (
            <span
              style={{
                background: '#FFF7E8',
                border: '1px solid #C94B3F',
                color: '#C94B3F',
                padding: '4px 10px',
                borderRadius: 6,
                fontWeight: 500,
              }}
            >
              {error}
            </span>
          )}
          {running && (
            <span style={{ color: '#3B73D9' }}>⟳ running debate…</span>
          )}
          {callState === 'calling' && (
            <span style={{ color: '#B78B55' }}>📞 calling {sessionState?.caller_phone}…</span>
          )}
          {callState === 'called' && (
            <span style={{ color: '#3E8F5A' }}>✓ call placed</span>
          )}
          {smsState === 'sending' && (
            <span style={{ color: '#B78B55' }}>💬 texting {sessionState?.caller_phone}…</span>
          )}
          {smsState === 'sent' && (
            <span style={{ color: '#3E8F5A' }}>✓ text sent</span>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left column — Decision Context */}
        <DecisionContextPanel state={sessionState} plans={plans} />

        {/* Center column — Council Chat + sticky composer */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            background: '#FBF7EF',
          }}
        >
          <div
            ref={chatScrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {sessionState?.query && (
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#2A2118' }}>
                Topic: {sessionState.query}
              </h2>
            )}

            <CouncilChat plans={plans} decisions={decisions} events={events} />
          </div>

          {/* Sticky composer */}
          <div
            style={{
              borderTop: '1px solid #E7D8C4',
              padding: '12px 20px',
              display: 'flex',
              gap: 10,
              background: '#FFFDF8',
              flexShrink: 0,
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && query.trim() && !running) ask(query.trim()); }}
              placeholder="Ask a follow-up question or adjust the scenario…"
              disabled={running}
              style={{
                flex: 1,
                background: '#FFFFFF',
                border: '1px solid #E7D8C4',
                borderRadius: 10,
                padding: '10px 14px',
                color: '#2A2118',
                fontSize: 14,
                outline: 'none',
              }}
            />
            <button
              onClick={() => query.trim() && !running && ask(query.trim())}
              disabled={running || !query.trim()}
              style={{
                padding: '10px 20px',
                borderRadius: 10,
                border: 'none',
                background: running || !query.trim() ? '#C9B89D' : '#B78B55',
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: 14,
                cursor: running || !query.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {running ? '…' : 'Send'}
            </button>
          </div>
        </main>

        {/* Right column — Decision Panel (placeholder: ResultPanel until Stage 5) + Memory drawer */}
        <div style={{ display: 'flex', flexDirection: 'row', flexShrink: 0, alignSelf: 'stretch', minHeight: 0 }}>
          <DecisionPanel
            state={sessionState}
            plans={plans}
            onApprove={handleApprove}
            onReject={handleReject}
            loading={actionLoading}
          />
          <MemoryPanel session={sessionState} />
        </div>
      </div>
    </div>
  );
}
