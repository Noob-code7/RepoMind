/**
 * tui/layout.ts — Centralized terminal geometry for the Braid TUI.
 * Single source of truth for margins, widths, wrapping and cursor math.
 * Pure functions only (no fs, no LLM, no orchestration) — trivially testable.
 *
 * Every renderer (conversation, pipeline, menus, input, status) must derive
 * its horizontal offsets from `computeLayout()`, never hardcode them, so all
 * content shares one left alignment and no line ever exceeds the terminal
 * width (which would silently break row counting and cursor placement).
 */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip SGR color codes for width accounting. */
export function stripLayoutAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** True for code points that occupy two terminal columns (CJK wide/full). */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Display width of a single character (code point as string). */
export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0; // control chars
  if (cp >= 0x1f300 && cp <= 0x1faff) return 2; // emoji blocks
  if (cp >= 0x2600 && cp <= 0x27bf) return 2; // misc symbols / dingbats
  if (cp >= 0x2b00 && cp <= 0x2bff) return 2;
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0; // ZWJ / VS
  if (isWide(cp)) return 2;
  return 1;
}

/** Visible terminal width of a string (ANSI-safe, tab expands to 2). */
export function displayWidth(s: string): number {
  const plain = stripLayoutAnsi(s).replace(/\t/g, '  ');
  let w = 0;
  for (const ch of plain) w += charWidth(ch);
  return w;
}

export interface Layout {
  cols: number;
  rows: number;
  /** Shared left margin (3–4 columns, responsive). */
  margin: number;
  /** Right margin mirrors the left. */
  rightMargin: number;
  /** Usable content width between the margins. */
  contentWidth: number;
  /** Input box left edge — identical to the conversation boundary. */
  boxLeft: number;
  /** Input box outer width (border to border). */
  boxWidth: number;
  /** Editable width inside the box (`│ ` … ` │`). */
  innerWidth: number;
}

/**
 * Central layout calculation. All renderers must use this — never hardcode
 * horizontal offsets. Guarantees: margin ≥ 3, nothing touches either edge.
 */
export function computeLayout(cols: number, rows: number): Layout {
  const c = Math.max(40, Math.floor(cols) || 100);
  const r = Math.max(16, Math.floor(rows) || 30);
  const margin = c >= 100 ? 4 : 3;
  const rightMargin = margin;
  const contentWidth = Math.max(20, c - margin - rightMargin);
  const boxLeft = margin;
  const boxWidth = contentWidth;
  const innerWidth = Math.max(10, boxWidth - 4); // "│ " + " │"
  return { cols: c, rows: r, margin, rightMargin, contentWidth, boxLeft, boxWidth, innerWidth };
}

/**
 * Truncate a (possibly styled) string to an exact visible width, appending
 * an ellipsis when truncated. Guarantees `displayWidth(out) <= max`.
 */
export function fitLine(s: string, max: number): string {
  const width = Math.max(1, Math.floor(max));
  if (displayWidth(s) <= width) return s;
  if (width <= 1) return '…';
  const plain = stripLayoutAnsi(s);
  let out = '';
  let w = 0;
  for (const ch of plain) {
    const cw = charWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

/** Pad a (possibly styled) string with spaces to an exact visible width. */
export function padTo(s: string, width: number): string {
  const w = Math.max(0, Math.floor(width));
  const missing = w - displayWidth(s);
  return missing > 0 ? s + ' '.repeat(missing) : s;
}

/**
 * Split logical buffer lines into visual rows of exactly `innerWidth`
 * display columns (last chunk may be shorter). Never splits a wide char or
 * a surrogate pair across rows; empty logical lines yield one empty row.
 */
export function wrapVisual(lines: string[], innerWidth: number): string[] {
  const w = Math.max(10, Math.floor(innerWidth));
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    if (line.length === 0) {
      out.push('');
      continue;
    }
    let cur = '';
    let curW = 0;
    for (const ch of line) {
      const cw = charWidth(ch);
      if (curW + cw > w && cur !== '') {
        out.push(cur);
        cur = '';
        curW = 0;
      }
      // A single char wider than the row still occupies its own row.
      cur += ch;
      curW += cw;
    }
    out.push(cur);
  }
  return out.length > 0 ? out : [''];
}

export interface CursorVisual {
  /** Zero-based visual row of the cursor within the wrapped buffer. */
  visRow: number;
  /** Display-column offset of the cursor within its visual row. */
  visCol: number;
}

/**
 * Map a logical cursor (offset into `buffer`) to visual row/column using
 * display widths. Handles multiline, wrapping, wide chars and emoji.
 */
export function computeCursor(
  buffer: string,
  cursor: number,
  innerWidth: number,
): CursorVisual {
  const w = Math.max(10, Math.floor(innerWidth));
  const safeCursor = Math.max(0, Math.min(cursor, buffer.length));
  const before = buffer.slice(0, safeCursor).replace(/\t/g, '  ');
  const lines = before.split('\n');
  let visRow = 0;
  for (let i = 0; i < lines.length; i++) {
    const rows = wrapVisual([lines[i]!], w);
    if (i < lines.length - 1) {
      visRow += rows.length;
    } else {
      visRow += rows.length - 1;
    }
  }
  const lastLine = lines[lines.length - 1] ?? '';
  const lastRows = wrapVisual([lastLine], w);
  const visCol = displayWidth(lastRows[lastRows.length - 1] ?? '');
  return { visRow, visCol };
}
