/**
 * tui/execution_view.ts — Mid-execution terminal view for Braid.
 * Pitch-black traditional-terminal aesthetic (OpenCode-style):
 * monospace, thin 1px borders, sparse functional color only.
 *
 *   green      additions / success / completed checks
 *   red        deletions
 *   amber      in-progress / modified
 *   blue-gray  informational (file reads)
 *   white      primary text · gray pending · dim done
 *
 * Pure render functions only: no fs, no LLM, no orchestration.
 * Width-safe: every line fits `cols` via fitLine/displayWidth.
 */
import { C } from './theme.js';
import { displayWidth, fitLine, padTo } from './layout.js';
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  type PipelineMap,
  type StageStatus,
} from './pipeline_status.js';

export type ActivityKind = 'read' | 'create' | 'edit';

export interface ActivityEvent {
  kind: ActivityKind;
  /** Repo-relative path, e.g. auth/session.ts */
  path: string;
  /** Optional trailing note, e.g. "token refresh" */
  detail?: string;
  /** Lines added (create/edit). */
  added?: number;
  /** Lines removed (edit). */
  removed?: number;
  /** Source lines for reads (informational). */
  loc?: number;
  /** HH:MM:SS timestamp label. Defaults to now. */
  ts?: string;
}

export type TaskStatus = 'done' | 'active' | 'todo';

export interface TaskItem {
  label: string;
  status: TaskStatus;
}

