import type { Plan, SessionState } from '../types';
import { AGENT_LABELS, type AgentId } from '../types';

interface Props {
  state: SessionState | null;
  plans: Plan[];
  onApprove: (planId: string) => void;
  onReject: (planId: string) => void;
  loading: boolean;
}

export default function ResultPanel({ state, plans, onApprove, onReject, loading }: Props) {
  const isComplete = state?.status === 'complete';
  const isDone = state?.status === 'approved' || state?.status === 'rejected';

  const alivePlans = plans.filter((p) =>
    state?.alive_plan_ids?.includes(p.id),
  );

  return (
    <aside style={{ width: 260, flexShrink: 0, borderLeft: '1px solid #334155', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Result</h2>

      {!state || state.status === 'idle' ? (
        <p style={{ color: '#475569', fontSize: 13 }}>Ask a question to start the debate.</p>
      ) : isDone ? (
        <div>
          <span style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            background: state.status === 'approved' ? '#166534' : '#7f1d1d',
            color: state.status === 'approved' ? '#86efac' : '#fca5a5',
          }}>
            {state.status === 'approved' ? 'Approved' : 'Rejected'}
          </span>
        </div>
      ) : (
        <>
          {alivePlans.map((plan) => (
            <div key={plan.id} style={{ border: '1px solid #334155', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>{AGENT_LABELS[plan.agent_id as AgentId] ?? plan.agent_id}</p>
              <p style={{ margin: 0, fontSize: 13, color: '#e2e8f0' }}>{plan.content}</p>

              {plan.logic_plan?.computed_runway && (
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  <div>Runway: {plan.logic_plan.computed_runway.actual_projected_months}mo</div>
                  {plan.logic_plan.computed_runway.cash_zero_date && (
                    <div>Cash-zero: {plan.logic_plan.computed_runway.cash_zero_date}</div>
                  )}
                </div>
              )}

              {plan.actions?.length > 0 && (
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {plan.actions.length} action(s): {plan.actions.map((a) => a.type).join(', ')}
                </div>
              )}

              {isComplete && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    disabled={loading}
                    onClick={() => onApprove(plan.id)}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', background: '#166534', color: '#86efac', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13 }}
                  >
                    Approve
                  </button>
                  <button
                    disabled={loading}
                    onClick={() => onReject(plan.id)}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', background: '#7f1d1d', color: '#fca5a5', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13 }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}

          {alivePlans.length === 0 && (
            <p style={{ color: '#475569', fontSize: 13 }}>Debate in progress…</p>
          )}
        </>
      )}
    </aside>
  );
}
