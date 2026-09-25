/**
 * tests/telemetry.test.ts — Unit tests for isolated telemetry infrastructure.
 * Verifies safe no-op behavior, queue batching, and error resilience without
 * requiring a live database connection.
 */

import { describe, expect, it, vi } from 'vitest';
import { EventPipeline } from '../telemetry/event_pipeline.js';
import { TigerClient } from '../telemetry/tiger_client.js';
import type { TelemetryEvent } from '../telemetry/types.js';

describe('TigerClient', () => {
  it('safely no-ops when disabled or connection string is missing', async () => {
    const client = new TigerClient({ enabled: false, connectionString: '' });
    expect(client.isEnabled).toBe(false);

    const initResult = await client.initialize();
    expect(initResult).toBe(false);

    const inserted = await client.insertEvents([
      {
        time: new Date(),
        runId: 'run-1',
        stage: 'plan',
        eventType: 'stage_started',
      },
    ]);
    expect(inserted).toBe(0);

    const metricResult = await client.insertStageMetric({
      time: new Date(),
      runId: 'run-1',
      stage: 'plan',
      durationMs: 120,
    });
    expect(metricResult).toBe(false);

    const runResult = await client.upsertRun({
      runId: 'run-1',
      projectName: 'test',
      status: 'running',
    });
    expect(runResult).toBe(false);

    await expect(client.close()).resolves.toBeUndefined();
  });
});

