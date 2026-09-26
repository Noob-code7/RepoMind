/**
 * telemetry/telemetry_hooks.ts — Lightweight lifecycle telemetry emitter helpers.
 * Wires into Braid's real lifecycle points (CLI, Executor, Debugger, Reporter, Gate).
 * Guarantees consistent runId / cycleId propagation and non-blocking emission.
 * Telemetry NEVER throws and NEVER logs sensitive code or credentials.
 */

import { randomUUID } from 'node:crypto';
import { eventPipeline } from './event_pipeline.js';
import { tigerClient } from './tiger_client.js';
import type { RunRecord, TelemetryEvent, TelemetryEventType, TelemetrySeverity, TelemetryStage } from './types.js';

export interface ActiveRunContext {
  runId: string;
  projectName: string;
  cycleId: number;
  startedAt: number;
}

let activeRun: ActiveRunContext | null = null;
const testListeners: Array<(event: TelemetryEvent) => void> = [];
const testEventsBuffer: TelemetryEvent[] = [];

/**
 * Serialize sdlc_runs upserts per run so rapid sequences (e.g. run_started
 * immediately followed by run_completed) cannot land out of order and leave
 * a stale status behind. Still fire-and-forget: callers never block.
 */
const runUpsertTails = new Map<string, Promise<void>>();
function upsertRunSerialized(run: RunRecord): void {
  const prev = runUpsertTails.get(run.runId) ?? Promise.resolve();
  const next: Promise<void> = prev
    .then(() => tigerClient.upsertRun(run))
    .then(
      () => undefined,
      () => undefined,
    );
  runUpsertTails.set(run.runId, next);
  void next.then(() => {
    if (runUpsertTails.get(run.runId) === next) runUpsertTails.delete(run.runId);
  });
}

/** Register a test listener or record buffer for testing without a database */
export function addTelemetryListener(fn: (event: TelemetryEvent) => void): () => void {
  testListeners.push(fn);
  return () => {
    const idx = testListeners.indexOf(fn);
    if (idx >= 0) testListeners.splice(idx, 1);
  };
}

export function getEmittedEventsForTest(): TelemetryEvent[] {
  return [...testEventsBuffer];
}

export function clearEmittedEventsForTest(): void {
  testEventsBuffer.length = 0;
}

export function initRun(projectName: string, customRunId?: string): string {
  const runId = customRunId || `run_${Date.now()}_${randomUUID().slice(0, 8)}`;
  activeRun = {
    runId,
    projectName,
    cycleId: 0,
    startedAt: Date.now(),
  };
  return runId;
}

export function getActiveRun(): ActiveRunContext | null {
  return activeRun ? { ...activeRun } : null;
}

export function setCycleId(cycleId: number): void {
  if (activeRun) {
    activeRun.cycleId = cycleId;
  }
}

export function clearRun(): void {
  activeRun = null;
}

function safeEmit(
  stage: TelemetryStage,
  eventType: TelemetryEventType,
  opts: {
    runId?: string;
    cycleId?: number;
    severity?: TelemetrySeverity;
    modelUsed?: string;
    durationMs?: number;
    payload?: Record<string, unknown>;
  } = {},
): void {
  try {
    const runId = opts.runId || activeRun?.runId || 'untracked-run';
    const cycleId = opts.cycleId ?? activeRun?.cycleId ?? 0;

    const event: TelemetryEvent = {
      time: new Date(),
      eventId: randomUUID(),
      runId,
      cycleId,
      stage,
      eventType,
      severity: opts.severity || 'info',
      modelUsed: opts.modelUsed,
      durationMs: opts.durationMs,
      payload: opts.payload || {},
    };

    // Store in test buffer if tests are observing
    testEventsBuffer.push(event);
    for (const listener of testListeners) {
      try {
        listener(event);
      } catch {
        /* ignore listener errors */
      }
    }

    eventPipeline.emit(event);
  } catch {
    // Fail silently: telemetry must never interrupt execution
  }
}

// ----------------------------------------------------------------------------
// Run Lifecycle
// ----------------------------------------------------------------------------

