/**
 * telemetry/analytics_service.ts — Read-only analytics service over Tiger Data / TimescaleDB.
 * Provides high-performance aggregation, run summaries, stage latency percentiles,
 * test convergence metrics, and live polling snapshots.
 * Fails safely and gracefully returns null/empty arrays if Tiger Data is disabled or offline.
 */

import { TigerClient, tigerClient as defaultClient } from './tiger_client.js';

// ----------------------------------------------------------------------------
// Analytical Types & Contracts
// ----------------------------------------------------------------------------

export interface RunSummary {
  runId: string;
  projectName: string;
  status: string;
  startTime: Date | null;
  completionTime: Date | null;
  totalDurationMs: number | null;
  currentStage: string | null;
  stagesCompleted: string[];
  plannedFiles: number;
  generatedFiles: number;
  missingFiles: number;
  repairedFiles: number;
  testsPassed: number;
  testsFailed: number;
  repairAttempts: number;
  manifestCompleteness: number | null;
  prdCoverage: number | null;
  verificationStatus: string | null;
}

export interface StagePerformanceRecord {
  stage: string;
  modelUsed: string | null;
  executionsCount: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number | null;
  p90DurationMs: number | null;
  p99DurationMs: number | null;
  failuresCount: number;
}

export interface FileGenerationMetrics {
  runId: string;
  filesPlanned: number;
  filesGenerated: number;
  filesMissing: number;
  filesRepaired: number;
  generationByPhase: {
    skeleton: number;
    implementation: number;
    patch: number;
  };
  totalDurationMs: number | null;
  throughputFilesPerSec: number | null;
}

export interface TestMetrics {
  runId: string;
  testsPassed: number;
  testsFailed: number;
  passRatePct: number;
  smoke: { passed: number; failed: number };
  stubs: { passed: number; failed: number };
  regression: { passed: number; failed: number };
  durationMs: number | null;
}

export interface RepairMetrics {
  runId: string;
  repairAttempts: number;
  repairsCompleted: number;
  converged: boolean;
  patchesAppliedCount: number;
  repairedFiles: string[];
}

export interface PrdCoverageMetrics {
  runId: string;
  coveragePercentage: number;
  implementedRequirementCount: number;
  totalRequirementCount: number;
}

export interface ModelPerformanceRecord {
  modelUsed: string;
  stagesCount: number;
  executionsCount: number;
  avgDurationMs: number;
  totalDurationMs: number;
  failuresCount: number;
}

export interface RecentEventRecord {
  time: Date;
  eventId: string;
  runId: string;
  cycleId: number;
  stage: string;
  eventType: string;
  severity: string;
  modelUsed: string | null;
  durationMs: number | null;
  payloadSummary: Record<string, unknown>;
}

export interface LiveRunMetrics {
  runId: string;
  currentStage: string;
  elapsedTimeMs: number;
  eventsProcessed: number;
  filesPlanned: number;
  filesGenerated: number;
  filesMissing: number;
  repairs: number;
  testsPassed: number;
  testsFailed: number;
  manifestCompleteness: number | null;
  prdCoverage: number | null;
  verificationStatus: string | null;
  latestEventTimestamp: Date | null;
}

// ----------------------------------------------------------------------------
// Analytics Service Implementation
// ----------------------------------------------------------------------------

export class AnalyticsService {
  constructor(private readonly client: TigerClient = defaultClient) {}

  get isEnabled(): boolean {
    return this.client.isEnabled;
  }

  /**
   * Fetch recent events in reverse chronological order with safe bounds.
   */
  async getRecentEvents(
    runId: string,
    limit = 50,
  ): Promise<RecentEventRecord[]> {
    if (!this.isEnabled) return [];
    const boundedLimit = Math.min(Math.max(1, limit), 200);

    const sql = `
      SELECT
        time,
        event_id,
        run_id,
        cycle_id,
        stage,
        event_type,
        severity,
        model_used,
        duration_ms,
        payload
      FROM pipeline_events
      WHERE run_id = $1
      ORDER BY time DESC
      LIMIT $2;
    `;

    interface Row {
      time: string | Date;
      event_id: string;
      run_id: string;
      cycle_id: number;
      stage: string;
      event_type: string;
      severity: string;
      model_used: string | null;
      duration_ms: number | null;
      payload: Record<string, unknown> | null;
    }

    const rows = await this.client.query<Row>(sql, [runId, boundedLimit]);

    return rows.map((r) => ({
      time: new Date(r.time),
      eventId: r.event_id,
      runId: r.run_id,
      cycleId: Number(r.cycle_id),
      stage: r.stage,
      eventType: r.event_type,
      severity: r.severity,
      modelUsed: r.model_used,
      durationMs: r.duration_ms !== null ? Number(r.duration_ms) : null,
      payloadSummary: sanitizePayload(r.payload),
    }));
  }

