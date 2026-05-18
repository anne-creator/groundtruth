import type { Plan, SessionState } from '../types';
import {
  extractKeyFacts,
  formatUSD,
  formatMonths,
  formatShortDate,
  daysUntil,
} from '../lib/context';

interface Props {
  state: SessionState | null;
  plans: Plan[];
}

// Scenario-level constants. Schema doesn't carry these yet — see Stage 6 of the plan.
const GOAL = 'Survive this cycle and raise from strength, not desperation.';
const CONSTRAINTS = ['Do not hit cash zero', 'Maintain momentum if possible'];
const DATA_SOURCE = 'Financial model v3 · Updated 2h ago';

function Row({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string | null;
  tone?: 'warn' | 'muted';
  icon?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 0',
        borderBottom: '1px solid var(--gt-border-subtle)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {icon && (
          <span style={{ color: 'var(--gt-text-muted)', display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--gt-text-secondary)', fontWeight: 500 }}>{label}</span>
      </span>
      <span
        style={{
          fontSize: 13,
          color: tone === 'warn' ? 'var(--gt-reject)' : tone === 'muted' ? 'var(--gt-text-muted)' : 'var(--gt-text-primary)',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

const ICON_PROPS = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const IconCash = (
  <svg {...ICON_PROPS}>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
);
const IconFlame = (
  <svg {...ICON_PROPS}>
    <path d="M8.5 14.5A2.5 2.5 0 0011 17c1.38 0 2.5-1 2.5-2.5 0-.61-.19-1.24-.5-1.8-1.4-2.4-3.5-3.6-3.5-6.7C9.5 4 11 2 12 2c1 4 6 5 6 11a6 6 0 11-12 0c0-1.32.5-2.5 1-3.5.5 1.5 1.5 3 1.5 5z" />
  </svg>
);
const IconAlert = (
  <svg {...ICON_PROPS}>
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IconClock = (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);
const IconCalendar = (
  <svg {...ICON_PROPS}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const IconFlag = (
  <svg {...ICON_PROPS}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h3
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--gt-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function DecisionContextPanel({ state, plans }: Props) {
  const facts = extractKeyFacts(state?.neo4j_context ?? null);

  // Prefer the live computed_runway from the first plan once available;
  // otherwise fall back to the baseline cash/burn derivation so the panel
  // is populated *before* the debate starts.
  const liveRunway = plans[0]?.logic_plan?.computed_runway?.actual_projected_months;
  const runway =
    typeof liveRunway === 'number'
      ? liveRunway
      : facts.baselineRunwayMonths;

  const isRunwayLow = runway !== null && runway < 4;

  const demoDays = facts.demoDate ? daysUntil(facts.demoDate.date) : null;
  const fundraiseDays = facts.fundraiseExpiry ? daysUntil(facts.fundraiseExpiry.date) : null;

  return (
    <aside
      style={{
        width: 300,
        flexShrink: 0,
        borderRight: '1px solid var(--gt-border-subtle)',
        background: 'var(--gt-panel)',
        padding: '16px 16px 20px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: 'var(--gt-inset-highlight)',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--gt-text-primary)',
          letterSpacing: '-0.01em',
        }}
      >
        Decision Context
      </h2>

      <Section title="Current Situation">
        <div>
          <Row
            icon={IconCash}
            label="Cash on hand"
            value={facts.cashOnHand ? formatUSD(facts.cashOnHand.amount_usd) : null}
          />
          <Row
            icon={IconFlame}
            label="Monthly burn"
            value={facts.monthlyBurn ? `${formatUSD(facts.monthlyBurn.monthly_usd)}/mo` : null}
          />
          {facts.threat && (
            <Row
              icon={IconAlert}
              label="Threat"
              value={`${facts.threat.label.split(' ').slice(0, 4).join(' ')}… on ${formatShortDate(facts.threat.date)}`}
              tone="warn"
            />
          )}
          <Row
            icon={IconClock}
            label="Runway"
            value={runway !== null ? `~${formatMonths(runway)}` : null}
            tone={isRunwayLow ? 'warn' : undefined}
          />
          {facts.demoDate && (
            <Row
              icon={IconCalendar}
              label={facts.demoDate.name}
              value={`${formatShortDate(facts.demoDate.date)}${demoDays !== null && demoDays >= 0 ? ` · ${demoDays}d` : ''}`}
            />
          )}
          {facts.fundraiseExpiry && (
            <Row
              icon={IconFlag}
              label="Fundraise close"
              value={`${formatShortDate(facts.fundraiseExpiry.date)}${fundraiseDays !== null && fundraiseDays >= 0 ? ` · ${fundraiseDays}d` : ''}`}
            />
          )}
        </div>
      </Section>

      <Section title="Goal">
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.36)',
            border: '1px solid var(--gt-border)',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--gt-text-primary)',
            boxShadow: 'var(--gt-inset-highlight)',
          }}
        >
          {GOAL}
        </div>
      </Section>

      <Section title="Constraints">
        <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--gt-text-primary)', fontSize: 13, lineHeight: 1.6 }}>
          {CONSTRAINTS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Section>

      <Section title="Decision Question">
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.36)',
            border: '1px solid var(--gt-border)',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--gt-text-primary)',
            fontStyle: state?.query ? 'normal' : 'italic',
            boxShadow: 'var(--gt-inset-highlight)',
          }}
        >
          {state?.query ?? 'Ask a question to start the council.'}
        </div>
      </Section>

      <Section title="Data Source">
        <p style={{ margin: 0, fontSize: 12, color: 'var(--gt-text-muted)' }}>{DATA_SOURCE}</p>
      </Section>
    </aside>
  );
}
