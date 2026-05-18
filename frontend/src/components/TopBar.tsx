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
  { id: 'evidence', label: 'Evidence', enabled: false },
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
    rtStatus === 'connected' ? '#4E9F65' : rtStatus === 'error' ? '#C94B3F' : '#9A8772';
  const liveLabel =
    rtStatus === 'connected' ? 'Live' : rtStatus === 'error' ? 'Offline' : 'Connecting';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '10px 20px',
        borderBottom: '1px solid #E7D8C4',
        background: '#FFFDF8',
        flexShrink: 0,
        minHeight: 56,
      }}
    >
      {/* Left: logo + name + live pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/groundtruth-logo-icon.svg" alt="" width={30} height={30} />
        <span style={{ fontWeight: 700, fontSize: 17, color: '#2A2118', letterSpacing: '-0.01em' }}>
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
            background: '#FFF7E8',
            border: `1px solid ${liveColor}55`,
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
          background: '#F6EFE3',
          padding: 3,
          borderRadius: 8,
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
                background: active ? '#FFFFFF' : 'transparent',
                color: active ? '#2A2118' : t.enabled ? '#6F5D4C' : '#C9B89D',
                fontWeight: active ? 600 : 500,
                fontSize: 13,
                cursor: t.enabled ? 'pointer' : 'not-allowed',
                boxShadow: active ? '0 1px 2px rgba(42, 33, 24, 0.08)' : 'none',
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
          <span style={{ fontSize: 12, fontWeight: 500, color: '#6F5D4C' }}>
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
                    background: filled ? '#B78B55' : '#EFE3D2',
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
            border: '1px solid #E7D8C4',
            background: running ? '#F6EFE3' : '#FFFFFF',
            color: '#6F5D4C',
            fontSize: 12,
            fontWeight: 600,
            cursor: running ? 'not-allowed' : 'pointer',
          }}
        >
          Reset
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
