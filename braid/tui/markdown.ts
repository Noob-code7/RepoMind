/**
 * tui/markdown.ts — Minimal terminal-friendly Markdown renderer.
 * Pure string transform (ANSI only). Handles: fenced code blocks,
 * headings, bold/italic/inline-code, lists, blockquotes, hr.
 * Keeps output readable on narrow terminals via simple word-wrap
 * for prose lines (code blocks are never wrapped).
 * Width accounting is display-width aware (ANSI-safe, wide chars count 2).
 */
import { displayWidth } from './layout.js';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  // Reference-chat tones on pure black: cool gray-blue code,
  // off-white headings, gray structure. Magenta never used here.
  code: '\x1b[38;2;125;133;144m',
  body: '\x1b[38;2;229;231;235m',
  heading: '\x1b[1m\x1b[38;2;229;231;235m',
  quote: '\x1b[38;2;154;160;174m',
};

function inline(text: string): string {
  return (
    text
      // inline code first (protect contents from bold/italic passes)
      .replace(
        /`([^`]+)`/g,
        `${ANSI.code}$1${ANSI.reset}`,
      )
      .replace(/\*\*([^*]+)\*\*/g, `${ANSI.bold}$1${ANSI.reset}`)
      .replace(/__([^_]+)__/g, `${ANSI.bold}$1${ANSI.reset}`)
      .replace(/(^|\W)\*([^*\n]+)\*/g, `$1${ANSI.italic}$2${ANSI.reset}`)
      .replace(/(^|\W)_([^_\n]+)_/g, `$1${ANSI.italic}$2${ANSI.reset}`)
  );
}

function wrap(line: string, width: number): string[] {
  const w = Math.max(10, Math.floor(width));
  if (displayWidth(line) <= w) return [line];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    // A single over-wide word gets its own row (code spans stay intact).
    if (displayWidth(word) > w && cur === '') {
      out.push(word);
      continue;
    }
    const trial = cur ? `${cur} ${word}` : word;
    if (displayWidth(trial) > w && cur) {
      out.push(cur);
      cur = word;
    } else {
      cur = trial;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Render markdown-ish text for the terminal. */
export function renderMarkdown(src: string, width = 100): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      out.push(
        inFence
          ? `${ANSI.dim}┄┄ code ┄┄${ANSI.reset}`
          : `${ANSI.dim}┄┄┄┄┄┄┄┄${ANSI.reset}`,
      );
      continue;
    }
    if (inFence) {
      out.push(`  ${ANSI.code}${raw}${ANSI.reset}`);
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = raw.match(/^(#{1,6})\s+(.*)$/))) {
      const text = inline(m[2]!.trim());
      out.push(`${ANSI.heading}${text}${ANSI.reset}`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      out.push(`${ANSI.dim}${'─'.repeat(Math.min(40, width))}${ANSI.reset}`);
      continue;
    }
    if ((m = raw.match(/^\s*>\s?(.*)$/))) {
      out.push(...wrap(`${ANSI.quote}│${ANSI.reset} ${inline(m[1]!)}`, width));
      continue;
    }
    if ((m = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      const indent = m[1]!;
      const bullet = /^\d/.test(m[2]!) ? `${ANSI.dim}${m[2]}${ANSI.reset}` : `${ANSI.dim}•${ANSI.reset}`;
      out.push(...wrap(`${indent}${bullet} ${inline(m[3]!)}`, width));
      continue;
    }
    if (/^\s*$/.test(raw)) {
      out.push('');
      continue;
    }
    out.push(...wrap(inline(raw), width));
  }
  return out.join('\n');
}

/** Strip ANSI escape codes (for tests / width accounting). */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
