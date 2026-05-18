import type { EvidenceItem, LogicStep, Plan } from '../types';
import { AGENT_LABELS } from '../types';
import { AGENT_COLOR } from './AdvisorMessageCard';

interface Props {
  plans: Plan[];
}

function byCreatedAt(a: Plan, b: Plan): number {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function confidenceLabel(confidence: number): string {
  if (!Number.isFinite(confidence)) return '—';
  return `${Math.round(confidence * 100)}%`;
}

function evidenceLabel(item: EvidenceItem): string {
  return item.source?.trim() || item.id;
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--gt-border)',
        background: 'rgba(255, 255, 255, 0.34)',
        boxShadow: 'var(--gt-inset-highlight)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: 'var(--gt-text-primary)',
            fontSize: 13,
            lineHeight: 1.45,
            wordBreak: 'break-word',
          }}
        >
          {evidenceLabel(item)}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--gt-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {item.id}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {item.stale && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--gt-warning)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '3px 7px',
              borderRadius: 999,
              border: '1px solid rgba(200, 138, 50, 0.34)',
              background: 'rgba(200, 138, 50, 0.12)',
            }}
          >
            Stale
          </span>
        )}
        <span
          style={{
            minWidth: 48,
            textAlign: 'right',
            fontSize: 12,
            fontWeight: 650,
            color: 'var(--gt-text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {confidenceLabel(item.confidence)}
        </span>
      </div>
    </div>
  );
}

function ClaimBlock({ step, index }: { step: LogicStep; index: number }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: '1px solid var(--gt-border)',
            background: 'rgba(255, 255, 255, 0.34)',
            color: 'var(--gt-text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {index + 1}
        </span>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--gt-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 3,
            }}
          >
            Claim
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--gt-text-primary)' }}>
            {step.claim}
          </p>
        </div>
      </div>

      {step.evidence.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 32 }}>
          {step.evidence.map((item) => (
            <EvidenceRow key={`${item.id}-${item.source ?? ''}`} item={item} />
          ))}
        </div>
      ) : (
        <p style={{ margin: '0 0 0 32px', fontSize: 12, color: 'var(--gt-text-muted)' }}>
          No cited evidence for this claim.
        </p>
      )}
    </section>
  );
}

function PlanEvidenceCard({ plan }: { plan: Plan }) {
  const steps = plan.logic_plan?.steps ?? [];
  const citedCount = steps.reduce((count, step) => count + step.evidence.length, 0);
  const color = AGENT_COLOR[plan.agent_id];

  return (
    <article
      style={{
        background: 'var(--gt-glass-card)',
        border: '1px solid var(--gt-border)',
        borderRadius: 14,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: 'var(--gt-soft-shadow), var(--gt-inset-highlight)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <header style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: `${color}1A`,
            border: `2px solid ${color}`,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {AGENT_LABELS[plan.agent_id].split(' ').map((word) => word[0]).join('').slice(0, 2)}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--gt-text-primary)' }}>
              {AGENT_LABELS[plan.agent_id]}
            </span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--gt-text-muted)',
                border: '1px solid var(--gt-border)',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.38)',
                padding: '2px 8px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {citedCount} cited {citedCount === 1 ? 'source' : 'sources'}
            </span>
          </div>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--gt-text-secondary)', lineHeight: 1.5 }}>
            {plan.content}
          </p>
        </div>
      </header>

      {steps.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {steps.map((step, index) => (
            <ClaimBlock key={`${plan.id}-${index}`} step={step} index={index} />
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--gt-text-muted)' }}>
          No cited logic steps attached to this plan yet.
        </p>
      )}
    </article>
  );
}

export default function EvidenceWorkspace({ plans }: Props) {
  const sortedPlans = [...plans].sort(byCreatedAt);
  const totalClaims = sortedPlans.reduce((count, plan) => count + (plan.logic_plan?.steps.length ?? 0), 0);
  const totalEvidence = sortedPlans.reduce(
    (count, plan) =>
      count + (plan.logic_plan?.steps ?? []).reduce((stepCount, step) => stepCount + step.evidence.length, 0),
    0,
  );

  if (!sortedPlans.length) {
    return (
      <div
        style={{
          margin: '40px auto',
          maxWidth: 520,
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
          Evidence will appear once the advisors publish their first plans.
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--gt-text-muted)' }}>
          This view collects the sources cited inside each debate claim.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 14px',
          borderRadius: 12,
          border: '1px solid var(--gt-border)',
          background: 'rgba(255, 255, 255, 0.34)',
          boxShadow: 'var(--gt-inset-highlight)',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--gt-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 3,
            }}
          >
            Debate Evidence
          </div>
          <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--gt-text-primary)' }}>
            Sources cited across advisor plans
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--gt-text-secondary)',
              border: '1px solid var(--gt-border)',
              background: 'rgba(255, 255, 255, 0.44)',
              borderRadius: 999,
              padding: '3px 9px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {sortedPlans.length} plans
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--gt-text-secondary)',
              border: '1px solid var(--gt-border)',
              background: 'rgba(255, 255, 255, 0.44)',
              borderRadius: 999,
              padding: '3px 9px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {totalClaims} claims
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--gt-text-secondary)',
              border: '1px solid var(--gt-border)',
              background: 'rgba(255, 255, 255, 0.44)',
              borderRadius: 999,
              padding: '3px 9px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {totalEvidence} citations
          </span>
        </div>
      </section>

      {sortedPlans.map((plan) => (
        <PlanEvidenceCard key={plan.id} plan={plan} />
      ))}
    </div>
  );
}
