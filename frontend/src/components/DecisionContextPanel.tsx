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

function Row({ label, value, tone }: { label: string; value: string | null; tone?: 'warn' | 'muted' }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 0',
        borderBottom: '1px solid #EFE3D2',
      }}
    >
      <span style={{ fontSize: 12, color: '#6F5D4C', fontWeight: 500 }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: tone === 'warn' ? '#C94B3F' : tone === 'muted' ? '#9A8772' : '#2A2118',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h3
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 600,
          color: '#9A8772',
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
        borderRight: '1px solid #E7D8C4',
        background: '#FFFDF8',
        padding: '16px 16px 20px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 700,
          color: '#2A2118',
          letterSpacing: '-0.01em',
        }}
      >
        Decision Context
      </h2>

      <Section title="Current Situation">
        <div>
          <Row
            label="Cash on hand"
            value={facts.cashOnHand ? formatUSD(facts.cashOnHand.amount_usd) : null}
          />
          <Row
            label="Monthly burn"
            value={facts.monthlyBurn ? `${formatUSD(facts.monthlyBurn.monthly_usd)}/mo` : null}
          />
          {facts.threat && (
            <Row
              label="Threat"
              value={`${facts.threat.label.split(' ').slice(0, 4).join(' ')}… on ${formatShortDate(facts.threat.date)}`}
              tone="warn"
            />
          )}
          <Row
            label="Runway"
            value={runway !== null ? `~${formatMonths(runway)}` : null}
            tone={isRunwayLow ? 'warn' : undefined}
          />
          {facts.demoDate && (
            <Row
              label={facts.demoDate.name}
              value={`${formatShortDate(facts.demoDate.date)}${demoDays !== null && demoDays >= 0 ? ` · ${demoDays}d` : ''}`}
            />
          )}
          {facts.fundraiseExpiry && (
            <Row
              label="Fundraise close"
              value={`${formatShortDate(facts.fundraiseExpiry.date)}${fundraiseDays !== null && fundraiseDays >= 0 ? ` · ${fundraiseDays}d` : ''}`}
            />
          )}
        </div>
      </Section>

      <Section title="Goal">
        <div
          style={{
            background: '#FFF7E8',
            border: '1px solid #E7D8C4',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 13,
            lineHeight: 1.5,
            color: '#2A2118',
          }}
        >
          {GOAL}
        </div>
      </Section>

      <Section title="Constraints">
        <ul style={{ margin: 0, paddingLeft: 16, color: '#2A2118', fontSize: 13, lineHeight: 1.6 }}>
          {CONSTRAINTS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Section>

      <Section title="Decision Question">
        <div
          style={{
            background: '#FFF7E8',
            border: '1px solid #E7D8C4',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 13,
            lineHeight: 1.5,
            color: '#2A2118',
            fontStyle: state?.query ? 'normal' : 'italic',
          }}
        >
          {state?.query ?? 'Ask a question to start the council.'}
        </div>
      </Section>

      <Section title="Data Source">
        <p style={{ margin: 0, fontSize: 12, color: '#9A8772' }}>{DATA_SOURCE}</p>
      </Section>
    </aside>
  );
}
