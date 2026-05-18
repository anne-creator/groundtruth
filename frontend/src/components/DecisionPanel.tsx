import type { Plan, SessionState } from '../types';
import { AGENT_LABELS } from '../types';
import CouncilSummaryCard from './CouncilSummaryCard';
import VoteTally from './VoteTally';
import OptionCard from './OptionCard';

interface Props {
  state: SessionState | null;
  plans: Plan[];
  onApprove: (planId: string) => void;
  onReject: (planId: string) => void;
  loading: boolean;
}

const LABELS: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];

export default function DecisionPanel({ state, plans, onApprove, onReject, loading }: Props) {
  const status = state?.status ?? 'idle';
  const alive = state?.alive_plan_ids ?? [];
  const isTerminal = status === 'approved' || status === 'rejected';
  const isComplete = status === 'complete';

  const alivePlans = alive
    .map((id) => plans.find((p) => p.id === id))
    .filter((p): p is Plan => !!p);

  // After approve/reject, show the approved/rejected plan (the user just acted on the alive set).
  // We surface whichever alive plan got the highest tally, falling back to the first alive plan.
  const terminalPlan = isTerminal
    ? (() => {
        const approvals = state?.approvals ?? {};
        const sorted = [...alivePlans].sort(
          (a, b) => (approvals[b.id] ?? 0) - (approvals[a.id] ?? 0),
        );
        return sorted[0] ?? alivePlans[0] ?? plans[0] ?? null;
      })()
    : null;

  return (
    <aside
      style={{
        width: 380,
        flexShrink: 0,
        borderLeft: '1px solid #E7D8C4',
        background: '#FFFDF8',
        padding: '14px 16px 20px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <CouncilSummaryCard state={state} plans={plans} />

      <VoteTally state={state} plans={plans} />

      {/* Options */}
      {!isTerminal && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#9A8772',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Top Options
            </span>
            {alivePlans.length > 0 && (
              <span style={{ fontSize: 11, color: '#9A8772' }}>{alivePlans.length} viable</span>
            )}
          </div>

          {alivePlans.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#9A8772' }}>
              {status === 'idle'
                ? 'Options will appear once the council debates.'
                : 'Debate in progress…'}
            </p>
          ) : (
            alivePlans.map((plan, i) => (
              <div key={plan.id} style={{ marginTop: i === 0 ? 4 : 0 }}>
                <OptionCard
                  plan={plan}
                  label={LABELS[i] ?? 'C'}
                  canAct={isComplete}
                  loading={loading}
                  onApprove={onApprove}
                  onReject={onReject}
                />
              </div>
            ))
          )}
        </section>
      )}

      {/* Terminal banner */}
      {isTerminal && terminalPlan && (
        <section
          style={{
            background: status === 'approved' ? '#EAF5EE' : '#FBEEEC',
            border: `1px solid ${status === 'approved' ? '#3E8F5A55' : '#C94B3F55'}`,
            borderRadius: 12,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span
            style={{
              alignSelf: 'flex-start',
              fontSize: 11,
              fontWeight: 700,
              color: status === 'approved' ? '#3E8F5A' : '#C94B3F',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {status === 'approved' ? '✓ Approved' : '✕ Rejected'}
          </span>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: '#2A2118' }}>
            {AGENT_LABELS[terminalPlan.agent_id]}'s plan
          </h4>
          <p style={{ margin: 0, fontSize: 13, color: '#2A2118', lineHeight: 1.5 }}>
            {terminalPlan.content.length > 200
              ? `${terminalPlan.content.slice(0, 200).trim()}…`
              : terminalPlan.content}
          </p>
        </section>
      )}
    </aside>
  );
}
