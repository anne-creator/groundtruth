import { useEffect, useRef, useState } from 'react';
import type { EventLogEntry } from '../types';
import FormattedProse from './FormattedProse';

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

const MIN_WIDTH = 200;
const MAX_WIDTH = 640;
const STORAGE_KEY = 'gt:narrator-width';

export default function NarratorPanel({ events }: Props) {
  const [width, setWidth] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed)) : 280;
  });
  const draggingRef = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(next);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.localStorage.setItem(STORAGE_KEY, String(width));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [width]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        borderRight: '1px solid #334155',
        padding: '12px 16px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        position: 'relative',
      }}
    >
      <h2 style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Narrator</h2>
      {events.length === 0 && (
        <p style={{ color: '#475569', fontSize: 13 }}>Waiting for session…</p>
      )}
      {events.map((e) => {
        const dotColor = KIND_COLOR[e.kind] ?? '#94a3b8';
        const badgeBg = `${dotColor}26`;
        return (
          <div
            key={e.id}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              paddingBottom: 8,
              borderBottom: '1px solid #1e293b',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, marginTop: 6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: dotColor,
                    background: badgeBg,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  {e.kind}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: dotColor,
                    background: badgeBg,
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  R{e.round}
                </span>
              </div>
              <FormattedProse
                text={e.narration}
                style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}
              />
            </div>
          </div>
        );
      })}

      <div
        onMouseDown={startDrag}
        title="Drag to resize"
        style={{
          position: 'absolute',
          top: 0,
          right: -3,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 5,
        }}
      />
    </aside>
  );
}
