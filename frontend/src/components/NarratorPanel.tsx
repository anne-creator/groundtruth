import type { EventLogEntry } from '../types';

interface Props {
  events: EventLogEntry[];
}

const KIND_COLOR: Record<string, string> = {
  plan: '#60a5fa',
  vote: '#a78bfa',
  eliminated: '#f87171',
  consensus: '#34d399',
  system: '#94a3b8',
};

export default function NarratorPanel({ events }: Props) {
  return (
    <aside style={{ width: 260, flexShrink: 0, borderRight: '1px solid #334155', padding: '12px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Narrator</h2>
      {events.length === 0 && (
        <p style={{ color: '#475569', fontSize: 13 }}>Waiting for session…</p>
      )}
      {[...events].reverse().map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: KIND_COLOR[e.kind] ?? '#94a3b8', marginTop: 5, flexShrink: 0 }} />
          <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{e.narration}</p>
        </div>
      ))}
    </aside>
  );
}
