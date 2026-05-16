export const tokens = {
  bg: '#f6f4ef',
  ink: '#14131a',
  ink2: '#5a5763',
  ink3: '#9b97a3',
  ink4: '#d0ccd5',
  line: 'rgba(20, 19, 26, 0.06)',
  line2: 'rgba(20, 19, 26, 0.10)',
  c1: '#7e57f5',
  accent: '#7e57f5',
  accentSoft: 'rgba(126, 87, 245, 0.10)',
  accentSoft2: 'rgba(126, 87, 245, 0.18)',
} as const;

export type AuroraTokens = typeof tokens;
