/**
 * tui/pipeline_status.ts — Pipeline progress model for the TUI.
 * Pure presentation state: PRD → Plan → Review → Approval → Execute → Debug → Report.
 * Each stage: pending | running | completed | failed | awaiting-approval.
 * The TUI updates this as it invokes existing pipeline modules; the
 * orchestrator itself is untouched. PRD is presentational only
 * (completed when a PRD buffer/file is present).
 */

export type StageStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting-approval';

export const PIPELINE_STAGES = [
  'prd',
  'plan',
  'review',
  'approval',
  'execute',
  'debug',
  'report',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  prd: 'PRD',
  plan: 'Plan',
  review: 'Review',
  approval: 'Approval',
  execute: 'Execute',
  debug: 'Debug',
  report: 'Report',
};

export type PipelineMap = Record<PipelineStage, StageStatus>;

export function initialPipeline(): PipelineMap {
  return {
    prd: 'pending',
    plan: 'pending',
    review: 'pending',
    approval: 'pending',
    execute: 'pending',
    debug: 'pending',
    report: 'pending',
  };
}

const GLYPH: Record<StageStatus, string> = {
  pending: '○',
  running: '●',
  completed: '✓',
  failed: '✕',
  'awaiting-approval': '◐',
};

/** Compact one-line pipeline bar, e.g. `Plan ● → Review ◌ → …`. */
export function formatPipelineBar(p: PipelineMap): string {
  return PIPELINE_STAGES.map((s) => `${STAGE_LABELS[s]} ${GLYPH[p[s]]}`).join(' → ');
}

/** Overall pipeline state for the status bar. */
export function pipelineSummary(p: PipelineMap): string {
  if (Object.values(p).some((s) => s === 'failed')) return 'failed';
  if (Object.values(p).some((s) => s === 'awaiting-approval')) return 'awaiting approval';
  if (Object.values(p).some((s) => s === 'running')) return 'running';
  if (Object.values(p).every((s) => s === 'completed')) return 'done';
  if (Object.values(p).every((s) => s === 'pending')) return 'idle';
  return 'in progress';
}

export interface ExecuteProgress {
  activeFile: string;
  completedFiles: number;
  totalFiles: number;
  stage: string;
}

/** `file 2/8 · src/index.ts` style progress fragment. */
export function formatExecuteProgress(p: ExecuteProgress): string {
  const base =
    p.totalFiles > 0
      ? `file ${p.completedFiles}/${p.totalFiles}`
      : 'starting';
  const active = p.activeFile ? ` · ${p.activeFile}` : '';
  return `${p.stage} · ${base}${active}`;
}

/** True when no stage has started — home empty-state owns the pipeline. */
export function isPipelineIdle(p: PipelineMap): boolean {
  return Object.values(p).every((s) => s === 'pending');
}

/** Active (running or awaiting-approval) stage, if any. */
export function activeStage(p: PipelineMap): PipelineStage | null {
  for (const s of PIPELINE_STAGES) {
    if (p[s] === 'running' || p[s] === 'awaiting-approval') return s;
  }
  return null;
}

/** Detail line shown ONLY for the active stage (or explicit selection). */
export function activeStageDetail(
  p: PipelineMap,
  extra?: string,
): string | null {
  const stage = activeStage(p);
  if (!stage) return null;
  const status = p[stage];
  const base =
    status === 'awaiting-approval'
      ? `${STAGE_LABELS[stage]} — awaiting approval`
      : `${STAGE_LABELS[stage]} — running`;
  return extra ? `${base} · ${extra}` : base;
}
