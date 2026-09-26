/**
 * telemetry/index.ts — Public entry point for RepoMind/Braid execution telemetry.
 */

export * from './types.js';
export { TigerClient, tigerClient } from './tiger_client.js';
export { EventPipeline, eventPipeline } from './event_pipeline.js';
export * as telemetryHooks from './telemetry_hooks.js';
export {
  emitRunStarted,
  emitRunCompleted,
  emitStageStarted,
  emitStageCompleted,
  emitFileGenerated,
  emitManifestCheck,
  emitSkeletonStarted,
  emitImplementationCompleted,
  emitRepairStarted,
  emitRepairCompleted,
  emitTestStarted,
  emitTestCompleted,
  emitVerificationCompleted,
  emitReportGenerated,
  emitHumanGateDecision,
  initRun,
  getActiveRun,
  setCycleId,
  clearRun,
  addTelemetryListener,
  getEmittedEventsForTest,
  clearEmittedEventsForTest,
} from './telemetry_hooks.js';
export { AnalyticsService, analyticsService } from './analytics_service.js';
export type {
  RunSummary,
  StagePerformanceRecord,
  FileGenerationMetrics,
  TestMetrics,
  RepairMetrics,
  PrdCoverageMetrics,
  ModelPerformanceRecord,
  RecentEventRecord,
  LiveRunMetrics,
} from './analytics_service.js';

