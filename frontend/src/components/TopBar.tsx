import type { SessionState } from '../types';

type RtStatus = 'connecting' | 'connected' | 'error';
type ViewTab = 'chat' | 'compare' | 'timeline' | 'evidence' | 'actions';

interface Props {
  state: SessionState | null;
  rtStatus: RtStatus;
  running: boolean;
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  onReset: () => void;
}

const TABS: { id: ViewTab; label: string; enabled: boolean }[] = [
  { id: 'chat', label: 'Chat', enabled: true },
  { id: 'compare', label: 'Compare', enabled: false },
  { id: 'timeline', label: 'Timeline', enabled: false },
  { id: 'evidence', label: 'Evidence', enabled: true },
  { id: 'actions', label: 'Actions', enabled: false },
];

function statusToRoundIndex(status: SessionState['status'] | undefined): number {
  switch (status) {
    case 'round1': return 1;
    case 'round2': return 2;
    case 'round3':
    case 'complete':
    case 'approved':
    case 'rejected':
      return 3;
    default: return 0;
  }
}

export default function TopBar({ state, rtStatus, running, activeTab, onTabChange, onReset }: Props) {
  const roundIdx = statusToRoundIndex(state?.status);
  const totalRounds = 3;

  const liveColor =
    rtStatus === 'connected' ? 'var(--gt-live)' : rtStatus === 'error' ? 'var(--gt-reject)' : 'var(--gt-text-muted)';
  const liveLabel =
    rtStatus === 'connected' ? 'Live' : rtStatus === 'error' ? 'Offline' : 'Connecting';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '10px 20px',
        margin: '14px 14px 10px',
        border: '1px solid var(--gt-border)',
        borderRadius: 16,
        background: 'var(--gt-glass-panel)',
        flexShrink: 0,
        minHeight: 56,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: 'var(--gt-glass-shadow), var(--gt-inset-highlight)',
      }}
    >
      {/* Left: logo + name + live pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/groundtruth-logo-icon.svg" alt="" width={30} height={30} />
        <span style={{ fontWeight: 700, fontSize: 17, color: 'var(--gt-text-primary)', letterSpacing: '-0.01em' }}>
          GroundTruth
        </span>
        <span
          title={`realtime: ${rtStatus}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.36)',
            border: '1px solid var(--gt-border)',
            color: liveColor,
            marginLeft: 4,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: liveColor,
              animation: rtStatus === 'connected' ? 'gt-pulse 2s infinite' : 'none',
            }}
          />
          {liveLabel}
        </span>
      </div>

      {/* Center: tabs */}
      <nav
        style={{
          display: 'flex',
          gap: 2,
          margin: '0 auto',
          background: 'rgba(255, 255, 255, 0.28)',
          padding: 3,
          borderRadius: 8,
          border: '1px solid var(--gt-border)',
          boxShadow: 'var(--gt-inset-highlight)',
        }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!t.enabled}
              onClick={() => t.enabled && onTabChange(t.id)}
              title={t.enabled ? undefined : 'Coming soon'}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: active ? 'var(--gt-card-strong)' : 'transparent',
                color: active ? 'var(--gt-text-primary)' : t.enabled ? 'var(--gt-text-secondary)' : 'rgba(100, 116, 139, 0.52)',
                fontWeight: active ? 600 : 500,
                fontSize: 13,
                cursor: t.enabled ? 'pointer' : 'not-allowed',
                boxShadow: active ? 'var(--gt-soft-shadow)' : 'none',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Right: round progress + reset */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--gt-text-secondary)' }}>
            Round {Math.max(1, roundIdx)} of {totalRounds}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: totalRounds }).map((_, i) => {
              const idx = i + 1;
              const filled = idx <= roundIdx;
              const isCurrent = idx === roundIdx && running;
              return (
                <span
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: filled ? 'var(--gt-neutral-accent)' : 'rgba(148, 163, 184, 0.28)',
                    animation: isCurrent ? 'gt-pulse 1.4s infinite' : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={onReset}
          disabled={running}
          title="Wipe plans, decisions, events and set status to idle"
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid var(--gt-border)',
            background: running ? 'var(--gt-muted-surface)' : 'var(--gt-card)',
            color: 'var(--gt-text-secondary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: running ? 'not-allowed' : 'pointer',
          }}
        >
          Reset
        </button>

        <button
          type="button"
          disabled
          title="Settings (coming soon)"
          aria-label="Settings"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: '1px solid var(--gt-border)',
            background: 'var(--gt-card)',
            color: 'var(--gt-text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'not-allowed',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H22a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes gt-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </header>
  );
}

export type { ViewTab };
