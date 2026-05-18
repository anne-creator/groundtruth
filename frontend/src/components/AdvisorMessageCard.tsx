import type { AgentId, Plan, Decision } from '../types';
import { AGENT_LABELS } from '../types';
import FormattedProse from './FormattedProse';
import EvidenceChips from './EvidenceChips';

export const AGENT_COLOR: Record<AgentId, string> = {
  aggressive_ceo: '#E26A73', // Elon
  conservative_ceo: '#5B82F0', // Warren
  balanced_ceo: '#39A86F', // Ray
};

type AdvisorTurn =
  | { kind: 'plan'; plan: Plan; round: 1 }
  | { kind: 'vote'; decision: Decision; chosenLabel: string };

interface Props {
  turn: AdvisorTurn;
  eliminatedAtRound: number | null;
  replyHint?: string;
}

function firstSentence(s: string, max = 90): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^[^.!?\n]{6,}[.!?]/);
  const sent = m ? m[0] : trimmed.split('\n')[0];
  return sent.length > max ? `${sent.slice(0, max).trim()}…` : sent;
}

// Position pill needs to stay short enough to sit next to the name on one
// line. The first sentence of a plan is often a full thought ("The math is
// unambiguous: ..."), so we trim down to ~42 chars and cut at a word boundary.
function positionPillText(s: string, max = 42): string {
  const sent = firstSentence(s, 80).replace(/[.!?]+$/, '');
  if (sent.length <= max) return sent;
  const sliced = sent.slice(0, max);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 12 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

function buildEvidenceChips(plan: Plan): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const step of plan.logic_plan?.steps ?? []) {
    for (const ev of step.evidence ?? []) {
      const label = ev.source ?? ev.id;
      if (label && !seen.has(label)) {
        seen.add(label);
        out.push(label);
      }
    }
  }
  return out;
}

export default function AdvisorMessageCard({ turn, eliminatedAtRound, replyHint }: Props) {
  const isPlan = turn.kind === 'plan';
  const agentId = isPlan ? turn.plan.agent_id : turn.decision.agent_id;
  const color = AGENT_COLOR[agentId];
  const round = isPlan ? 1 : turn.decision.round;

  const isEliminated =
    eliminatedAtRound !== null && round > eliminatedAtRound;

  const body = isPlan ? turn.plan.content : turn.decision.reasoning;
  const positionPill = isPlan
    ? positionPillText(turn.plan.content)
    : `Voted for ${turn.chosenLabel}`;

  const evidenceChips = isPlan ? buildEvidenceChips(turn.plan) : [];

  return (
    <article
      style={{
        background: 'var(--gt-glass-card)',
        border: '1px solid var(--gt-border)',
        borderRadius: 14,
        padding: 18,
        display: 'flex',
        gap: 14,
        opacity: isEliminated ? 0.65 : 1,
        boxShadow: 'var(--gt-soft-shadow), var(--gt-inset-highlight)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: `${color}1A`,
          border: `2px solid ${color}`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: '0.02em',
        }}
      >
        {AGENT_LABELS[agentId].split(' ').map((w) => w[0]).join('').slice(0, 2)}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 650, fontSize: 14.5, color: 'var(--gt-text-primary)' }}>
            {AGENT_LABELS[agentId]}
          </span>
          <span
            style={{
              fontSize: 11.5,
              padding: '3px 10px',
              borderRadius: 999,
              background: `${color}14`,
              border: `1px solid ${color}40`,
              color,
              fontWeight: 600,
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {positionPill}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gt-text-muted)', fontWeight: 600, letterSpacing: '0.02em' }}>
            Round {round}
          </span>
        </div>

        {/* Body */}
        <FormattedProse
          text={body}
          style={{
            fontSize: 14,
            color: 'var(--gt-text-primary)',
            lineHeight: 1.55,
          }}
        />

        {/* Evidence */}
        {evidenceChips.length > 0 && <EvidenceChips items={evidenceChips} />}

        {/* Reply hint */}
        {replyHint && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--gt-text-muted)',
              borderTop: '1px solid var(--gt-border-subtle)',
              paddingTop: 8,
              marginTop: 2,
            }}
          >
            ↳ {replyHint}
          </div>
        )}

        {isEliminated && (
          <div style={{ fontSize: 11, color: 'var(--gt-reject)', fontWeight: 600 }}>
            Eliminated after Round {eliminatedAtRound}
          </div>
        )}
      </div>
    </article>
  );
}

export type { AdvisorTurn };
