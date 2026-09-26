/**
 * tui/telemetry_session.ts — Run-scope helpers for TUI-driven pipeline actions.
 *
 * The TUI is long-lived: each action joins the active telemetry run when one
 * exists (e.g. `/run` chaining plan → build → debug → report), otherwise it
 * owns a new run for its project. Only the owner completes, flushes, and
 * clears the run — joiners emit stage events but leave lifecycle to the owner.
 * Everything no-ops safely when telemetry is disabled (no TIGER_DATABASE_URL).
 */

import {
  clearRun,
  emitRunCompleted,
  emitRunStarted,
  eventPipeline,
  getActiveRun,
} from '../telemetry/index.js';

/** Terminal statuses a TUI action may close its run with. */
export type TuiRunCompletion = 'completed' | 'rejected_gate1' | 'rejected_gate2' | 'failed';

export interface TuiRunScope {
  owned: boolean;
  runId: string;
}

/** Join the active run, or start a new one for this project. Never throws. */
export function beginTuiRun(
  projectName: string,
  opts: { smokeOnly?: boolean } = {},
): TuiRunScope {
  try {
    const active = getActiveRun();
    if (active) return { owned: false, runId: active.runId };
    const runId = emitRunStarted({
      projectName,
      smokeOnly: opts.smokeOnly,
    });
    return { owned: true, runId };
  } catch {
    return { owned: false, runId: 'untracked-run' };
  }
}

/**
 * Complete the run when owned: emit completion, flush queued events, and
 * clear the active run so the next action starts fresh. No-op for joiners.
 */
export async function endTuiRun(
  scope: TuiRunScope,
  status: TuiRunCompletion,
  error?: string,
): Promise<void> {
  if (!scope.owned) return;
  try {
    emitRunCompleted({ status, runId: scope.runId, error });
    await eventPipeline.flush();
  } finally {
    clearRun();
  }
}