export function emitRunStarted(args: {
  projectName: string;
  runId?: string;
  prdPath?: string;
  mock?: boolean;
  smokeOnly?: boolean;
  autoApprove?: boolean;
}): string {
  const runId = args.runId || activeRun?.runId || initRun(args.projectName, args.runId);
  safeEmit('run', 'run_started', {
    runId,
    payload: {
      projectName: args.projectName,
      prdPath: args.prdPath,
      mock: Boolean(args.mock),
      smokeOnly: Boolean(args.smokeOnly),
      autoApprove: Boolean(args.autoApprove),
    },
  });

  if (tigerClient.isEnabled) {
    upsertRunSerialized({
      runId,
      projectName: args.projectName,
      startedAt: new Date(activeRun?.startedAt || Date.now()),
      status: 'running',
      prdPath: args.prdPath,
      metadata: { mock: args.mock, smokeOnly: args.smokeOnly },
    });
  }

  return runId;
}

export function emitRunCompleted(args: {
  status: 'completed' | 'rejected_gate1' | 'rejected_gate2' | 'failed';
  runId?: string;
  cycleId?: number;
  durationMs?: number;
  error?: string;
}): void {
  const durationMs =
    args.durationMs ?? (activeRun ? Date.now() - activeRun.startedAt : undefined);

  safeEmit('run', 'run_completed', {
    runId: args.runId,
    cycleId: args.cycleId,
    severity: args.status === 'failed' ? 'error' : 'info',
    durationMs,
    payload: {
      status: args.status,
      error: args.error,
    },
  });

  if (tigerClient.isEnabled) {
    const runId = args.runId || activeRun?.runId || 'untracked-run';
    const projectName = activeRun?.projectName || 'unknown';
    upsertRunSerialized({
      runId,
      projectName,
      startedAt: new Date(activeRun?.startedAt || Date.now()),
      completedAt: new Date(),
      status: args.status,
      metadata: { error: args.error, durationMs },
    });
  }
}

// ----------------------------------------------------------------------------
// Generic Stage Transitions
// ----------------------------------------------------------------------------

export function emitStageStarted(
  stage: TelemetryStage,
  args?: {
    modelUsed?: string;
    runId?: string;
    cycleId?: number;
    payload?: Record<string, unknown>;
  },
): void {
  safeEmit(stage, 'stage_started', {
    runId: args?.runId,
    cycleId: args?.cycleId,
    modelUsed: args?.modelUsed,
    payload: args?.payload,
  });
}

export function emitStageCompleted(
  stage: TelemetryStage,
  args?: {
    durationMs?: number;
    modelUsed?: string;
    runId?: string;
    cycleId?: number;
    payload?: Record<string, unknown>;
    severity?: TelemetrySeverity;
  },
): void {
  safeEmit(stage, 'stage_completed', {
    runId: args?.runId,
    cycleId: args?.cycleId,
    durationMs: args?.durationMs,
    modelUsed: args?.modelUsed,
    severity: args?.severity,
    payload: args?.payload,
  });

  if (tigerClient.isEnabled) {
    const runId = args?.runId || activeRun?.runId || 'untracked-run';
    const cycleId = args?.cycleId ?? activeRun?.cycleId ?? 0;
    void tigerClient.insertStageMetric({
      time: new Date(),
      runId,
      cycleId,
      stage,
      durationMs: args?.durationMs || 0,
      modelUsed: args?.modelUsed,
      filesPlanned: typeof args?.payload?.['plannedCount'] === 'number' ? (args.payload['plannedCount'] as number) : undefined,
      filesGenerated: typeof args?.payload?.['implementedCount'] === 'number' ? (args.payload['implementedCount'] as number) : undefined,
      testsPassed: typeof args?.payload?.['totalPassed'] === 'number' ? (args.payload['totalPassed'] as number) : undefined,
      testsFailed: typeof args?.payload?.['totalFailed'] === 'number' ? (args.payload['totalFailed'] as number) : undefined,
      repairAttempts: typeof args?.payload?.['repairAttempts'] === 'number' ? (args.payload['repairAttempts'] as number) : undefined,
    }).catch(() => {});
  }
}

