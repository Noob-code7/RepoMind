/**
 * tui/theme.ts — Restrained OpenCode-inspired palette + layout helpers.
 * Pure presentation utilities: no fs, no LLM, no orchestration imports.
 * All colors are foreground-only ANSI (no bright backgrounds) and safe
 * in VS Code's integrated terminal + standalone terminals.
 */

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // Muted purple accent (256-color 140 — soft, not neon).
  accent: '\x1b[38;5;140m',
  accentBold: '\x1b[1m\x1b[38;5;140m',
  // Soft white primary, muted gray secondary.
  text: '\x1b[38;5;252m',
  textBold: '\x1b[1m\x1b[38;5;252m',
  muted: '\x1b[38;5;243m',
  faint: '\x1b[38;5;238m',
  // States: muted green / amber / soft red.
  green: '\x1b[38;5;108m',
  greenBold: '\x1b[1m\x1b[38;5;108m',
  amber: '\x1b[38;5;214m',
  red: '\x1b[38;5;203m',
  redBold: '\x1b[1m\x1b[38;5;203m',
  // App background — painted explicitly so the TUI matches the brand
  // swatch even when the terminal default differs. Truecolor black.
  bg: '\x1b[48;2;0;0;0m',
} as const;

/** Strip ANSI escape codes for width accounting. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function visibleLen(s: string): number {
  return stripAnsi(s).length;
}

/** Truncate to a visible width, preserving a trailing ellipsis. */
export function truncateVisible(s: string, max: number): string {
  const plain = stripAnsi(s);
  if (plain.length <= max) return s;
  if (max <= 1) return '…';
  // Truncate the plain text; callers pass already-styled short strings
  // so re-styling is unnecessary — return plain truncated form.
  return plain.slice(0, max - 1) + '…';
}

/**
 * Compact one-line status fragment: `model · project · mode`.
 * Progressively hides fields on narrow terminals instead of overlapping.
 */
export function statusStrip(opts: {
  cols: number;
  model: string;
  project: string;
  mode: string;
}): string {
  const { cols, model, project, mode } = opts;
  if (cols < 56) return `${C.muted}${model}${C.reset}`;
  if (cols < 80) return `${C.muted}${model} · ${mode}${C.reset}`;
  return `${C.muted}${model} · ${project} · ${mode}${C.reset}`;
}

/** Box-drawing chars for the OpenCode-style bordered input. */
export const BOX = {
  tl: '╭',
  tr: '╮',
  bl: '╰',
  br: '╯',
  h: '─',
  v: '│',
} as const;
