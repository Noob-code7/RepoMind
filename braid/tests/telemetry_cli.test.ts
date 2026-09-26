/**
 * tests/telemetry_cli.test.ts — Unit tests for the read-only telemetry summary command.
 * No database required: formatter is pure, command tests use a disabled client.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AnalyticsService } from '../telemetry/analytics_service.js';
import { TigerClient } from '../telemetry/tiger_client.js';
import type { RunSummary } from '../telemetry/analytics_service.js';
import { formatRunSummaryText } from '../telemetry/summary_view.js';
import { cmdTelemetry, parseArgs } from '../cli.js';

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-abc',
    projectName: 'demo',
    status: 'completed',
    startTime: null,
    completionTime: null,
    totalDurationMs: 2500,
    currentStage: null,
    stagesCompleted: ['plan', 'review', 'execute'],
    plannedFiles: 2,
    generatedFiles: 2,
    missingFiles: 0,
    repairedFiles: 0,
    testsPassed: 9,
    testsFailed: 1,
    repairAttempts: 1,
    manifestCompleteness: 100,
    prdCoverage: 87.5,
    verificationStatus: 'passed',
    ...overrides,
  };
}

describe('parseArgs telemetry', () => {
  it('parses telemetry --run <id>', () => {
    const { command, flags } = parseArgs(['telemetry', '--run', 'run-abc']);
    expect(command).toBe('telemetry');
    expect(flags.runId).toBe('run-abc');
  });
});

describe('formatRunSummaryText', () => {
  it('renders header, stages, tests, files, and coverage', () => {
    const text = formatRunSummaryText({
      summary: makeSummary(),
      stages: [{
        stage: 'plan', modelUsed: 'test-model', executionsCount: 1,
        avgDurationMs: 2500, minDurationMs: 2500, maxDurationMs: 2500,
        p50DurationMs: 2500, p90DurationMs: 2500, p99DurationMs: 2500, failuresCount: 0,
      }],
      tests: {
        runId: 'run-abc', testsPassed: 9, testsFailed: 1, passRatePct: 90,
        smoke: { passed: 1, failed: 0 }, stubs: { passed: 8, failed: 1 }, regression: { passed: 0, failed: 0 },
        durationMs: 450,
      },
      files: {
        runId: 'run-abc', filesPlanned: 2, filesGenerated: 2, filesMissing: 0, filesRepaired: 0,
        generationByPhase: { skeleton: 2, implementation: 2, patch: 0 },
        totalDurationMs: 2000, throughputFilesPerSec: 1,
      },
      coverage: { runId: 'run-abc', coveragePercentage: 87.5, implementedRequirementCount: 7, totalRequirementCount: 8 },
    });
    expect(text).toContain('Run run-abc — demo [completed]');
    expect(text).toContain('plan');
    expect(text).toContain('test-model');
    expect(text).toContain('9 passed / 1 failed');
    expect(text).toContain('planned=2 generated=2');
    expect(text).toContain('87.5%');
    expect(text).toContain('7/8 requirements');
  });

  it('handles missing sections without throwing', () => {
    const text = formatRunSummaryText({ summary: makeSummary(), stages: [], tests: null, files: null, coverage: null });
    expect(text).toContain('no stage metrics recorded');
    expect(text).toContain('no test metrics recorded');
    expect(text).toContain('no file generation metrics recorded');
    expect(text).toContain('87.5%');
  });
});

describe('cmdTelemetry disabled state', () => {
  const prevExitCode = process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); process.exitCode = prevExitCode; });

  it('reports disabled telemetry without touching the database', async () => {
    const service = new AnalyticsService(new TigerClient({ enabled: false, connectionString: '' }));
    await cmdTelemetry({ project: '', prd: '', mock: false, autoApprove: false, smokeOnly: false, runId: 'run-abc' }, service);
    expect(logSpy).toHaveBeenCalledOnce();
    expect(String(logSpy.mock.calls[0]?.[0] ?? '')).toContain('disabled');
    expect(process.exitCode).toBe(1);
  });

  it('requires --run when enabled', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const service = new AnalyticsService({ isEnabled: true, query } as unknown as TigerClient);
    await cmdTelemetry({ project: '', prd: '', mock: false, autoApprove: false, smokeOnly: false }, service);
    expect(query).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
