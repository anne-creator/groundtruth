// Design tokens - cool translucent glass UI.

export const colors = {
  // Surfaces
  bg: '#E3E7EC',
  panel: 'rgba(255, 255, 255, 0.48)',
  panelStrong: 'rgba(255, 255, 255, 0.66)',
  card: 'rgba(255, 255, 255, 0.56)',
  cardStrong: 'rgba(255, 255, 255, 0.74)',
  mutedSurface: 'rgba(255, 255, 255, 0.28)',

  // Borders
  border: 'rgba(255, 255, 255, 0.62)',
  borderSubtle: 'rgba(148, 163, 184, 0.24)',
  borderStrong: 'rgba(255, 255, 255, 0.82)',

  // Text
  textPrimary: '#111827',
  textSecondary: '#475569',
  textMuted: '#64748B',

  // Status
  approve: '#2FA36B',
  reject: '#D85A64',
  warning: '#C88A32',
  info: '#4E7BEF',
  live: '#35A874',
} as const;

// Agent identity accents — small uses only (avatar rings, dots, option borders, pills)
export const agentColors = {
  aggressive_ceo: '#E26A73', // Elon
  conservative_ceo: '#5B82F0', // Warren
  balanced_ceo: '#39A86F', // Ray
  neutral: '#8D8D98', // system / narrator
} as const;

export const glass = {
  blur: 'blur(20px)',
  shadow: '0 18px 42px rgba(15, 23, 42, 0.08), 0 2px 10px rgba(15, 23, 42, 0.05)',
  shadowSoft: '0 10px 24px rgba(15, 23, 42, 0.06), 0 1px 4px rgba(15, 23, 42, 0.04)',
  insetHighlight:
    'inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 1px 0 0 rgba(255, 255, 255, 0.46), inset 0 -1px 0 rgba(148, 163, 184, 0.16)',
} as const;

export const type = {
  pageTitle: { fontSize: 24, fontWeight: 700 },
  sectionTitle: { fontSize: 16, fontWeight: 650 },
  cardTitle: { fontSize: 15, fontWeight: 650 },
  body: { fontSize: 14, fontWeight: 400, lineHeight: 1.55 },
  metadata: { fontSize: 12, fontWeight: 500, lineHeight: 1.3 },
  smallLabel: { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' },
} as const;

export const radius = {
  card: 12,
  panel: 16,
  chip: 6,
  button: 8,
} as const;

export const space = {
  gutter: 16,
  panelPad: 16,
  cardPad: 14,
} as const;