  /**
   * Derive a comprehensive execution summary for a run from stored telemetry.
   */
  async getRunSummary(runId: string): Promise<RunSummary | null> {
    if (!this.isEnabled) return null;

    // 1. Check sdlc_runs metadata table
    const runRows = await this.client.query<{
      run_id: string;
      project_name: string;
      started_at: string | Date;
      completed_at: string | Date | null;
      status: string;
    }>('SELECT run_id, project_name, started_at, completed_at, status FROM sdlc_runs WHERE run_id = $1 LIMIT 1;', [runId]);

    // 2. Fetch all raw events for this run
    const events = await this.client.query<{
      time: string | Date;
      stage: string;
      event_type: string;
      severity: string;
      duration_ms: number | null;
      payload: Record<string, unknown> | null;
    }>(
      `SELECT time, stage, event_type, severity, duration_ms, payload
       FROM pipeline_events
       WHERE run_id = $1
       ORDER BY time ASC;`,
      [runId],
    );

    if (runRows.length === 0 && events.length === 0) {
      return null;
    }

    const firstRunRow = runRows[0];
    const projectName = firstRunRow?.project_name || 'unknown';
    let status = firstRunRow?.status || 'running';

    let startTime = firstRunRow?.started_at ? new Date(firstRunRow.started_at) : null;
    let completionTime = firstRunRow?.completed_at ? new Date(firstRunRow.completed_at) : null;
    let totalDurationMs: number | null = null;

    const stagesCompletedSet = new Set<string>();
    let currentStage: string | null = null;
    let plannedFiles = 0;
    let generatedFiles = 0;
    let missingFiles = 0;
    let repairedFilesCount = 0;
    const repairedFilesSet = new Set<string>();
    let testsPassed = 0;
    let testsFailed = 0;
    let repairAttempts = 0;
    let manifestCompleteness: number | null = null;
    let prdCoverage: number | null = null;
    let verificationStatus: string | null = null;

    if (events.length > 0) {
      if (!startTime) startTime = new Date(events[0].time);
      const lastEvent = events[events.length - 1];
      currentStage = lastEvent.stage;

      for (const e of events) {
        const payload = e.payload || {};

        if (e.event_type === 'run_started' && !startTime) {
          startTime = new Date(e.time);
        }

        if (e.event_type === 'run_completed') {
          completionTime = new Date(e.time);
          if (typeof payload['status'] === 'string') {
            status = payload['status'];
          }
          if (typeof e.duration_ms === 'number') {
            totalDurationMs = e.duration_ms;
          }
        }

        if (e.event_type === 'stage_completed') {
          stagesCompletedSet.add(e.stage);
        }

        if (e.event_type === 'skeleton_started' && typeof payload['plannedCount'] === 'number') {
          plannedFiles = payload['plannedCount'];
        }

        if (e.event_type === 'manifest_check') {
          if (typeof payload['plannedCount'] === 'number') plannedFiles = payload['plannedCount'];
          if (typeof payload['missingCount'] === 'number') missingFiles = payload['missingCount'];
          if (typeof payload['completenessPct'] === 'number') manifestCompleteness = payload['completenessPct'];
        }

        if (e.event_type === 'file_generated') {
          if (payload['phase'] === 'implementation') {
            generatedFiles++;
          } else if (payload['phase'] === 'patch') {
            if (typeof payload['path'] === 'string') repairedFilesSet.add(payload['path']);
          }
        }

        if (e.event_type === 'repair_started' && typeof payload['attempt'] === 'number') {
          repairAttempts = Math.max(repairAttempts, payload['attempt']);
        }

        if (e.event_type === 'repair_completed') {
          if (Array.isArray(payload['patchPaths'])) {
            for (const p of payload['patchPaths']) {
              if (typeof p === 'string') repairedFilesSet.add(p);
            }
          }
        }

        if (e.event_type === 'test_completed') {
          if (typeof payload['totalPassed'] === 'number') testsPassed = payload['totalPassed'];
          if (typeof payload['totalFailed'] === 'number') testsFailed = payload['totalFailed'];
        }

        if (e.event_type === 'verification_completed') {
          if (typeof payload['verificationStatus'] === 'string') {
            verificationStatus = payload['verificationStatus'];
          }
          if (typeof payload['manifestCompleteness'] === 'number') {
            manifestCompleteness = payload['manifestCompleteness'];
          }
        }

        if (e.event_type === 'report_generated') {
          if (typeof payload['manifestCompleteness'] === 'number') {
            manifestCompleteness = payload['manifestCompleteness'];
          }
          const cov = payload['prdCoverage'] as Record<string, unknown> | undefined;
          if (cov && typeof cov['percentage'] === 'number') {
            prdCoverage = cov['percentage'];
          }
        }
      }

      repairedFilesCount = repairedFilesSet.size;
    }

    if (startTime && completionTime && totalDurationMs === null) {
      totalDurationMs = completionTime.getTime() - startTime.getTime();
    }

    return {
      runId,
      projectName,
      status,
      startTime,
      completionTime,
      totalDurationMs,
      currentStage,
      stagesCompleted: Array.from(stagesCompletedSet),
      plannedFiles,
      generatedFiles,
      missingFiles,
      repairedFiles: repairedFilesCount,
      testsPassed,
      testsFailed,
      repairAttempts,
      manifestCompleteness,
      prdCoverage,
      verificationStatus,
    };
  }

