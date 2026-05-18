import type { EventLogEntry } from '../types';
import FormattedProse from './FormattedProse';

interface Props {
  round: number;
  entries: EventLogEntry[];
}

const KIND_TINT: Record<string, { dot: string; bg: string }> = {
  consensus: { dot: '#4F8F72', bg: 'rgba(79, 143, 114, 0.12)' },
  eliminated: { dot: '#B85E57', bg: 'rgba(184, 94, 87, 0.12)' },
  system: { dot: '#8D8D98', bg: 'rgba(255, 255, 255, 0.34)' },
};

export default function RoundResultCard({ round, entries }: Props) {
  if (!entries.length) return null;

  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.34)',
        border: '1px dashed var(--gt-border)',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--gt-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Round {round} result
      </div>
      {entries.map((e) => {
        const tint = KIND_TINT[e.kind] ?? KIND_TINT.system;
        return (
          <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: tint.dot,
                marginTop: 6,
                flexShrink: 0,
              }}
            />
            <FormattedProse
              text={e.narration}
              style={{ fontSize: 13, color: 'var(--gt-text-primary)', lineHeight: 1.5 }}
            />
          </div>
        );
      })}
    </div>
  );
}
