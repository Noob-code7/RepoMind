/**
 * brand/theme.ts
 * Official Braid brand tokens and color palette.
 *
 * Visual Language:
 * - Minimal, sophisticated, calm, technical restraint.
 * - Near-black / charcoal background.
 * - Warm off-white / ivory primary mark.
 * - Subtle warm peach accent.
 * - Strictly NO neon blue, purple gradients, or 3D chrome.
 */

export const BRAID_COLORS = {
  // Backgrounds
  bgDark: '#0d0d0e',
  bgSurface: '#141416',
  bgElevated: '#1a1a1d',
  bgSubtle: '#222226',

  // Borders & Dividers
  borderSubtle: 'rgba(255, 255, 255, 0.07)',
  borderMedium: 'rgba(255, 255, 255, 0.14)',
  borderAccent: 'rgba(240, 157, 121, 0.3)',

  // Primary Typography & Marks (Ivory / Off-White)
  textPrimary: '#f5f4ef',
  textSecondary: '#a5a39d',
  textMuted: '#686661',
  textFaint: '#3f3e3b',

  // Accent (Warm Peach — used with extreme restraint)
  accentPeach: '#f09d79',
  accentPeachMuted: '#b87556',
  accentPeachFaint: 'rgba(240, 157, 121, 0.12)',

  // Semantic Status Tones (Restrained, Natural)
  successSage: '#79b88f',
  warningOchre: '#dfa657',
  errorTerracotta: '#d96c5c',
  infoStone: '#8f9296',
} as const;

export const BRAID_TYPOGRAPHY = {
  fontSans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontMono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
} as const;

export type BraidColorName = keyof typeof BRAID_COLORS;