  /**
   * Calculate stage durations, averages, and P50/P90/P99 latency percentiles.
   */
  async getStagePerformance(runId?: string): Promise<StagePerformanceRecord[]> {
    if (!this.isEnabled) return [];

    const whereClause = runId
      ? "WHERE event_type = 'stage_completed' AND run_id = $1"
      : "WHERE event_type = 'stage_completed'";
    const params = runId ? [runId] : [];

    const sql = `
      SELECT
        stage,
        model_used,
        COUNT(*)::int AS executions_count,
        COALESCE(AVG(duration_ms), 0)::float AS avg_duration_ms,
        COALESCE(MIN(duration_ms), 0)::int AS min_duration_ms,
        COALESCE(MAX(duration_ms), 0)::int AS max_duration_ms,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)::float AS p50_duration_ms,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY duration_ms)::float AS p90_duration_ms,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::float AS p99_duration_ms,
        COUNT(*) FILTER (WHERE severity = 'error')::int AS failures_count
      FROM pipeline_events
      ${whereClause}
      GROUP BY stage, model_used
      ORDER BY stage ASC;
    `;

    interface Row {
      stage: string;
      model_used: string | null;
      executions_count: number;
      avg_duration_ms: number;
      min_duration_ms: number;
      max_duration_ms: number;
      p50_duration_ms: number | null;
      p90_duration_ms: number | null;
      p99_duration_ms: number | null;
      failures_count: number;
    }

    const rows = await this.client.query<Row>(sql, params);

    return rows.map((r) => ({
      stage: r.stage,
      modelUsed: r.model_used,
      executionsCount: Number(r.executions_count),
      avgDurationMs: Number(Number(r.avg_duration_ms).toFixed(2)),
      minDurationMs: Number(r.min_duration_ms),
      maxDurationMs: Number(r.max_duration_ms),
      p50DurationMs: r.p50_duration_ms !== null ? Number(Number(r.p50_duration_ms).toFixed(2)) : null,
      p90DurationMs: r.p90_duration_ms !== null ? Number(Number(r.p90_duration_ms).toFixed(2)) : null,
      p99DurationMs: r.p99_duration_ms !== null ? Number(Number(r.p99_duration_ms).toFixed(2)) : null,
      failuresCount: Number(r.failures_count),
    }));
  }

