import { useState } from 'react';
import type { AgentId, Plan, Decision } from '../types';
import { AGENT_LABELS } from '../types';

interface Props {
  agentId: AgentId;
  plan: Plan | null;
  decisions: Decision[];
}

const AGENT_COLOR: Record<AgentId, string> = {
  aggressive_ceo: '#ef4444',
  conservative_ceo: '#3b82f6',
  balanced_ceo: '#10b981',
};

export default function AgentCard({ agentId, plan, decisions }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isEliminated = plan?.eliminated_at_round != null;
  const color = AGENT_COLOR[agentId];

  return (
    <div style={{
      border: `1px solid ${isEliminated ? '#334155' : color + '55'}`,
      borderRadius: 10,
      padding: 14,
      background: isEliminated ? '#0f172a' : '#1e293b',
      opacity: isEliminated ? 0.55 : 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      transition: 'opacity 0.3s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>{AGENT_LABELS[agentId]}</span>
        {isEliminated && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#ef4444', border: '1px solid #ef4444', borderRadius: 4, padding: '1px 6px' }}>
            Eliminated R{plan.eliminated_at_round}
          </span>
        )}
      </div>

      {/* Round 1 plan */}
      {plan ? (
        <div>
          <p style={{ margin: 0, fontSize: 13, color: '#e2e8f0', fontStyle: isEliminated ? 'italic' : 'normal', textDecoration: isEliminated ? 'line-through' : 'none' }}>
            {plan.content}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: color, fontWeight: 600 }}>
              {Math.round((plan.confidence ?? 0) * 100)}% confidence
            </span>
            {plan.logic_plan?.computed_runway && (
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                {plan.logic_plan.computed_runway.actual_projected_months}mo runway
                {plan.logic_plan.computed_runway.is_breached && (
                  <span style={{ color: '#ef4444' }}> ⚠</span>
                )}
              </span>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {expanded ? '▲ hide' : '▼ evidence'}
            </button>
          </div>

          {expanded && plan.logic_plan?.steps?.length > 0 && (
            <div style={{ marginTop: 8, borderTop: '1px solid #334155', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {plan.logic_plan.steps.map((step, i) => (
                <div key={i}>
                  <p style={{ margin: 0, fontSize: 12, color: '#cbd5e1' }}>{step.claim}</p>
                  {step.evidence?.map((ev) => (
                    <div key={ev.id} style={{ display: 'flex', gap: 6, marginTop: 2, paddingLeft: 8 }}>
                      <span style={{ fontSize: 11, color: '#475569' }}>{ev.id}</span>
                      <span style={{
                        fontSize: 11,
                        color: ev.stale ? '#f59e0b' : '#94a3b8',
                        border: ev.stale ? '1px solid #f59e0b' : 'none',
                        borderRadius: 3,
                        padding: ev.stale ? '0 4px' : 0,
                      }}>
                        {Math.round((ev.confidence ?? 0) * 100)}%{ev.stale ? ' stale' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>Waiting for session…</p>
      )}

      {/* Votes */}
      {decisions.map((d) => {
        const chosenPlanAgentId = d.chosen_plan_id;
        const held = d.is_own_plan;
        return (
          <div key={d.id} style={{ borderTop: '1px solid #1e293b', paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>R{d.round}</span>
              <span style={{ fontSize: 12, color: held ? color : '#a78bfa' }}>
                {held ? '↩ holds own' : `→ ${AGENT_LABELS[chosenPlanAgentId as AgentId] ?? chosenPlanAgentId}`}
              </span>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{d.reasoning}</p>
          </div>
        );
      })}
    </div>
  );
}