describe('EventPipeline', () => {
  it('safely drops events when disabled without error', async () => {
    const mockClient = new TigerClient({ enabled: false, connectionString: '' });
    const pipeline = new EventPipeline({
      client: mockClient,
      enabled: false,
      batchSize: 5,
    });

    expect(pipeline.isEnabled).toBe(false);
    expect(pipeline.queueSize).toBe(0);

    pipeline.emit({
      time: new Date(),
      runId: 'run-1',
      stage: 'plan',
      eventType: 'stage_started',
    });

    expect(pipeline.queueSize).toBe(0);
    await expect(pipeline.flush()).resolves.toBeUndefined();
    await expect(pipeline.stop()).resolves.toBeUndefined();
  });

  it('buffers and flushes events when batch threshold is reached', async () => {
    const insertMock = vi.fn().mockResolvedValue(2);
    const mockClient = {
      isEnabled: true,
      insertEvents: insertMock,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as TigerClient;

    const pipeline = new EventPipeline({
      client: mockClient,
      enabled: true,
      batchSize: 2,
      flushIntervalMs: 10000,
    });

    expect(pipeline.isEnabled).toBe(true);

    const event1: TelemetryEvent = {
      time: new Date(),
      runId: 'run-1',
      stage: 'plan',
      eventType: 'stage_started',
    };
    const event2: TelemetryEvent = {
      time: new Date(),
      runId: 'run-1',
      stage: 'plan',
      eventType: 'stage_completed',
    };

    pipeline.emit(event1);
    expect(pipeline.queueSize).toBe(1);
    expect(insertMock).not.toHaveBeenCalled();

    // Reaching batch size triggers flush
    pipeline.emit(event2);
    // Allow the microtask to flush
    await pipeline.flush();

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith([event1, event2]);
    expect(pipeline.queueSize).toBe(0);

    await pipeline.stop();
  });

  it('bounds queue size to prevent memory leaks', () => {
    const mockClient = {
      isEnabled: true,
      insertEvents: vi.fn().mockResolvedValue(0),
      close: vi.fn(),
    } as unknown as TigerClient;

    const maxQueueSize = 3;
    const pipeline = new EventPipeline({
      client: mockClient,
      enabled: true,
      batchSize: 10,
      maxQueueSize,
    });

    for (let i = 0; i < 5; i++) {
      pipeline.emit({
        time: new Date(),
        runId: `run-${i}`,
        stage: 'execute',
        eventType: 'file_generated',
      });
    }

    expect(pipeline.queueSize).toBe(maxQueueSize);
  });
});

describe('Telemetry Hooks & Lifecycle Wiring', () => {
  it('emits lifecycle events with consistent runId and cycleId', async () => {
    const {
      initRun,
      clearRun,
      emitRunStarted,
      emitStageStarted,
      emitStageCompleted,
      emitSkeletonStarted,
      emitFileGenerated,
      emitManifestCheck,
      emitImplementationCompleted,
      emitTestStarted,
      emitTestCompleted,
      emitRepairStarted,
      emitRepairCompleted,
      emitVerificationCompleted,
      emitReportGenerated,
      emitHumanGateDecision,
      emitRunCompleted,
      clearEmittedEventsForTest,
      getEmittedEventsForTest,
    } = await import('../telemetry/index.js');

    clearEmittedEventsForTest();
    const runId = initRun('demo-project', 'test-run-123');
    expect(runId).toBe('test-run-123');

    emitRunStarted({ projectName: 'demo-project', mock: true, smokeOnly: true });
    emitStageStarted('plan', { modelUsed: 'test-model' });
    emitStageCompleted('plan', { durationMs: 100 });

    emitStageStarted('review', { modelUsed: 'review-model' });
    emitStageCompleted('review', { durationMs: 50 });

    emitHumanGateDecision({
      gate: 1,
      gateName: 'gate_review',
      approved: true,
      autoApproved: true,
    });

    emitStageStarted('execute');
    emitSkeletonStarted({ plannedCount: 2 });
    emitFileGenerated({ path: 'src/app.ts', phase: 'skeleton', status: 'skeleton' });
    emitManifestCheck({
      phase: 'skeleton',
      plannedCount: 2,
      writtenCount: 2,
      missingCount: 0,
      completeness: 100,
      passed: true,
    });
    emitFileGenerated({ path: 'src/app.ts', phase: 'implementation', status: 'implemented' });
    emitImplementationCompleted({ totalFiles: 2, implementedFiles: 2 });
    emitStageCompleted('execute');

    emitStageStarted('debug');
    emitTestStarted({ testType: 'all', stubsCount: 1 });
    emitTestCompleted({
      smokePassed: 1,
      smokeFailed: 0,
      stubsPassed: 1,
      stubsFailed: 0,
    });
    emitRepairStarted({ attempt: 1, maxAttempts: 3, failuresText: 'syntax error' });
    emitRepairCompleted({ attempt: 1, patchesCount: 1, patchPaths: ['src/app.ts'], converged: true });
    emitVerificationCompleted({
      status: 'passed',
      smokePassed: 1,
      smokeFailed: 0,
      stubsPassed: 1,
      stubsFailed: 0,
      manifestCompleteness: 100,
      repairAttempts: 1,
      converged: true,
    });
    emitStageCompleted('debug');

    emitStageStarted('report');
    emitReportGenerated({
      manifestCompleteness: 100,
      totalPassed: 2,
      totalFailed: 0,
      prdCoverageImplemented: 2,
      prdCoverageTotal: 2,
      flaggedRisksCount: 0,
    });
    emitStageCompleted('report');

    emitHumanGateDecision({
      gate: 2,
      gateName: 'gate_report',
      approved: true,
      autoApproved: true,
    });
    emitRunCompleted({ status: 'completed' });

    const events = getEmittedEventsForTest();
    expect(events.length).toBeGreaterThan(15);

    // Verify all events share the exact same runId
    for (const evt of events) {
      expect(evt.runId).toBe('test-run-123');
      expect(evt.cycleId).toBe(0);
      expect(evt.time).toBeDefined();
    }

    const eventTypes = events.map((e) => e.eventType);
    expect(eventTypes).toContain('run_started');
    expect(eventTypes).toContain('stage_started');
    expect(eventTypes).toContain('stage_completed');
    expect(eventTypes).toContain('human_gate_decision');
    expect(eventTypes).toContain('skeleton_started');
    expect(eventTypes).toContain('file_generated');
    expect(eventTypes).toContain('manifest_check');
    expect(eventTypes).toContain('implementation_completed');
    expect(eventTypes).toContain('test_started');
    expect(eventTypes).toContain('test_completed');
    expect(eventTypes).toContain('repair_started');
    expect(eventTypes).toContain('repair_completed');
    expect(eventTypes).toContain('verification_completed');
    expect(eventTypes).toContain('report_generated');
    expect(eventTypes).toContain('run_completed');

    clearRun();
    clearEmittedEventsForTest();
  });

  it('guarantees telemetry hooks never throw even if listeners throw', async () => {
    const { addTelemetryListener, emitFileGenerated, clearEmittedEventsForTest } =
      await import('../telemetry/index.js');

    const unsubscribe = addTelemetryListener(() => {
      throw new Error('Exploding listener');
    });

    expect(() => {
      emitFileGenerated({ path: 'test.ts', phase: 'implementation', status: 'implemented' });
    }).not.toThrow();

    unsubscribe();
    clearEmittedEventsForTest();
  });

  it('captures full end-to-end pipeline execution events with single runId during cmdRun', async () => {
    const { getEmittedEventsForTest, clearEmittedEventsForTest, clearRun } = await import(
      '../telemetry/index.js'
    );
    const { cmdRun } = await import('../cli.js');
    const { tmpdir } = await import('node:os');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');

    clearRun();
    clearEmittedEventsForTest();

    const tempDir = mkdtempSync(join(tmpdir(), 'braid-test-run-'));
    const prdPath = join(tempDir, 'prd.txt');
    writeFileSync(prdPath, 'Build a demo microservice with app and index');

    try {
      await cmdRun({
        project: 'test_telemetry_project',
        prd: prdPath,
        mock: true,
        autoApprove: true,
        smokeOnly: true,
      });

      const events = getEmittedEventsForTest();
      expect(events.length).toBeGreaterThanOrEqual(10);

      // Verify all events share the exact same runId
      const firstRunId = events[0].runId;
      expect(firstRunId).toMatch(/^run_/);
      for (const e of events) {
        expect(e.runId).toBe(firstRunId);
      }

      // Check key lifecycle events were emitted
      const types = events.map((e) => e.eventType);
      expect(types).toContain('run_started');
      expect(types).toContain('stage_started');
      expect(types).toContain('stage_completed');
      expect(types).toContain('human_gate_decision');
      expect(types).toContain('skeleton_started');
      expect(types).toContain('file_generated');
      expect(types).toContain('manifest_check');
      expect(types).toContain('implementation_completed');
      expect(types).toContain('test_started');
      expect(types).toContain('test_completed');
      expect(types).toContain('verification_completed');
      expect(types).toContain('report_generated');
      expect(types).toContain('run_completed');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(join(process.cwd(), 'generated_projects', 'test_telemetry_project'), {
        recursive: true,
        force: true,
      });
      clearRun();
      clearEmittedEventsForTest();
    }
  });
});


