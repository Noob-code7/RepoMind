/**
 * tui/home.ts — Minimal home / empty-state for the Braid TUI.
 * Pure render functions: header + compact SDLC pipeline + 4 suggestions.
 * No orchestration, no fs. Works in VS Code integrated terminal.
 */
import { C } from './theme.js';
import { fitLine } from './layout.js';
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  type PipelineMap,
  type StageStatus,
} from './pipeline_status.js';

export interface HomeSuggestion {
  key: string;
  label: string;
  hint: string;
  command: string;
}

/** The four concise getting-started options (keyboard-selectable). */
export const HOME_SUGGESTIONS: HomeSuggestion[] = [
  { key: '1', label: 'Create a project from a PRD', hint: '/prd <file>', command: '/prd ' },
  { key: '2', label: 'Generate a development plan', hint: '/plan', command: '/plan' },
  { key: '3', label: 'Review the current architecture', hint: '/review', command: '/review' },
  { key: '4', label: 'Resume the previous session', hint: 'restore', command: '/status' },
];

function glyphFor(status: StageStatus): { glyph: string; color: string } {
  switch (status) {
    case 'completed': return { glyph: '●', color: C.green };
    case 'running': return { glyph: '◉', color: C.accent };
    case 'awaiting-approval': return { glyph: '◈', color: C.amber };
    case 'failed': return { glyph: '✕', color: C.red };
    default: return { glyph: '○', color: C.muted };
  }
}

/**
 * Single compact pipeline line, e.g. `PRD ● → Plan ◉ → Review ○ …`.
 * Muted pending · purple active · green done · amber approval · red failed.
 * Pure + width-safe: truncates stage names on very narrow terminals.
 */
export function renderPipelineLine(p: PipelineMap, cols: number): string {
  const narrow = cols < 72;
  const sep = `${C.faint} → ${C.reset}`;
  const parts = PIPELINE_STAGES.map((stage) => {
    const { glyph, color } = glyphFor(p[stage]);
    const label = narrow
      ? STAGE_LABELS[stage].slice(0, 4)
      : STAGE_LABELS[stage];
    const active = p[stage] === 'running' || p[stage] === 'awaiting-approval';
    const name = active
      ? `${C.reset}${label}${C.reset}`
      : `${C.muted}${label}${C.reset}`;
    return `${name} ${color}${glyph}${C.reset}`;
  });
  return fitLine(parts.join(sep), Math.max(20, cols - 4));
}

/** Minimal lowercase wordmark + understated tagline (compact contexts). */
export function renderHeader(): string {
  return (
    `${C.accentBold}braid${C.reset}` +
    `${C.muted}  ·  Autonomous SDLC Agent${C.reset}`
  );
}

/**
 * Big pixel wordmark for the home hero — chunky block letters with a
 * left-to-right gray→white fade, in the spirit of OpenCode's wordmark
 * (similar vibe, own letterforms). Pure render, terminal-safe (█ only).
 */
const WORDMARK_GLYPHS: Record<string, string[]> = {
  b: [
    '████ ',
    '█   █',
    '█   █',
    '████ ',
    '█   █',
    '█   █',
    '████ ',
  ],
  r: [
    '████ ',
    '█   █',
    '█   █',
    '████ ',
    '█ █  ',
    '█  █ ',
    '█   █',
  ],
  a: [
    ' ███ ',
    '█   █',
    '█   █',
    '█████',
    '█   █',
    '█   █',
    '█   █',
  ],
  i: [
    '█████',
    '  █  ',
    '  █  ',
    '  █  ',
    '  █  ',
    '  █  ',
    '█████',
  ],
  d: [
    '████ ',
    '█   █',
    '█   █',
    '█   █',
    '█   █',
    '█   █',
    '████ ',
  ],
};

/** Per-letter fade shade (256-color gray), dark left → bright right. */
const WORDMARK_SHADES = [240, 244, 248, 251, 255];

export function renderWordmark(): string[] {
  const letters = ['b', 'r', 'a', 'i', 'd'];
  const rows: string[] = [];
  for (let r = 0; r < 7; r++) {
    const parts = letters.map((ch, li) => {
      const shade = WORDMARK_SHADES[li]!;
      const glyph = WORDMARK_GLYPHS[ch]![r]!.replace(/\s+$/, '');
      return `\x1b[38;5;${shade}m${glyph}${C.reset}`;
    });
    rows.push(parts.join('  '));
  }
  return rows;
}

/**
 * Full home empty-state. `selected` highlights one suggestion for
 * keyboard navigation; -1 means no highlight (e.g. user is typing).
 */
export function renderHome(opts: {
  cols: number;
  pipeline: PipelineMap;
  selected?: number;
  showHints?: boolean;
  /** Shared left margin — must match the app layout (default 2). */
  margin?: number;
}): string {
  const { cols, pipeline, selected = 0, showHints = true, margin = 2 } = opts;
  const M = ' '.repeat(Math.max(0, margin));
  const push = (content: string): void => {
    // No home line may exceed the terminal width (would break row counting).
    lines.push(fitLine(M + content, cols));
  };
  const lines: string[] = [];
  lines.push('');
  for (const wl of renderWordmark()) push(wl);
  push(`${C.muted}Autonomous SDLC Agent${C.reset}`);
  lines.push('');
  push(renderPipelineLine(pipeline, cols - margin));
  lines.push('');
  HOME_SUGGESTIONS.forEach((s, i) => {
    const cursor = i === selected ? `${C.accent}›${C.reset}` : ' ';
    const label = i === selected
      ? `${C.text}${s.label}${C.reset}`
      : `${C.muted}${s.label}${C.reset}`;
    const hint = `${C.faint}${s.hint}${C.reset}`;
    push(`${cursor} ${C.faint}${s.key}${C.reset}  ${label}  ${hint}`);
  });
  lines.push('');
  if (showHints && cols >= 60) {
    push(
      `${C.faint}↑↓ navigate · Enter select · Tab mode · / commands${C.reset}`,
    );
  }
  return lines.join('\n');
}

/** True when the TUI should show the home empty-state. */
export function shouldShowHome(messageCount: number): boolean {
  return messageCount === 0;
}
