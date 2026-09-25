/**
 * orchestrator/loop_controller.ts
 * Manages iterations, caps self-repair loops, and tracks pipeline lifecycle events.
 * Deterministic — NO LLM calls live here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MAX_SELF_LOOP_ITERATIONS } from '../shared/config.js';
import type { GateDecision, PipelineState, TestResults } from '../shared/types.js';
import { totalFailed } from '../shared/types.js';
import type { ManifestStore } from './manifest_store.js';
import type { DigestStore } from './digest_store.js';
import { triageFailures } from '../agents/debugger/failure_triage.js';
import { applyPatch } from '../agents/executor/ast_patcher.js';

export const DEFAULT_MAX_AGILE_CYCLES = 5;

export interface LoopEvent {
  stage: string;
  action: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export class LoopController {
  public readonly maxSelfLoops: number;
  public readonly maxAgile: number;
  public currentSelfLoop = 0;
  public agileCycle = 1;
  public events: LoopEvent[] = [];

  constructor(
    maxSelfLoops: number = MAX_SELF_LOOP_ITERATIONS,
    maxAgile: number = DEFAULT_MAX_AGILE_CYCLES,
  ) {
    this.maxSelfLoops = maxSelfLoops;
    this.maxAgile = maxAgile;
  }

  get maxSelfLoop(): number {
    return this.maxSelfLoops;
  }

  get selfLoops(): number {
    return this.currentSelfLoop;
  }

  get agileCount(): number {
    return this.agileCycle;
  }

  canSelfLoop(): boolean {
    return this.currentSelfLoop < this.maxSelfLoops;
  }

  canAgileLoop(): boolean {
    return this.agileCycle < this.maxAgile;
  }

  recordSelfLoop(reason = 'repair attempt', details?: Record<string, unknown>): number {
    if (!this.canSelfLoop()) {
      throw new Error(
        `[loop_controller] Self-loop budget exhausted (${this.maxSelfLoops}) — surfacing to human gate`,
      );
    }
    this.currentSelfLoop++;
    this.recordEvent('EXECUTE_DEBUG_LOOP', `Self-loop repair #${this.currentSelfLoop}: ${reason}`, details);
    return this.currentSelfLoop;
  }

  resetSelfLoop(): void {
    this.currentSelfLoop = 0;
  }

  startNewAgileCycle(feedback: string): number {
    this.agileCycle++;
    this.resetSelfLoop();
    this.recordEvent('AGILE_LOOP', `Looping back to PLAN for Cycle #${this.agileCycle}`, { feedback });
    return this.agileCycle;
  }

  gateCheckpoint(
    state: 'GATE_REVIEW' | 'GATE_REPORT',
    decision: GateDecision,
  ): PipelineState | null {
    if (decision.approved) {
      if (state === 'GATE_REPORT') this.resetSelfLoop();
      return null;
    }
    if (state === 'GATE_REPORT') {
      if (!this.canAgileLoop()) {
        throw new Error(
          `[loop_controller] Agile loop budget exhausted (${this.maxAgile})`,
        );
      }
      this.agileCycle += 1;
    }
    return 'PLAN';
  }

  recordEvent(stage: string, action: string, details?: Record<string, unknown>): void {
    this.events.push({
      stage,
      action,
      timestamp: new Date().toISOString(),
      details,
    });
  }

  getSummary(): {
    agileCycle: number;
    currentSelfLoop: number;
    maxSelfLoops: number;
    totalEvents: number;
  } {
    return {
      agileCycle: this.agileCycle,
      currentSelfLoop: this.currentSelfLoop,
      maxSelfLoops: this.maxSelfLoops,
      totalEvents: this.events.length,
    };
  }
}

export interface RepairLoopArgs {
  controller: LoopController;
  store: ManifestStore;
  digest: DigestStore;
  projectRoot: string;
  failures: string;
  allowedPaths: string[];
  retest: () => Promise<TestResults>;
}

export interface RepairLoopResult {
  attempts: number;
  results: TestResults;
  converged: boolean;
}

export async function runRepairLoop(
  args: RepairLoopArgs,
): Promise<RepairLoopResult> {
  let results = await args.retest();
  while (totalFailed(results) > 0 && args.controller.canSelfLoop()) {
    args.controller.recordSelfLoop();
    const sources = args.allowedPaths.map((p) => ({
      path: p,
      source: fs.readFileSync(path.join(args.projectRoot, p), 'utf8'),
    }));
    const patches = await triageFailures({
      failures: args.failures,
      digestPrompt: (args.digest as any).toPrompt ? (args.digest as any).toPrompt() : '',
      sources,
      allowedPaths: args.allowedPaths,
    });
    for (const patch of patches) {
      const updated = applyPatch(
        path.join(args.projectRoot, patch.path),
        patch.anchor,
        patch.replacement,
      );
      if ((args.digest as any).upsert) {
        (args.digest as any).upsert(patch.path, updated);
      }
      args.store.setStatus(patch.path, 'implemented');
    }
    results = await args.retest();
  }
  return {
    attempts: args.controller.selfLoops,
    results,
    converged: totalFailed(results) === 0,
  };
}
