/**
 * tests/analytics_service.test.ts — Unit tests for AnalyticsService.
 * Validates safe fallback, query construction, metric derivation, and
 * result normalization without requiring a real Tiger Data database.
 */

import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '../telemetry/analytics_service.js';
import type { TigerClient } from '../telemetry/tiger_client.js';

describe('AnalyticsService (Disabled State)', () => {
  const disabledClient = {
    isEnabled: false,
    query: vi.fn().mockResolvedValue([]),
  } as unknown as TigerClient;

  const service = new AnalyticsService(disabledClient);

  it('safely returns null or empty arrays when Tiger is disabled', async () => {
    expect(service.isEnabled).toBe(false);

    expect(await service.getRecentEvents('run-1')).toEqual([]);
    expect(await service.getRunSummary('run-1')).toBeNull();
    expect(await service.getStagePerformance('run-1')).toEqual([]);
    expect(await service.getFileGenerationMetrics('run-1')).toBeNull();
    expect(await service.getTestMetrics('run-1')).toBeNull();
    expect(await service.getRepairMetrics('run-1')).toBeNull();
    expect(await service.getPrdCoverage('run-1')).toBeNull();
    expect(await service.getModelPerformance('run-1')).toEqual([]);
    expect(await service.getLiveRunMetrics('run-1')).toBeNull();

    expect(disabledClient.query).not.toHaveBeenCalled();
  });
});

