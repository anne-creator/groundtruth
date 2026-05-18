import type { Plan, SessionState } from '../types';
import { AGENT_LABELS } from '../types';

interface Props {
  state: SessionState | null;
  plans: Plan[];
}

function copyFor(state: SessionState | null, plans: Plan[]): { headline: string; body: string } {
  if (!state || state.status === 'idle') {
    return {
      headline: 'No active question',
      body: 'Ask a decision question to start the council.',
    };
  }
  if (state.status === 'round1') {
    return {
      headline: 'Round 1 in progress',
      body: 'Each advisor is forming an initial position.',
    };
  }
  if (state.status === 'round2') {
    return {
      headline: 'Round 2 in progress',
      body: 'Advisors are voting on each other’s plans.',
    };
  }
  if (state.status === 'round3') {
    return {
      headline: 'Round 3 in progress',
      body: 'Final vote between the surviving plans.',
    };
  }
  if (state.status === 'complete') {
    const alive = state.alive_plan_ids ?? [];
    if (alive.length === 1) {
      const plan = plans.find((p) => p.id === alive[0]);
      const name = plan ? AGENT_LABELS[plan.agent_id] : 'one plan';
      return {
        headline: 'Consensus reached',
        body: `${name}'s plan won the council. Approve to proceed or reject to halt.`,
      };
    }
    return {
      headline: 'No full consensus',
      body: `${alive.length} paths are viable. Tradeoff is speed & momentum vs runway & negotiating strength. You decide.`,
    };
  }
  if (state.status === 'approved') {
    return { headline: 'Plan approved', body: 'Review generated actions before execution.' };
  }
  if (state.status === 'rejected') {
    return { headline: 'Plan rejected', body: 'No execution will run for this decision.' };
  }
  return { headline: '', body: '' };
}

export default function CouncilSummaryCard({ state, plans }: Props) {
  const { headline, body } = copyFor(state, plans);

  return (
    <section
      style={{
        background: 'var(--gt-glass-card)',
        border: '1px solid var(--gt-border)',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
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
          Council Summary
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--gt-neutral-accent)',
            border: '1px solid var(--gt-border)',
            background: 'rgba(255, 255, 255, 0.44)',
            padding: '1px 6px',
            borderRadius: 999,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Pinned
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gt-text-primary)' }}>{headline}</div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-secondary)', lineHeight: 1.5 }}>{body}</p>
    </section>
  );
}
