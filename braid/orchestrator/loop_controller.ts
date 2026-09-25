/**
 * orchestrator/loop_controller.ts — Caps iterations, manages gate checkpoints.
 * - Self-loop ("Relf") repair: test → triage → ast_patcher, up to
 *   MAX_SELF_LOOP_ITERATIONS before surfacing to the human gate.
 * - Agile loop: GATE_REPORT rejections loop to PLAN, capped by maxAgileCycles.
 * Deterministic counters + one concrete repair driver. No direct LLM calls
 * (triage is injected/delegated to failure_triage).
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { MAX_SELF_LOOP_ITERATIONS } from '../shared/config.js';
import type { GateDecision, PipelineState, TestResults } from '../shared/types.js';
import { totalFailed } from '../shared/types.js';
import type { ManifestStore } from './manifest_store.js';
import type { DigestStore } from './digest_store.js';
import { triageFailures } from '../agents/debugger/failure_triage.js';
import { applyPatch } from '../agents/executor/ast_patcher.js';

export const DEFAULT_MAX_AGILE_CYCLES = 5;

export class LoopController {
  private selfLoopAttempts = 0;
  private agileCycles = 0;

  constructor(
    readonly maxSelfLoop: number = MAX_SELF_LOOP_ITERATIONS,
    readonly maxAgile: number = DEFAULT_MAX_AGILE_CYCLES,
  ) {}

  get selfLoops(): number {
    return this.selfLoopAttempts;
  }

  get agileCount(): number {
    return this.agileCycles;
  }

  /** True while another self-loop repair attempt is allowed. */
  canSelfLoop(): boolean {
    return this.selfLoopAttempts < this.maxSelfLoop;
  }

  recordSelfLoop(): void {
    if (!this.canSelfLoop()) {
      throw new Error(
        `[loop_controller] Self-loop budget exhausted (${this.maxSelfLoop}) — surfacing to human gate`,
      );
    }
    this.selfLoopAttempts += 1;
  }

  resetSelfLoop(): void {
    this.selfLoopAttempts = 0;
  }

  /** True while another agile PLAN loop is allowed. */
  canAgileLoop(): boolean {
    return this.agileCycles < this.maxAgile;
  }

  /**
   * Apply a gate decision to loop accounting. Returns the branch target:
   * approved → null (proceed), rejected → 'PLAN' (or throws when over budget).
   */
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
      this.agileCycles += 1;
    }
    return 'PLAN';
  }
}

export interface RepairLoopArgs {
  controller: LoopController;
  store: ManifestStore;
  digest: DigestStore;
  projectRoot: string;
  /** Human-readable failure text for triage (logs, missing lists). */
  failures: string;
  /** Repo-relative paths triage may patch. */
  allowedPaths: string[];
  /** Re-run the real test suite after patching. */
  retest: () => Promise<TestResults>;
}

export interface RepairLoopResult {
  attempts: number;
  results: TestResults;
  converged: boolean;
}

/**
 * Capped repair cycle (§4 step 6): triage → targeted patches → retest.
 * Stops early when totalFailed hits 0. Patches go only through ast_patcher.
 */
export async function runRepairLoop(
  args: RepairLoopArgs,
): Promise<RepairLoopResult> {
  let results = await args.retest();
  while (totalFailed(results) > 0 && args.controller.canSelfLoop()) {
    args.controller.recordSelfLoop();
    const sources = args.allowedPaths.map((p) => ({
      path: p,
      source: readFileSync(join(args.projectRoot, p), 'utf8'),
    }));
    const patches = await triageFailures({
      failures: args.failures,
      digestPrompt: args.digest.toPrompt(),
      sources,
      allowedPaths: args.allowedPaths,
    });
    for (const patch of patches) {
      const updated = applyPatch(
        join(args.projectRoot, patch.path),
        patch.anchor,
        patch.replacement,
      );
      args.digest.upsert(patch.path, updated);
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