describe('AnalyticsService (Active Queries & Normalization)', () => {
  it('enforces safe bounds on getRecentEvents limit parameter', async () => {
    const queryMock = vi.fn().mockResolvedValue([]);
    const client = { isEnabled: true, query: queryMock } as unknown as TigerClient;
    const service = new AnalyticsService(client);

    // Test default limit (50)
    await service.getRecentEvents('run-123');
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), ['run-123', 50]);

    // Test upper bound clamp (max 200)
    await service.getRecentEvents('run-123', 1000);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), ['run-123', 200]);

    // Test lower bound clamp (min 1)
    await service.getRecentEvents('run-123', -10);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), ['run-123', 1]);
  });

  it('derives a complete RunSummary from real stored telemetry events', async () => {
    const fakeEvents = [
      {
        time: '2026-09-25T10:00:00.000Z',
        stage: 'run',
        event_type: 'run_started',
        severity: 'info',
        duration_ms: null,
        payload: { projectName: 'demo-app' },
      },
      {
        time: '2026-09-25T10:00:01.000Z',
        stage: 'plan',
        event_type: 'stage_completed',
        severity: 'info',
        duration_ms: 1000,
        payload: { filesCount: 3 },
      },
      {
        time: '2026-09-25T10:00:02.000Z',
        stage: 'execute',
        event_type: 'skeleton_started',
        severity: 'info',
        duration_ms: null,
        payload: { plannedCount: 3 },
      },
      {
        time: '2026-09-25T10:00:03.000Z',
        stage: 'execute',
        event_type: 'file_generated',
        severity: 'info',
        duration_ms: null,
        payload: { path: 'src/app.ts', phase: 'implementation' },
      },
      {
        time: '2026-09-25T10:00:04.000Z',
        stage: 'execute',
        event_type: 'file_generated',
        severity: 'info',
        duration_ms: null,
        payload: { path: 'src/index.ts', phase: 'implementation' },
      },
      {
        time: '2026-09-25T10:00:05.000Z',
        stage: 'execute',
        event_type: 'manifest_check',
        severity: 'info',
        duration_ms: null,
        payload: { plannedCount: 3, writtenCount: 2, missingCount: 1, completenessPct: 66.7 },
      },
      {
        time: '2026-09-25T10:00:06.000Z',
        stage: 'execute',
        event_type: 'stage_completed',
        severity: 'info',
        duration_ms: 4000,
        payload: { implementedCount: 2 },
      },
      {
        time: '2026-09-25T10:00:07.000Z',
        stage: 'debug',
        event_type: 'test_completed',
        severity: 'info',
        duration_ms: 500,
        payload: { totalPassed: 4, totalFailed: 1 },
      },
      {
        time: '2026-09-25T10:00:08.000Z',
        stage: 'debug',
        event_type: 'repair_started',
        severity: 'warn',
        duration_ms: null,
        payload: { attempt: 1 },
      },
      {
        time: '2026-09-25T10:00:09.000Z',
        stage: 'debug',
        event_type: 'file_generated',
        severity: 'info',
        duration_ms: null,
        payload: { path: 'src/app.ts', phase: 'patch' },
      },
      {
        time: '2026-09-25T10:00:10.000Z',
        stage: 'verification',
        event_type: 'verification_completed',
        severity: 'info',
        duration_ms: null,
        payload: { verificationStatus: 'passed', manifestCompleteness: 100 },
      },
      {
        time: '2026-09-25T10:00:11.000Z',
        stage: 'report',
        event_type: 'report_generated',
        severity: 'info',
        duration_ms: 300,
        payload: { manifestCompleteness: 100, prdCoverage: { percentage: 95.5 } },
      },
      {
        time: '2026-09-25T10:00:12.000Z',
        stage: 'run',
        event_type: 'run_completed',
        severity: 'info',
        duration_ms: 12000,
        payload: { status: 'completed' },
      },
    ];

    const client = {
      isEnabled: true,
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM sdlc_runs')) {
          return Promise.resolve([
            {
              run_id: 'run-abc',
              project_name: 'demo-app',
              started_at: '2026-09-25T10:00:00.000Z',
              completed_at: '2026-09-25T10:00:12.000Z',
              status: 'completed',
            },
          ]);
        }
        if (sql.includes('FROM pipeline_events')) {
          return Promise.resolve(fakeEvents);
        }
        return Promise.resolve([]);
      }),
    } as unknown as TigerClient;

    const service = new AnalyticsService(client);
    const summary = await service.getRunSummary('run-abc');

    expect(summary).not.toBeNull();
    expect(summary!.runId).toBe('run-abc');
    expect(summary!.projectName).toBe('demo-app');
    expect(summary!.status).toBe('completed');
    expect(summary!.stagesCompleted).toContain('plan');
    expect(summary!.stagesCompleted).toContain('execute');
    expect(summary!.plannedFiles).toBe(3);
    expect(summary!.generatedFiles).toBe(2);
    expect(summary!.missingFiles).toBe(1);
    expect(summary!.repairedFiles).toBe(1);
    expect(summary!.testsPassed).toBe(4);
    expect(summary!.testsFailed).toBe(1);
    expect(summary!.repairAttempts).toBe(1);
    expect(summary!.manifestCompleteness).toBe(100);
    expect(summary!.prdCoverage).toBe(95.5);
    expect(summary!.verificationStatus).toBe('passed');
    expect(summary!.totalDurationMs).toBe(12000);
  });

  it('calculates stage performance percentiles and executions', async () => {
    const fakeRows = [
      {
        stage: 'plan',
        model_used: 'deepseek-reasoner',
        executions_count: 2,
        avg_duration_ms: 2500.5,
        min_duration_ms: 2000,
        max_duration_ms: 3001,
        p50_duration_ms: 2500.5,
        p90_duration_ms: 2900.1,
        p99_duration_ms: 2990.9,
        failures_count: 0,
      },
    ];

    const client = {
      isEnabled: true,
      query: vi.fn().mockResolvedValue(fakeRows),
    } as unknown as TigerClient;

    const service = new AnalyticsService(client);
    const perf = await service.getStagePerformance('run-1');

    expect(perf.length).toBe(1);
    expect(perf[0].stage).toBe('plan');
    expect(perf[0].modelUsed).toBe('deepseek-reasoner');
    expect(perf[0].avgDurationMs).toBe(2500.5);
    expect(perf[0].p50DurationMs).toBe(2500.5);
    expect(perf[0].p90DurationMs).toBe(2900.1);
  });

  it('calculates file generation metrics and throughput', async () => {
    const fakeRows = [
      {
        event_type: 'skeleton_started',
        payload: { plannedCount: 4 },
        duration_ms: null,
        time: '2026-09-25T10:00:00Z',
      },
      {
        event_type: 'file_generated',
        payload: { phase: 'skeleton', path: 'src/a.ts' },
        duration_ms: null,
        time: '2026-09-25T10:00:01Z',
      },
      {
        event_type: 'file_generated',
        payload: { phase: 'implementation', path: 'src/a.ts' },
        duration_ms: null,
        time: '2026-09-25T10:00:02Z',
      },
      {
        event_type: 'file_generated',
        payload: { phase: 'patch', path: 'src/a.ts' },
        duration_ms: null,
        time: '2026-09-25T10:00:03Z',
      },
      {
        event_type: 'implementation_completed',
        payload: { totalFiles: 4, implementedFiles: 1 },
        duration_ms: 2000,
        time: '2026-09-25T10:00:04Z',
      },
    ];

    const client = {
      isEnabled: true,
      query: vi.fn().mockResolvedValue(fakeRows),
    } as unknown as TigerClient;

    const service = new AnalyticsService(client);
    const metrics = await service.getFileGenerationMetrics('run-1');

    expect(metrics).not.toBeNull();
    expect(metrics!.filesPlanned).toBe(4);
    expect(metrics!.filesGenerated).toBe(1);
    expect(metrics!.filesRepaired).toBe(1);
    expect(metrics!.generationByPhase.skeleton).toBe(1);
    expect(metrics!.generationByPhase.implementation).toBe(1);
    expect(metrics!.generationByPhase.patch).toBe(1);
    expect(metrics!.totalDurationMs).toBe(2000);
    // 1 file / (2000ms / 1000) = 0.5 files/sec
    expect(metrics!.throughputFilesPerSec).toBe(0.5);
  });

  it('calculates test pass rate and bucket breakdowns', async () => {
    const fakeRows = [
      {
        payload: {
          totalPassed: 9,
          totalFailed: 1,
          smoke: { passed: 1, failed: 0 },
          stubs: { passed: 8, failed: 1 },
          regression: { passed: 0, failed: 0 },
        },
        duration_ms: 450,
      },
    ];

    const client = {
      isEnabled: true,
      query: vi.fn().mockResolvedValue(fakeRows),
    } as unknown as TigerClient;

    const service = new AnalyticsService(client);
    const metrics = await service.getTestMetrics('run-1');

    expect(metrics).not.toBeNull();
    expect(metrics!.testsPassed).toBe(9);
    expect(metrics!.testsFailed).toBe(1);
    expect(metrics!.passRatePct).toBe(90);
    expect(metrics!.smoke.passed).toBe(1);
    expect(metrics!.durationMs).toBe(450);
  });

  it('extracts PRD coverage metrics or returns null if absent', async () => {
    const client = {
      isEnabled: true,
      query: vi.fn().mockResolvedValue([
        {
          payload: {
            prdCoverage: {
              percentage: 87.5,
              implemented: 7,
              total: 8,
            },
          },
        },
      ]),
    } as unknown as TigerClient;

    const service = new AnalyticsService(client);
    const coverage = await service.getPrdCoverage('run-1');

    expect(coverage).not.toBeNull();
    expect(coverage!.coveragePercentage).toBe(87.5);
    expect(coverage!.implementedRequirementCount).toBe(7);
    expect(coverage!.totalRequirementCount).toBe(8);

    // Test null return when no report events exist
    const emptyClient = { isEnabled: true, query: vi.fn().mockResolvedValue([]) } as unknown as TigerClient;
    const emptyService = new AnalyticsService(emptyClient);
    expect(await emptyService.getPrdCoverage('run-missing')).toBeNull();
  });

  it('delivers live run polling snapshots', async () => {
    const client = {
      isEnabled: true,
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('MAX(time) AS latest_time')) {
          return Promise.resolve([
            {
              latest_time: '2026-09-25T10:00:15.000Z',
              total_events: 18,
            },
          ]);
        }
        if (sql.includes('FROM sdlc_runs')) {
          return Promise.resolve([
            {
              run_id: 'run-live',
              project_name: 'live-app',
              started_at: '2026-09-25T10:00:00.000Z',
              completed_at: null,
              status: 'running',
            },
          ]);
        }
        if (sql.includes('FROM pipeline_events')) {
          return Promise.resolve([
            {
              time: '2026-09-25T10:00:00.000Z',
              stage: 'execute',
              event_type: 'stage_started',
              severity: 'info',
              duration_ms: null,
              payload: {},
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    } as unknown as TigerClient;

    const service = new AnalyticsService(client);
    const live = await service.getLiveRunMetrics('run-live');

    expect(live).not.toBeNull();
    expect(live!.runId).toBe('run-live');
    expect(live!.currentStage).toBe('execute');
    expect(live!.eventsProcessed).toBe(18);
    expect(live!.latestEventTimestamp).toEqual(new Date('2026-09-25T10:00:15.000Z'));
  });
});