// ----------------------------------------------------------------------------
// Human Gate Events
// ----------------------------------------------------------------------------

export function emitHumanGateDecision(args: {
  gate: 1 | 2;
  gateName: 'gate_review' | 'gate_report';
  approved: boolean;
  hasFeedback?: boolean;
  feedbackLength?: number;
  autoApproved?: boolean;
  runId?: string;
  cycleId?: number;
}): void {
  safeEmit('human_gate', 'human_gate_decision', {
    runId: args.runId,
    cycleId: args.cycleId,
    severity: args.approved ? 'info' : 'warn',
    payload: {
      gate: args.gate,
      gateName: args.gateName,
      approved: args.approved,
      hasFeedback: Boolean(args.hasFeedback),
      feedbackLength: args.feedbackLength ?? 0,
      autoApproved: Boolean(args.autoApproved),
    },
  });
}

// ----------------------------------------------------------------------------
// Execution & Code Generation Events
// ----------------------------------------------------------------------------

export function emitSkeletonStarted(args: {
  plannedCount: number;
  modelUsed?: string;
  runId?: string;
  cycleId?: number;
}): void {
  safeEmit('execute', 'skeleton_started', {
    runId: args.runId,
    cycleId: args.cycleId,
    modelUsed: args.modelUsed,
    payload: {
      plannedCount: args.plannedCount,
    },
  });
}

export function emitFileGenerated(args: {
  path: string;
  phase: 'skeleton' | 'implementation' | 'patch';
  status: string;
  exportsCount?: number;
  sizeBytes?: number;
  runId?: string;
  cycleId?: number;
}): void {
  const ext = args.path.includes('.') ? args.path.split('.').pop() : '';
  safeEmit('execute', 'file_generated', {
    runId: args.runId,
    cycleId: args.cycleId,
    payload: {
      path: args.path,
      fileType: ext,
      phase: args.phase,
      status: args.status,
      exportsCount: args.exportsCount ?? 0,
      sizeBytes: args.sizeBytes ?? 0,
    },
  });
}

export function emitManifestCheck(args: {
  phase: 'skeleton' | 'implementation' | 'verification';
  plannedCount: number;
  writtenCount: number;
  missingCount: number;
  completeness: number;
  passed: boolean;
  missingFiles?: string[];
  runId?: string;
  cycleId?: number;
}): void {
  safeEmit('execute', 'manifest_check', {
    runId: args.runId,
    cycleId: args.cycleId,
    severity: args.passed ? 'info' : 'warn',
    payload: {
      phase: args.phase,
      plannedCount: args.plannedCount,
      writtenCount: args.writtenCount,
      missingCount: args.missingCount,
      completenessPct: Number(args.completeness.toFixed(2)),
      passed: args.passed,
      missingFiles: args.missingFiles ?? [],
    },
  });
}

export function emitImplementationCompleted(args: {
  totalFiles: number;
  implementedFiles: number;
  durationMs?: number;
  runId?: string;
  cycleId?: number;
}): void {
  safeEmit('execute', 'implementation_completed', {
    runId: args.runId,
    cycleId: args.cycleId,
    durationMs: args.durationMs,
    payload: {
      totalFiles: args.totalFiles,
      implementedFiles: args.implementedFiles,
    },
  });
}

// ----------------------------------------------------------------------------
// Debug & Self-Loop Repair Events
// ----------------------------------------------------------------------------

export function emitTestStarted(args: {
  testType?: 'smoke' | 'stubs' | 'all';
  stubsCount?: number;
  runId?: string;
  cycleId?: number;
}): void {
  safeEmit('debug', 'test_started', {
    runId: args.runId,
    cycleId: args.cycleId,
    payload: {
      testType: args.testType || 'all',
      stubsCount: args.stubsCount ?? 0,
    },
  });
}