  /**
   * Derive file generation volumes, phase breakdown, and throughput.
   */
  async getFileGenerationMetrics(runId: string): Promise<FileGenerationMetrics | null> {
    if (!this.isEnabled) return null;

    const sql = `
      SELECT event_type, payload, duration_ms, time
      FROM pipeline_events
      WHERE run_id = $1
        AND event_type IN ('skeleton_started', 'file_generated', 'manifest_check', 'implementation_completed')
      ORDER BY time ASC;
    `;

    interface Row {
      event_type: string;
      payload: Record<string, unknown> | null;
      duration_ms: number | null;
      time: string | Date;
    }

    const rows = await this.client.query<Row>(sql, [runId]);
    if (rows.length === 0) return null;

    let filesPlanned = 0;
    let filesGenerated = 0;
    let filesMissing = 0;
    const repairedFilesSet = new Set<string>();
    const generationByPhase = { skeleton: 0, implementation: 0, patch: 0 };
    let totalDurationMs: number | null = null;

    for (const r of rows) {
      const p = r.payload || {};

      if (r.event_type === 'skeleton_started' && typeof p['plannedCount'] === 'number') {
        filesPlanned = p['plannedCount'];
      }

      if (r.event_type === 'manifest_check') {
        if (typeof p['plannedCount'] === 'number') filesPlanned = p['plannedCount'];
        if (typeof p['missingCount'] === 'number') filesMissing = p['missingCount'];
      }

      if (r.event_type === 'file_generated') {
        const phase = p['phase'] as 'skeleton' | 'implementation' | 'patch';
        if (phase === 'skeleton') generationByPhase.skeleton++;
        if (phase === 'implementation') {
          generationByPhase.implementation++;
          filesGenerated++;
        }
        if (phase === 'patch') {
          generationByPhase.patch++;
          if (typeof p['path'] === 'string') repairedFilesSet.add(p['path']);
        }
      }

      if (r.event_type === 'implementation_completed' && typeof r.duration_ms === 'number') {
        totalDurationMs = r.duration_ms;
      }
    }

    let throughputFilesPerSec: number | null = null;
    if (totalDurationMs && totalDurationMs > 0 && filesGenerated > 0) {
      throughputFilesPerSec = Math.round((filesGenerated / (totalDurationMs / 1000)) * 100) / 100;
    }

    return {
      runId,
      filesPlanned,
      filesGenerated,
      filesMissing,
      filesRepaired: repairedFilesSet.size,
      generationByPhase,
      totalDurationMs,
      throughputFilesPerSec,
    };
  }

  /**
   * Derive test pass/fail distributions and pass rate.
   */
  async getTestMetrics(runId: string): Promise<TestMetrics | null> {
    if (!this.isEnabled) return null;

    const sql = `
      SELECT payload, duration_ms
      FROM pipeline_events
      WHERE run_id = $1 AND event_type = 'test_completed'
      ORDER BY time DESC
      LIMIT 1;
    `;

    interface Row {
      payload: {
        totalPassed?: number;
        totalFailed?: number;
        smoke?: { passed: number; failed: number };
        stubs?: { passed: number; failed: number };
        regression?: { passed: number; failed: number };
      } | null;
      duration_ms: number | null;
    }

    const rows = await this.client.query<Row>(sql, [runId]);
    if (rows.length === 0 || !rows[0].payload) return null;

    const p = rows[0].payload;
    const testsPassed = p.totalPassed ?? 0;
    const testsFailed = p.totalFailed ?? 0;
    const total = testsPassed + testsFailed;
    const passRatePct = total > 0 ? Math.round((testsPassed / total) * 10000) / 100 : 100;

    return {
      runId,
      testsPassed,
      testsFailed,
      passRatePct,
      smoke: p.smoke || { passed: 0, failed: 0 },
      stubs: p.stubs || { passed: 0, failed: 0 },
      regression: p.regression || { passed: 0, failed: 0 },
      durationMs: rows[0].duration_ms,
    };
  }

  /**
   * Derive repair convergence velocity and patch details.
   */
  async getRepairMetrics(runId: string): Promise<RepairMetrics | null> {
    if (!this.isEnabled) return null;

    const sql = `
      SELECT event_type, payload
      FROM pipeline_events
      WHERE run_id = $1 AND event_type IN ('repair_started', 'repair_completed', 'verification_completed')
      ORDER BY time ASC;
    `;

    interface Row {
      event_type: string;
      payload: Record<string, unknown> | null;
    }

    const rows = await this.client.query<Row>(sql, [runId]);
    if (rows.length === 0) return null;

    let repairAttempts = 0;
    let repairsCompleted = 0;
    let converged = false;
    let patchesAppliedCount = 0;
    const repairedFilesSet = new Set<string>();

    for (const r of rows) {
      const p = r.payload || {};

      if (r.event_type === 'repair_started') {
        repairAttempts++;
      }

      if (r.event_type === 'repair_completed') {
        repairsCompleted++;
        if (p['converged'] === true) converged = true;
        if (typeof p['patchesCount'] === 'number') patchesAppliedCount += p['patchesCount'];
        if (Array.isArray(p['patchPaths'])) {
          for (const path of p['patchPaths']) {
            if (typeof path === 'string') repairedFilesSet.add(path);
          }
        }
      }

      if (r.event_type === 'verification_completed') {
        if (p['converged'] === true) converged = true;
      }
    }

    return {
      runId,
      repairAttempts,
      repairsCompleted,
      converged,
      patchesAppliedCount,
      repairedFiles: Array.from(repairedFilesSet),
    };
  }

