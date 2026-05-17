import { useCallback, useEffect, useRef, useState } from 'react';
import { insforge, callFn, ensureRealtime } from './lib/insforge';
import type { Plan, Decision, EventLogEntry, SessionState, AgentId } from './types';
import { AGENTS } from './types';
import NarratorPanel from './components/NarratorPanel';
import AgentCard from './components/AgentCard';
import ResultPanel from './components/ResultPanel';

type RtStatus = 'connecting' | 'connected' | 'error';

const CHANNEL = 'groundtruth:session';

export default function App() {
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [callState, setCallState] = useState<'idle' | 'calling' | 'called'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Tracks whether this browser tab initiated the current session.
  // Prevents the SMS auto-orchestration from double-firing when the web UI starts a session.
  const selfInitiated = useRef(false);

  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [rtStatus, setRtStatus] = useState<RtStatus>('connecting');

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

  // SMS trigger: when realtime delivers status=round1 and this tab didn't start it,
  // auto-orchestrate the debate so the dashboard shows the live session.
  useEffect(() => {
    if (sessionState?.status === 'round1' && !running && !selfInitiated.current) {
      runDebate();
    }
  }, [sessionState?.status, running, runDebate]);

  // Auto-call: when the debate finishes and a caller_phone is on record, place the
  // outbound AgentPhone call to deliver the recommendation.
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <NarratorPanel events={events} />

        <main style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>GroundTruth</h1>
            {sessionState && sessionState.status !== 'idle' && (
              <span style={{ fontSize: 12, color: '#94a3b8', background: '#1e293b', padding: '2px 10px', borderRadius: 20, border: '1px solid #334155' }}>
                {sessionState.status}
              </span>
            )}
            <span
              title={`realtime: ${rtStatus}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color:
                  rtStatus === 'connected' ? '#34d399' : rtStatus === 'error' ? '#f87171' : '#94a3b8',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    rtStatus === 'connected' ? '#34d399' : rtStatus === 'error' ? '#f87171' : '#94a3b8',
                }}
              />
              {rtStatus === 'connected' ? 'live' : rtStatus === 'error' ? 'realtime error' : 'connecting…'}
            </span>
            {running && <span style={{ fontSize: 12, color: '#60a5fa' }}>⟳ running…</span>}
            {callState === 'calling' && (
              <span style={{ fontSize: 12, color: '#a78bfa', background: '#1e1b4b', padding: '2px 10px', borderRadius: 20, border: '1px solid #4c1d95' }}>
                📞 calling {sessionState?.caller_phone}…
              </span>
            )}
            {callState === 'called' && (
              <span style={{ fontSize: 12, color: '#34d399', background: '#052e16', padding: '2px 10px', borderRadius: 20, border: '1px solid #065f46' }}>
                ✓ call placed
              </span>
            )}
            <button
              onClick={handleReset}
              disabled={running}
              title="Wipe plans, decisions, events and set status to idle"
              style={{
                marginLeft: 'auto',
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #475569',
                background: running ? '#1e293b' : '#334155',
                color: '#f1f5f9',
                fontSize: 12,
                fontWeight: 600,
                cursor: running ? 'not-allowed' : 'pointer',
              }}
            >
              Reset
            </button>
          </div>

          {error && (
            <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 8, padding: 12, fontSize: 13, color: '#fca5a5' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {AGENTS.map((id) => (
              <AgentCard
                key={id}
                agentId={id as AgentId}
                plan={plans.find((p) => p.agent_id === id) ?? null}
                decisions={decisions.filter((d) => d.agent_id === id)}
              />
            ))}
          </div>
        </main>

        <ResultPanel
          state={sessionState}
          plans={plans}
          onApprove={handleApprove}
          onReject={handleReject}
          loading={actionLoading}
        />
      </div>

      <div style={{ borderTop: '1px solid #334155', padding: '12px 20px', display: 'flex', gap: 12, background: '#0f172a' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && query.trim() && !running) ask(query.trim()); }}
          placeholder="What should we do about runway?"
          disabled={running}
          style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#f1f5f9', fontSize: 14, outline: 'none' }}
        />
        <button
          onClick={() => query.trim() && !running && ask(query.trim())}
          disabled={running || !query.trim()}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: running ? '#1e3a5f' : '#2563eb', color: '#fff', fontWeight: 700, fontSize: 14, cursor: running ? 'not-allowed' : 'pointer' }}
        >
          {running ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