export function emitTestCompleted(args: {
  smokePassed: number;
  smokeFailed: number;
  stubsPassed: number;
  stubsFailed: number;
  regressionPassed?: number;
  regressionFailed?: number;
  durationMs?: number;
  runId?: string;
  cycleId?: number;
}): void {
  const totalFailed = args.smokeFailed + args.stubsFailed + (args.regressionFailed ?? 0);
  const totalPassed = args.smokePassed + args.stubsPassed + (args.regressionPassed ?? 0);

  safeEmit('debug', 'test_completed', {
    runId: args.runId,
    cycleId: args.cycleId,
    severity: totalFailed > 0 ? 'warn' : 'info',
    durationMs: args.durationMs,
    payload: {
      totalPassed,
      totalFailed,
      smoke: { passed: args.smokePassed, failed: args.smokeFailed },
      stubs: { passed: args.stubsPassed, failed: args.stubsFailed },
      regression: { passed: args.regressionPassed ?? 0, failed: args.regressionFailed ?? 0 },
    },
  });
}

export function emitRepairStarted(args: {
  attempt: number;
  maxAttempts: number;
  failuresText?: string;
  runId?: string;
  cycleId?: number;
}): void {
  safeEmit('debug', 'repair_started', {
    runId: args.runId,
    cycleId: args.cycleId,
    severity: 'warn',
    payload: {
      attempt: args.attempt,
      maxAttempts: args.maxAttempts,
      failureSummary: args.failuresText ? args.failuresText.slice(0, 200) : 'Test failures detected',
    },
  });
}

export function emitRepairCompleted(args: {
  attempt: number;
  patchesCount: number;
  patchPaths: string[];
  converged: boolean;
  runId?: string;
  cycleId?: number;
}): void {
  safeEmit('debug', 'repair_completed', {
    runId: args.runId,
    cycleId: args.cycleId,
    severity: args.converged ? 'info' : 'warn',
    payload: {
      attempt: args.attempt,
      patchesCount: args.patchesCount,
      patchPaths: args.patchPaths,
      converged: args.converged,
    },
  });
}

export function emitVerificationCompleted(args: {
  status: 'passed' | 'failed';
  smokePassed: number;
  smokeFailed: number;
  stubsPassed: number;
  stubsFailed: number;
  manifestCompleteness: number;
  repairAttempts: number;
  converged: boolean;
  runId?: string;
  cycleId?: number;
}): void {
  safeEmit('verification', 'verification_completed', {
    runId: args.runId,
    cycleId: args.cycleId,
    severity: args.status === 'passed' ? 'info' : 'error',
    payload: {
      verificationStatus: args.status,
      smokePassed: args.smokePassed,
      smokeFailed: args.smokeFailed,
      stubsPassed: args.stubsPassed,
      stubsFailed: args.stubsFailed,
      manifestCompleteness: Number(args.manifestCompleteness.toFixed(2)),
      repairAttempts: args.repairAttempts,
      converged: args.converged,
    },
  });
}

// ----------------------------------------------------------------------------
// Report Stage Events
// ----------------------------------------------------------------------------

export function emitReportGenerated(args: {
  manifestCompleteness: number;
  totalPassed: number;
  totalFailed: number;
  prdCoverageImplemented: number;
  prdCoverageTotal: number;
  flaggedRisksCount: number;
  durationMs?: number;
  modelUsed?: string;
  runId?: string;
  cycleId?: number;
}): void {
  const coveragePct =
    args.prdCoverageTotal > 0
      ? (args.prdCoverageImplemented / args.prdCoverageTotal) * 100
      : 100;

  safeEmit('report', 'report_generated', {
    runId: args.runId,
    cycleId: args.cycleId,
    modelUsed: args.modelUsed,
    durationMs: args.durationMs,
    payload: {
      manifestCompleteness: Number(args.manifestCompleteness.toFixed(2)),
      testResults: { passed: args.totalPassed, failed: args.totalFailed },
      prdCoverage: {
        implemented: args.prdCoverageImplemented,
        total: args.prdCoverageTotal,
        percentage: Number(coveragePct.toFixed(2)),
      },
      flaggedRisksCount: args.flaggedRisksCount,
    },
  });
}
