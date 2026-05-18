import type { EventLogEntry } from '../types';
import FormattedProse from './FormattedProse';

interface Props {
  round: number;
  entries: EventLogEntry[];
}

const KIND_TINT: Record<string, { dot: string; bg: string }> = {
  consensus: { dot: '#3E8F5A', bg: '#EAF5EE' },
  eliminated: { dot: '#C94B3F', bg: '#FBEEEC' },
  system: { dot: '#B78B55', bg: '#FFF7E8' },
};

export default function RoundResultCard({ round, entries }: Props) {
  if (!entries.length) return null;

  return (
    <div
      style={{
        background: '#FFF7E8',
        border: '1px dashed #E7D8C4',
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
          color: '#9A8772',
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
              style={{ fontSize: 13, color: '#2A2118', lineHeight: 1.5 }}
            />
          </div>
        );
      })}
    </div>
  );
}
