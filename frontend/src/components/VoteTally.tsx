import type { Plan, SessionState } from '../types';
import { AGENTS, AGENT_LABELS } from '../types';
import { AGENT_COLOR } from './AdvisorMessageCard';

interface Props {
  state: SessionState | null;
  plans: Plan[];
}

export default function VoteTally({ state, plans }: Props) {
  if (!state || state.status === 'idle' || state.status === 'round1') return null;

  const approvals = state.approvals ?? {};
  // Sum votes per agent (each agent owns one plan; their plan accumulates votes).
  const byAgent = AGENTS.map((agentId) => {
    const plan = plans.find((p) => p.agent_id === agentId);
    const votes = plan ? approvals[plan.id] ?? 0 : 0;
    return { agentId, plan, votes };
  });

  const maxVotes = Math.max(1, ...byAgent.map((b) => b.votes));
  const totalRounds = state.status === 'round2' ? 2 : 3;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--gt-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Vote Tally
        </span>
        <span style={{ fontSize: 11, color: 'var(--gt-text-muted)' }}>Through Round {totalRounds}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {byAgent.map(({ agentId, plan, votes }) => {
          const color = AGENT_COLOR[agentId];
          const eliminated = plan?.eliminated_at_round != null;
          return (
            <div
              key={agentId}
              style={{
                display: 'grid',
                gridTemplateColumns: '14px 1fr 28px',
                alignItems: 'center',
                gap: 8,
                opacity: eliminated ? 0.6 : 1,
              }}
            >
              <span
                style={{ width: 10, height: 10, borderRadius: '50%', background: color, justifySelf: 'center' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--gt-text-primary)', fontWeight: 500 }}>
                  {AGENT_LABELS[agentId]}
                </span>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'rgba(148, 163, 184, 0.2)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(votes / maxVotes) * 100}%`,
                      height: '100%',
                      background: color,
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--gt-text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: 'right',
                }}
              >
                {votes}
              </span>
            </div>
          );
        })}
      </div>

      {state.status === 'complete' && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--gt-text-secondary)', fontStyle: 'italic' }}>
          You decide.
        </p>
      )}
    </section>
  );
}
