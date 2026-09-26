/**
 * tui/theme.ts — Reference-chat palette on a pure-black terminal.
 * Pure presentation utilities: no fs, no LLM, no orchestration imports.
 * True-black background (kept pure per user choice), monospace throughout.
 * Chat roles follow the reference screenshot:
 *   user      bright blue name + blue avatar cell, muted mode tag
 *   assistant mint-green name + green avatar cell, tight padded bubble
 * Functional color stays sparse: green success, red deletions,
 * amber in-progress, muted blue-gray informational, white primary.
 * Exception: magenta is reserved for the input mode pill only.
 */

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // No accent branding: active chrome is plain white (traditional terminal).
  accent: '\x1b[38;5;252m',
  accentBold: '\x1b[1m\x1b[38;5;252m',
  // Soft white primary, muted gray secondary.
  text: '\x1b[38;5;252m',
  textBold: '\x1b[1m\x1b[38;5;252m',
  // Reference-chat body text (off-white) and muted tones.
  body: '\x1b[38;2;229;231;235m',
  muted: '\x1b[38;5;243m',
  faint: '\x1b[38;5;238m',
  // Roles (reference screenshot).
  userBlue: '\x1b[38;2;74;156;255m',
  userBlueBold: '\x1b[1m\x1b[38;2;74;156;255m',
  assistantGreen: '\x1b[38;2;74;222;128m',
  assistantGreenBold: '\x1b[1m\x1b[38;2;74;222;128m',
  // Avatar cells: solid bg + white glyph (terminal-safe, no logos).
  avatarUserBg: '\x1b[48;2;47;128;237m',
  avatarAssistantBg: '\x1b[48;2;34;197;94m',
  avatarFg: '\x1b[38;2;255;255;255m',
  // Tight padded assistant bubble (slate fill on pure-black bg).
  bubbleBg: '\x1b[48;2;34;40;52m',
  // Input chrome: slate border + magenta mode pill + gray placeholder.
  inputBorder: '\x1b[38;2;58;65;80m',
  modeMagenta: '\x1b[38;2;232;121;249m',
  modeMagentaBold: '\x1b[1m\x1b[38;2;232;121;249m',
  placeholder: '\x1b[38;2;125;133;144m',
  footerDim: '\x1b[38;2;91;98;112m',
  // Pipeline: gray labels, green done dot, dim arrows.
  pipelineGray: '\x1b[38;2;154;160;174m',
  pipelineDim: '\x1b[38;2;91;98;112m',
  pipelineDone: '\x1b[38;2;52;211;153m',
  // States: muted green / amber / soft red.
  green: '\x1b[38;5;108m',
  greenBold: '\x1b[1m\x1b[38;5;108m',
  amber: '\x1b[38;5;214m',
  red: '\x1b[38;5;203m',
  redBold: '\x1b[1m\x1b[38;5;203m',
  // Informational: muted blue-gray (file reads, hints). Not a brand color.
  blueGray: '\x1b[38;5;103m',
  // App background — pure black per user choice (painted explicitly so
  // the TUI matches even when the terminal default differs).
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
  if (cols < 56) return `${C.placeholder}${model}${C.reset}`;
  if (cols < 80) return `${C.placeholder}${model} · ${mode}${C.reset}`;
  return `${C.placeholder}${model} · ${project} · ${mode}${C.reset}`;
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
