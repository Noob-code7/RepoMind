/**
 * telemetry/types.ts — Contracts for RepoMind/Braid execution telemetry.
 * Completely decoupled from database drivers so modules can define/emit
 * events without side effects.
 */

export const TELEMETRY_STAGES = [
  'plan',
  'review',
  'human_gate',
  'execute',
  'debug',
  'report',
  'verification',
  'run',
] as const;
export type TelemetryStage = (typeof TELEMETRY_STAGES)[number];

export const TELEMETRY_SEVERITIES = ['info', 'warn', 'error'] as const;
export type TelemetrySeverity = (typeof TELEMETRY_SEVERITIES)[number];

export const TELEMETRY_EVENT_TYPES = [
  'run_started',
  'run_completed',
  'stage_started',
  'stage_completed',
  'human_gate_decision',
  'skeleton_started',
  'file_generated',
  'implementation_completed',
  'manifest_check',
  'repair_started',
  'repair_completed',
  'test_started',
  'test_completed',
  'verification_completed',
  'report_generated',
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export interface TelemetryEvent {
  time: Date | string;
  eventId?: string;
  runId: string;
  cycleId?: number;
  stage: TelemetryStage;
  eventType: TelemetryEventType;
  severity?: TelemetrySeverity;
  modelUsed?: string;
  durationMs?: number;
  payload?: Record<string, unknown>;
}

export type RunStatus =
  | 'running'
  | 'completed'
  | 'rejected_gate1'
  | 'rejected_gate2'
  | 'failed';

export interface RunRecord {
  runId: string;
  projectName: string;
  startedAt?: Date | string;
  completedAt?: Date | string;
  status: RunStatus;
  prdPath?: string;
  metadata?: Record<string, unknown>;
}

export interface StageMetricRecord {
  time: Date | string;
  runId: string;
  cycleId?: number;
  stage: TelemetryStage;
  durationMs: number;
  filesPlanned?: number;
  filesGenerated?: number;
  filesMissing?: number;
  filesRepaired?: number;
  testsPassed?: number;
  testsFailed?: number;
  repairAttempts?: number;
  prdCoveragePct?: number;
  verificationStatus?: string;
  modelUsed?: string;
}