export function nowTs(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const ICON: Record<ActivityKind, string> = {
  read: '◎',
  create: '⊞',
  edit: '✎',
};

function activityColor(kind: ActivityKind): string {
  switch (kind) {
    case 'read': return C.blueGray;
    case 'create': return C.green;
    case 'edit': return C.amber;
  }
}

function activityVerb(kind: ActivityKind): string {
  switch (kind) {
    case 'read': return 'Reading';
    case 'create': return 'Creating';
    case 'edit': return 'Editing';
  }
}

/** Right-edge diff fragment: `+42 −6` / `+86 −0` / `128 loc`. */
export function formatDiffStats(e: ActivityEvent): string {
  if (e.kind === 'read') {
    const loc = e.loc ?? 0;
    return `${C.faint}${loc} loc${C.reset}`;
  }
  const added = e.added ?? 0;
  const removed = e.removed ?? 0;
  return `${C.green}+${added}${C.reset} ${C.red}−${removed}${C.reset}`;
}

/** Plain (no-ANSI) diff fragment for headless/CI logs. */
export function formatDiffStatsPlain(e: ActivityEvent): string {
  if (e.kind === 'read') return `${e.loc ?? 0} loc`;
  return `+${e.added ?? 0} -${e.removed ?? 0}`;
}

/**
 * Small pill badge shown only while the model reasons between actions
 * (not during file writes). Understated: thin border, pulsing dot.
 */
export function renderThinkingBadge(thinking: boolean): string | null {
  if (!thinking) return null;
  return `${C.faint}◉${C.reset} ${C.muted}Thinking…${C.reset}`;
}

/** One activity row: `ts icon Verb path — detail   +42 −6`. */
export function renderActivityRow(e: ActivityEvent, cols: number): string {
  const color = activityColor(e.kind);
  const ts = e.ts ?? nowTs();
  const left =
    `${C.faint}${ts}${C.reset} ` +
    `${color}${ICON[e.kind]}${C.reset} ` +
    `${color}${activityVerb(e.kind)} ${e.path}` +
    (e.detail ? ` — ${e.detail}` : '') +
    `${C.reset}`;
  const right = formatDiffStats(e);
  const gap = Math.max(2, cols - displayWidth(left) - displayWidth(right));
  return fitLine(`${left}${' '.repeat(gap)}${right}`, Math.max(20, cols));
}

/** Plain-text variant for `cli.ts run` (colors optional via ANSI codes). */
export function formatActivityPlain(e: ActivityEvent): string {
  const verb = activityVerb(e.kind);
  const detail = e.detail ? ` — ${e.detail}` : '';
  return `${ICON[e.kind]} ${verb} ${e.path}${detail}  ${formatDiffStatsPlain(e)}`;
}

/**
 * Running feed, terminal-log style, top to bottom. Keeps the last N rows
 * that fit `maxRows`.
 */
export function renderActivityFeed(
  events: ActivityEvent[],
  cols: number,
  maxRows = 12,
): string[] {
  return events.slice(-Math.max(1, maxRows)).map((e) => renderActivityRow(e, cols));
}

/** Cumulative totals across the whole execution so far. */
export function summarizeTotals(events: ActivityEvent[]): {
  files: number;
  added: number;
  removed: number;
} {
  const files = new Set(events.map((e) => e.path)).size;
  let added = 0;
  let removed = 0;
  for (const e of events) {
    added += e.added ?? 0;
    removed += e.removed ?? 0;
  }
  return { files, added, removed };
}

/**
 * Compact running total bar in a thin bordered strip:
 * `TOTAL  18 files changed   +512 −87`
 */
export function renderTotalBar(
  events: ActivityEvent[],
  cols: number,
  override?: { files: number; added: number; removed: number },
): string {
  const t = override ?? summarizeTotals(events);
  const left = `${C.faint}TOTAL${C.reset}  ${C.muted}${t.files} files changed${C.reset}`;
  const right = `${C.green}+${t.added}${C.reset} ${C.red}−${t.removed}${C.reset}`;
  const inner = Math.max(20, cols - 4);
  const gap = Math.max(2, inner - displayWidth(left) - displayWidth(right));
  const line = `${left}${' '.repeat(gap)}${right}`;
  return fitLine(`─ ${padTo(line, inner)} ─`, Math.max(20, cols));
}

/**
 * Minimal terminal checklist. Single line per item with reserved
 * checkbox space: ✓ green + dim (done) · ◐ amber + white (active) ·
 * ○ gray outline + mid-gray (todo).
 */
export function renderChecklist(tasks: TaskItem[], cols: number): string[] {
  return tasks.map((t) => {
    if (t.status === 'done') {
      return fitLine(
        `${C.green}✓${C.reset} ${C.faint}${t.label}${C.reset}`,
        Math.max(10, cols),
      );
    }
    if (t.status === 'active') {
      return fitLine(
        `${C.amber}◐${C.reset} ${C.text}${C.bold}${t.label}${C.reset}`,
        Math.max(10, cols),
      );
    }
    return fitLine(`${C.faint}○${C.reset} ${C.muted}${t.label}${C.reset}`, Math.max(10, cols));
  });
}

/** Done/total counter for the checklist header. */
export function checklistProgress(tasks: TaskItem[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length };
}

function stageGlyph(status: StageStatus): { glyph: string; color: string } {
  switch (status) {
    case 'completed': return { glyph: '●', color: C.pipelineDone };
    case 'running': return { glyph: '●', color: C.pipelineDone };
    case 'awaiting-approval': return { glyph: '◐', color: C.amber };
    case 'failed': return { glyph: '✕', color: C.red };
    default: return { glyph: '○', color: C.pipelineDim };
  }
}

/**
 * Pipeline stage indicator in the reference-chat style on pure black:
 * gray labels, green filled dot for done/running, hollow dim pending,
 * amber awaiting, red failed.
 * PRD is presentational-only and hidden here (Plan → … → Report).
 */
export function renderExecutionPipeline(p: PipelineMap, cols: number): string {
  const stages = PIPELINE_STAGES.filter((s) => s !== 'prd');
  const sep = `${C.pipelineDim} → ${C.reset}`;
  const parts = stages.map((s) => {
    const { glyph, color } = stageGlyph(p[s]);
    const active = p[s] === 'running' || p[s] === 'awaiting-approval';
    const name = active
      ? `${C.body}${C.bold}${STAGE_LABELS[s]}${C.reset}`
      : p[s] === 'completed'
        ? `${C.pipelineGray}${STAGE_LABELS[s]}${C.reset}`
        : `${C.pipelineDim}${STAGE_LABELS[s]}${C.reset}`;
    return `${name} ${color}${glyph}${C.reset}`;
  });
  return fitLine(parts.join(sep), Math.max(20, cols));
}

/**
 * Bottom command input in its muted/disabled running state plus the
 * small gray note underneath: pipeline input returns after Execute.
 */
export function renderDisabledInput(cols: number): string[] {
  const placeholder = 'Type a message or / for commands...';
  const bar = fitLine(`❯ ${placeholder}`, Math.max(10, cols - 4));
  const note = `${C.faint}Pipeline running — input available after Execute.${C.reset}`;
  return [bar, fitLine(note, Math.max(10, cols))];
}

/** Default task list for an Execute run (`total` = manifest size). */
export function defaultExecuteTasks(total: number, doneFiles: number): TaskItem[] {
  return [
    { label: 'Generate file manifest', status: 'done' },
    { label: `Skeleton pass — ${total} files`, status: total > 0 ? 'done' : 'active' },
    {
      label: `Implementation pass — file ${Math.min(doneFiles + 1, Math.max(total, 1))} of ${total}`,
      status: 'active',
    },
    { label: 'Run smoke tests', status: 'todo' },
    { label: 'Run regression tests', status: 'todo' },
    { label: 'Generate report', status: 'todo' },
  ];
}
