import type { Plan, Decision, EventLogEntry, AgentId } from '../types';
import { AGENT_LABELS } from '../types';
import AdvisorMessageCard, { type AdvisorTurn } from './AdvisorMessageCard';
import RoundResultCard from './RoundResultCard';

interface Props {
  plans: Plan[];
  decisions: Decision[];
  events: EventLogEntry[];
}

function byCreatedAt<T extends { created_at: string }>(a: T, b: T): number {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function eliminatedFor(plans: Plan[], agentId: AgentId): number | null {
  const p = plans.find((pl) => pl.agent_id === agentId);
  return p?.eliminated_at_round ?? null;
}

function RoundHeader({ n, label }: { n: number; label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 2px 4px' }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.36)',
          border: '1px solid var(--gt-border)',
          color: 'var(--gt-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {n}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--gt-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Round {n}
        {label ? ` — ${label}` : ''}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--gt-border-subtle)' }} />
    </div>
  );
}

export default function CouncilChat({ plans, decisions, events }: Props) {
  const sortedPlans = [...plans].sort(byCreatedAt);
  const round1 = sortedPlans;
  const round2 = decisions.filter((d) => d.round === 2).sort(byCreatedAt);
  const round3 = decisions.filter((d) => d.round === 3).sort(byCreatedAt);

  const resultEvents = (n: number) =>
    events
      .filter((e) => e.round === n && (e.kind === 'consensus' || e.kind === 'eliminated'))
      .sort(byCreatedAt);

  const empty = !round1.length && !round2.length && !round3.length && !events.length;

  if (empty) {
    return (
      <div
        style={{
          margin: '40px auto',
          maxWidth: 480,
          background: 'rgba(255, 255, 255, 0.34)',
          border: '1px dashed var(--gt-border)',
          borderRadius: 12,
          padding: '20px 24px',
          textAlign: 'center',
          color: 'var(--gt-text-secondary)',
          boxShadow: 'var(--gt-inset-highlight)',
        }}
      >
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          Ask a decision question to start the council.
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--gt-text-muted)' }}>
          The advisors will debate, compare tradeoffs, and generate action-ready options.
        </p>
      </div>
    );
  }

  const planById = new Map(plans.map((p) => [p.id, p]));

  function turnFromDecision(d: Decision): AdvisorTurn {
    const chosenAgent = planById.get(d.chosen_plan_id)?.agent_id;
    const chosenLabel = chosenAgent ? AGENT_LABELS[chosenAgent] : 'a plan';
    return { kind: 'vote', decision: d, chosenLabel };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {round1.length > 0 && (
        <>
          <RoundHeader n={1} label="Initial positions" />
          {round1.map((plan) => (
            <AdvisorMessageCard
              key={plan.id}
              turn={{ kind: 'plan', plan, round: 1 }}
              eliminatedAtRound={plan.eliminated_at_round}
              replyHint={
                round2.length === 0 && round1.length > 1
                  ? 'Voting follows in Round 2'
                  : undefined
              }
            />
          ))}
          <RoundResultCard round={1} entries={resultEvents(1)} />
        </>
      )}

      {round2.length > 0 && (
        <>
          <RoundHeader n={2} label="First vote" />
          {round2.map((d) => (
            <AdvisorMessageCard
              key={d.id}
              turn={turnFromDecision(d)}
              eliminatedAtRound={eliminatedFor(plans, d.agent_id)}
            />
          ))}
          <RoundResultCard round={2} entries={resultEvents(2)} />
        </>
      )}

      {round3.length > 0 && (
        <>
          <RoundHeader n={3} label="Final vote" />
          {round3.map((d) => (
            <AdvisorMessageCard
              key={d.id}
              turn={turnFromDecision(d)}
              eliminatedAtRound={eliminatedFor(plans, d.agent_id)}
            />
          ))}
          <RoundResultCard round={3} entries={resultEvents(3)} />
        </>
      )}
    </div>
  );
}
