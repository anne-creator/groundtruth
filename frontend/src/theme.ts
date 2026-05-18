// Design tokens — "Warm Minimal Paper / AI Council Board"
// Source: ~/Downloads/design (1).md §4 (color), §5 (type), §28 (tailwind tokens).

export const colors = {
  // Surfaces
  bg: '#FBF7EF',
  panel: '#FFFDF8',
  card: '#FFFFFF',
  warmCard: '#FFF7E8',
  mutedSurface: '#F6EFE3',

  // Borders
  border: '#E7D8C4',
  borderSubtle: '#EFE3D2',

  // Text
  textPrimary: '#2A2118',
  textSecondary: '#6F5D4C',
  textMuted: '#9A8772',

  // Status
  approve: '#3E8F5A',
  reject: '#C94B3F',
  warning: '#D9962B',
  info: '#3B73D9',
  live: '#4E9F65',
} as const;

// Agent identity accents — small uses only (avatar rings, dots, option borders, pills)
export const agentColors = {
  aggressive_ceo: '#D85A4A', // Elon
  conservative_ceo: '#3B73D9', // Warren
  balanced_ceo: '#5F9E6E', // Ray
  neutral: '#B78B55', // system / narrator
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