  /**
   * Get PRD requirements coverage metrics from the report stage.
   */
  async getPrdCoverage(runId: string): Promise<PrdCoverageMetrics | null> {
    if (!this.isEnabled) return null;

    const sql = `
      SELECT payload
      FROM pipeline_events
      WHERE run_id = $1 AND event_type = 'report_generated'
      ORDER BY time DESC
      LIMIT 1;
    `;

    interface Row {
      payload: {
        prdCoverage?: {
          percentage?: number;
          implemented?: number;
          total?: number;
        };
      } | null;
    }

    const rows = await this.client.query<Row>(sql, [runId]);
    if (rows.length === 0 || !rows[0].payload?.prdCoverage) return null;

    const cov = rows[0].payload.prdCoverage;
    if (typeof cov.percentage !== 'number') return null;

    return {
      runId,
      coveragePercentage: cov.percentage,
      implementedRequirementCount: cov.implemented ?? 0,
      totalRequirementCount: cov.total ?? 0,
    };
  }

  /**
   * Benchmark factual measurements per model across SDLC stages.
   */
  async getModelPerformance(runId?: string): Promise<ModelPerformanceRecord[]> {
    if (!this.isEnabled) return [];

    const whereClause = runId
      ? 'WHERE model_used IS NOT NULL AND run_id = $1'
      : 'WHERE model_used IS NOT NULL';
    const params = runId ? [runId] : [];

    const sql = `
      SELECT
        model_used,
        COUNT(DISTINCT stage)::int AS stages_count,
        COUNT(*)::int AS executions_count,
        COALESCE(AVG(duration_ms), 0)::float AS avg_duration_ms,
        COALESCE(SUM(duration_ms), 0)::int AS total_duration_ms,
        COUNT(*) FILTER (WHERE severity = 'error')::int AS failures_count
      FROM pipeline_events
      ${whereClause}
      GROUP BY model_used
      ORDER BY executions_count DESC;
    `;

    interface Row {
      model_used: string;
      stages_count: number;
      executions_count: number;
      avg_duration_ms: number;
      total_duration_ms: number;
      failures_count: number;
    }

    const rows = await this.client.query<Row>(sql, params);

    return rows.map((r) => ({
      modelUsed: r.model_used,
      stagesCount: Number(r.stages_count),
      executionsCount: Number(r.executions_count),
      avgDurationMs: Math.round(Number(r.avg_duration_ms) * 100) / 100,
      totalDurationMs: Number(r.total_duration_ms),
      failuresCount: Number(r.failures_count),
    }));
  }

  /**
   * Return a live polling snapshot for UI dashboards.
   */
  async getLiveRunMetrics(runId: string): Promise<LiveRunMetrics | null> {
    if (!this.isEnabled) return null;

    const summary = await this.getRunSummary(runId);
    if (!summary) return null;

    const latestRows = await this.client.query<{
      latest_time: string | Date | null;
      total_events: number;
    }>(
      'SELECT MAX(time) AS latest_time, COUNT(*)::int AS total_events FROM pipeline_events WHERE run_id = $1;',
      [runId],
    );

    const latestEventTimestamp = latestRows[0]?.latest_time ? new Date(latestRows[0].latest_time) : null;
    const eventsProcessed = Number(latestRows[0]?.total_events || 0);

    const elapsedTimeMs =
      summary.startTime && summary.completionTime
        ? summary.completionTime.getTime() - summary.startTime.getTime()
        : summary.startTime
          ? Date.now() - summary.startTime.getTime()
          : 0;

    return {
      runId,
      currentStage: summary.currentStage || 'idle',
      elapsedTimeMs,
      eventsProcessed,
      filesPlanned: summary.plannedFiles,
      filesGenerated: summary.generatedFiles,
      filesMissing: summary.missingFiles,
      repairs: summary.repairedFiles,
      testsPassed: summary.testsPassed,
      testsFailed: summary.testsFailed,
      manifestCompleteness: summary.manifestCompleteness,
      prdCoverage: summary.prdCoverage,
      verificationStatus: summary.verificationStatus,
      latestEventTimestamp,
    };
  }
}

/**
 * Remove sensitive or overly large fields from payload before returning.
 */
function sanitizePayload(raw: Record<string, unknown> | null): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    // Strip potential sensitive keys if ever present
    const lower = k.toLowerCase();
    if (lower.includes('key') || lower.includes('secret') || lower.includes('token') || lower.includes('password')) {
      continue;
    }
    // Truncate overly long text strings (e.g. error traces) to safe limit
    if (typeof v === 'string' && v.length > 500) {
      cleaned[k] = v.slice(0, 500) + '... (truncated)';
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

export const analyticsService = new AnalyticsService();
