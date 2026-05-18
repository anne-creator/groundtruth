import type { AgentId, Plan, Decision } from '../types';
import { AGENT_LABELS } from '../types';
import FormattedProse from './FormattedProse';
import EvidenceChips from './EvidenceChips';

export const AGENT_COLOR: Record<AgentId, string> = {
  aggressive_ceo: '#D85A4A', // Elon
  conservative_ceo: '#3B73D9', // Warren
  balanced_ceo: '#5F9E6E', // Ray
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
    ? firstSentence(turn.plan.content)
    : `Voted for ${turn.chosenLabel}`;

  const evidenceChips = isPlan ? buildEvidenceChips(turn.plan) : [];

  return (
    <article
      style={{
        background: '#FFFFFF',
        border: '1px solid #EFE3D2',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        gap: 12,
        opacity: isEliminated ? 0.65 : 1,
        boxShadow: '0 1px 2px rgba(42, 33, 24, 0.04)',
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 36,
          height: 36,
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
        {AGENT_LABELS[agentId].split(' ').map((w) => w[0]).join('').slice(0, 2)}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 650, fontSize: 14, color: '#2A2118' }}>
            {AGENT_LABELS[agentId]}
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              background: `${color}1A`,
              border: `1px solid ${color}55`,
              color,
              fontWeight: 600,
            }}
          >
            {positionPill}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9A8772', fontWeight: 600 }}>
            Round {round}
          </span>
        </div>

        {/* Body */}
        <FormattedProse
          text={body}
          style={{
            fontSize: 14,
            color: '#2A2118',
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
              color: '#9A8772',
              borderTop: '1px solid #EFE3D2',
              paddingTop: 8,
              marginTop: 2,
            }}
          >
            ↳ {replyHint}
          </div>
        )}

        {isEliminated && (
          <div style={{ fontSize: 11, color: '#C94B3F', fontWeight: 600 }}>
            Eliminated after Round {eliminatedAtRound}
          </div>
        )}
      </div>
    </article>
  );
}

export type { AdvisorTurn };
