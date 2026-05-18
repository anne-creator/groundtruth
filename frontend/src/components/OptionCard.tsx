import type { Plan } from '../types';
import { AGENT_LABELS } from '../types';
import { AGENT_COLOR } from './AdvisorMessageCard';

interface Props {
  plan: Plan;
  label: 'A' | 'B' | 'C';
  canAct: boolean; // Approve/Reject enabled only at status=complete
  loading: boolean;
  onApprove: (planId: string) => void;
  onReject: (planId: string) => void;
}

function firstSentence(s: string, max = 80): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^[^.!?\n]{6,}[.!?]/);
  const sent = m ? m[0] : trimmed.split('\n')[0];
  return sent.length > max ? `${sent.slice(0, max).trim()}…` : sent;
}

function summary(s: string, max = 140): string {
  const after = s.replace(firstSentence(s), '').trim();
  const body = after || s;
  return body.length > max ? `${body.slice(0, max).trim()}…` : body;
}

function deriveRisk(plan: Plan): 'Low–Medium' | 'Medium' | 'Medium–High' {
  const runway = plan.logic_plan?.computed_runway;
  if (runway?.is_breached) return 'Medium–High';
  if (runway && runway.actual_projected_months < 5) return 'Medium';
  return 'Low–Medium';
}

function riskColor(risk: string): string {
  if (risk.includes('High')) return 'var(--gt-reject)';
  if (risk.includes('Low')) return 'var(--gt-approve)';
  return 'var(--gt-warning)';
}

function actionText(action: Plan['actions'][number]): string {
  return action.body || action.annotation || action.title || action.type.replace(/_/g, ' ');
}

export default function OptionCard({ plan, label, canAct, loading, onApprove, onReject }: Props) {
  const color = AGENT_COLOR[plan.agent_id];
  const title = firstSentence(plan.content);
  const summaryText = summary(plan.content);
  const runwayCalc = plan.logic_plan?.computed_runway;
  const runway = runwayCalc?.actual_projected_months;
  const risk = deriveRisk(plan);
  const actions = (plan.actions ?? []).slice(0, 3);

  return (
    <article
      style={{
        background: 'var(--gt-card)',
        border: `1px solid ${color}55`,
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: 'var(--gt-soft-shadow), var(--gt-inset-highlight)',
        position: 'relative',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -8,
          left: 12,
          background: color,
          color: '#FFFFFF',
          fontWeight: 700,
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 999,
        }}
      >
        Option {label}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: 'var(--gt-text-primary)', lineHeight: 1.35 }}>
            {title}
          </h4>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--gt-text-muted)' }}>
            Preferred by {AGENT_LABELS[plan.agent_id]}
          </p>
        </div>
      </div>

      {summaryText && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-secondary)', lineHeight: 1.5 }}>{summaryText}</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Metric label="Runway" value={typeof runway === 'number' ? `~${runway.toFixed(1)}mo` : '—'} />
        <Metric label="Risk" value={risk} tone={riskColor(risk)} />
      </div>

      {actions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--gt-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Key Actions
          </span>
          <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--gt-text-primary)', fontSize: 12, lineHeight: 1.5 }}>
            {actions.map((a, i) => (
              <li key={i}>{actionText(a)}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          disabled={!canAct || loading}
          onClick={() => onApprove(plan.id)}
          style={{
            flex: 1,
            padding: '8px 0',
            borderRadius: 8,
            border: 'none',
            background: canAct ? 'var(--gt-approve)' : 'rgba(141, 141, 152, 0.46)',
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: 13,
            cursor: !canAct || loading ? 'not-allowed' : 'pointer',
          }}
        >
          Approve
        </button>
        <button
          disabled
          title="Modify is coming in a later stage."
          style={{
            flex: 1,
            padding: '8px 0',
            borderRadius: 8,
            border: '1px solid var(--gt-border)',
            background: 'rgba(255, 255, 255, 0.28)',
            color: 'rgba(100, 116, 139, 0.58)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'not-allowed',
          }}
        >
          Modify
        </button>
        <button
          disabled={!canAct || loading}
          onClick={() => onReject(plan.id)}
          style={{
            flex: 1,
            padding: '8px 0',
            borderRadius: 8,
            border: '1px solid var(--gt-border)',
            background: 'rgba(255, 255, 255, 0.42)',
            color: canAct ? 'var(--gt-reject)' : 'rgba(100, 116, 139, 0.58)',
            fontWeight: 600,
            fontSize: 13,
            cursor: !canAct || loading ? 'not-allowed' : 'pointer',
          }}
        >
          Reject
        </button>
      </div>
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.3)',
        border: '1px solid var(--gt-border)',
        borderRadius: 8,
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--gt-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: tone ?? 'var(--gt-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}
