interface Props {
  items: string[];
  max?: number;
}

export default function EvidenceChips({ items, max = 6 }: Props) {
  if (!items.length) return null;
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span
        style={{
          fontSize: 11,
          color: 'var(--gt-text-muted)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginRight: 2,
        }}
      >
        Evidence
      </span>
      {shown.map((chip, i) => (
        <span
          key={`${chip}-${i}`}
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.34)',
            border: '1px solid var(--gt-border)',
            color: 'var(--gt-text-secondary)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {chip}
        </span>
      ))}
      {extra > 0 && (
        <span style={{ fontSize: 11, color: 'var(--gt-text-muted)' }}>+{extra}</span>
      )}
    </div>
  );
}
