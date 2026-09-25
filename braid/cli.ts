#!/usr/bin/env node
/**
 * cli.ts — Headless Braid pipeline (CLI-first, per master.md §7).
 *   npx tsx cli.ts plan --project demo --prd ./prd.txt [--mock] [--feedback "..."]
 *   npx tsx cli.ts run  --project demo --prd ./prd.txt [--mock] [--auto-approve] [--smoke-only]
 *
 * Exit codes: 0 ok · 1 error · 2 rejected at Gate 1 · 3 loop back at Gate 2.
 * --mock runs fully offline with a deterministic demo plan (no API keys).
 * --smoke-only skips spawning vitest (real fs checks only); use where the
 *   sandbox cannot run workers, otherwise the real runner is the default.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Suppress noisy punycode deprecation warnings from transitive dependencies
const _origEmitWarning = process.emitWarning;
process.emitWarning = (warning: any, ...args: any[]) => {
  if (typeof warning === 'string' && warning.includes('punycode')) return;
  if (typeof warning === 'object' && (warning?.name === 'DeprecationWarning' || warning?.message?.includes('punycode'))) return;
  return (_origEmitWarning as any).call(process, warning, ...args);
};

import { config } from './shared/config.js';
import { setMockHandler } from './shared/llm_client.js';
import { planProject } from './agents/planner/planner.js';
import { reviewPlan } from './agents/reviewer/reviewer.js';
import {
  decideGateReview,
  formatPlanSummary,
  promptGateReview,
} from './human_gate/gate_review.js';
import {
  decideGateReport,
  formatReportSummary,
  promptGateReport,
} from './human_gate/gate_report.js';
import { ManifestStore, manifestPathFor } from './orchestrator/manifest_store.js';
import { executeProject } from './agents/executor/executor.js';
import { runTests } from './agents/debugger/test_runner.js';
import { generateReport } from './agents/reporter/reporter.js';
import { LoopController, runRepairLoop } from './orchestrator/loop_controller.js';
import { DigestStore } from './orchestrator/digest_store.js';
import type { FileManifest, TestResults } from './shared/types.js';
import { emptyTestResults } from './shared/types.js';

const BRAID_ROOT = dirname(fileURLToPath(import.meta.url));

interface Flags {
  project: string;
  prd: string;
  feedback?: string;
  mock: boolean;
  autoApprove: boolean;
  smokeOnly: boolean;
}

function usage(): string {
  return [
    'Braid — autonomous SDLC agent (headless CLI)',
    '',
    '  npx tsx cli.ts plan --project <name> --prd <file> [--mock] [--feedback "..."]',
    '  npx tsx cli.ts run  --project <name> --prd <file> [--mock] [--auto-approve] [--smoke-only]',
    '',
    'Flags:',
    '  --project <name>   output folder under generated_projects/<name>',
    '  --prd <file>       path to the PRD text file',
    '  --feedback <text>  prior gate feedback, folded into (re-)planning',
    '  --mock             offline demo: deterministic mock models, no API keys',
    '  --auto-approve     pass both human gates without prompting',
    '  --smoke-only       skip vitest; real fs smoke check only (broken sandboxes)',
  ].join('\n');
}

function parseArgs(argv: string[]): { command: string; flags: Flags } {
  const command = argv[0] ?? 'help';
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);
  const project = get('project') ?? '';
  const prdPath = get('prd') ?? '';
  return {
    command,
    flags: {
      project,
      prd: prdPath,
      feedback: get('feedback'),
      mock: has('mock'),
      autoApprove: has('auto-approve'),
      smokeOnly: has('smoke-only'),
    },
  };
}

function readPrd(prdPath: string): string {
  let abs = resolve(prdPath);
  if (!existsSync(abs)) {
    const fallback = join(BRAID_ROOT, prdPath);
    if (existsSync(fallback)) abs = fallback;
    else throw new Error(`PRD file not found: ${prdPath}`);
  }
  const text = readFileSync(abs, 'utf8').trim();
  if (!text) throw new Error(`PRD file is empty: ${prdPath}`);
  return text;
}

/** Deterministic offline models: fixed 2-file demo plan shaped by the project. */
function installMock(project: string): void {
  let mockManifest: FileManifest | null = null;
  setMockHandler((req) => {
    if (req.stage === 'plan') {
      return JSON.stringify({
        taskGraph: {
          nodes: [
            { id: 't1', title: 'Scaffold app', dependsOn: [], files: ['src/app.ts'] },
            { id: 't2', title: 'Wire entry', dependsOn: ['t1'], files: ['src/index.ts'] },
          ],
        },
        manifest: {
          project,
          files: [
            { path: 'src/app.ts', purpose: 'core logic', expectedExports: ['build'], dependencies: [], status: 'planned' },
            { path: 'src/index.ts', purpose: 'entry point', expectedExports: ['main'], dependencies: ['src/app.ts'], status: 'planned' },
          ],
        },
        testStubs: [{
          file: 'tests/smoke.test.ts',
          name: 'demo app builds ok',
          code: [
            "import { describe, expect, it } from 'vitest';",
            "import { main } from '../src/index.js';",
            "import { build } from '../src/app.js';",
            "describe('demo app', () => {",
            "  it('builds ok', () => { expect(build()).toBe('ok'); });",
            "  it('mains ok', () => { expect(main()).toBe('ok'); });",
            '});',
            '',
          ].join('\n'),
        }],
      });
    }
    if (req.stage === 'review') {
      return JSON.stringify({ critiques: [], risks: [], riskScore: 0.1 });
    }
    if (req.stage === 'execute') {
      // NOTE: match full pass names — the implementation prompt also mentions
      // the word "skeleton" (it receives the file's skeleton as input).
      if (req.systemPrompt.includes('skeleton pass')) {
        if (!mockManifest) throw new Error('[mock] skeleton pass ran before manifest was set');
        const files = mockManifest.files.map((f) => ({
          path: f.path,
          code: `/** ${f.purpose} */\n` + f.expectedExports
            .map((e) => `export function ${e}(): string { throw new Error("not implemented"); }`)
            .join('\n') + '\n',
        }));
        return JSON.stringify({ files });
      }
      const m = /TARGET FILE: (\S+)/.exec(req.userPrompt);
      const target = m?.[1] ?? '';
      if (target.endsWith('src/app.ts')) return 'export function build(): string { return "ok"; }\n';
      if (target.endsWith('src/index.ts')) {
        return 'import { build } from "./app.js";\nexport function main(): string { return build(); }\n';
      }
      return 'export const ok = true;\n';
    }
    if (req.stage === 'report') {
      return JSON.stringify({
        diffSummary: `Mock demo cycle for ${project}: 2 files implemented, smoke passing.`,
        flaggedRisks: [],
      });
    }
    if (req.stage === 'triage') return JSON.stringify({ patches: [] });
    throw new Error(`[mock] Unhandled stage: ${req.stage}`);
  });
  // Expose a setter so the run command can feed the planned manifest in.
  (globalThis as Record<string, unknown>).__braidMockManifest = (m: FileManifest) => {
    mockManifest = m;
  };
}

function setMockManifest(m: FileManifest): void {
  const setter = (globalThis as Record<string, unknown>).__braidMockManifest as
    | ((m: FileManifest) => void)
    | undefined;
  setter?.(m);
}

function prdToRequirements(prd: string): string[] {
  return prd.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20);
}

async function cmdPlan(flags: Flags): Promise<void> {
  if (!flags.project) throw new Error('Missing --project <name>');
  const prd = readPrd(flags.prd);
  if (flags.mock) installMock(flags.project);
  const plan = await planProject({ project: flags.project, prd, feedback: flags.feedback });
  setMockManifest(plan.manifest);

  let review;
  try {
    review = await reviewPlan(prd, plan);
  } catch (err) {
    review = { critiques: [], risks: [`review unavailable: ${(err as Error).message}`], riskScore: 0.5 };
  }
  const summary = formatPlanSummary(plan, review);
  console.log(summary);

  const outDir = join(resolve(config.generatedRoot), flags.project);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  new ManifestStore(manifestPathFor(resolve(config.generatedRoot), flags.project), plan.manifest);
  console.log(`\nPlan saved to ${outDir}/plan.json + manifest.json`);

  const decision = flags.autoApprove
    ? decideGateReview(true)
    : await promptGateReview(summary);
  if (!decision.approved) {
    console.log(`\nGate 1: REJECTED — feedback saved. Re-run with --feedback "...":\n${decision.feedback}`);
    writeFileSync(join(outDir, 'gate1-feedback.txt'), (decision.feedback ?? '') + '\n');
    process.exitCode = 2;
  } else {
    console.log('\nGate 1: APPROVED.');
  }
}

async function cmdRun(flags: Flags): Promise<void> {
  if (!flags.project) throw new Error('Missing --project <name>');
  const prd = readPrd(flags.prd);
  if (flags.mock) installMock(flags.project);

  // PLAN + REVIEW
  const plan = await planProject({ project: flags.project, prd, feedback: flags.feedback });
  setMockManifest(plan.manifest);
  let review;
  try {
    review = await reviewPlan(prd, plan);
  } catch (err) {
    review = { critiques: [], risks: [`review unavailable: ${(err as Error).message}`], riskScore: 0.5 };
  }
  const planSummary = formatPlanSummary(plan, review);
  console.log(planSummary);

  const gate1 = flags.autoApprove ? decideGateReview(true) : await promptGateReview(planSummary);
  if (!gate1.approved) {
    console.log(`\nGate 1: REJECTED.\n${gate1.feedback}`);
    process.exitCode = 2;
    return;
  }

  // EXECUTE — mid-execution terminal view (pitch-black, functional color only).
  const generatedRoot = resolve(config.generatedRoot);
  const projectRoot = join(generatedRoot, flags.project);
  mkdirSync(projectRoot, { recursive: true });
  const store = new ManifestStore(manifestPathFor(generatedRoot, flags.project), plan.manifest);
  writeFileSync(join(projectRoot, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log('\n--- EXECUTE (skeleton → digest → implementation) ---');
  console.log('Plan ✓ → Review ✓ → Approval ✓ → Execute ● → Debug ○ → Report ○');
  const execEvents: Array<{
    kind: 'read' | 'create' | 'edit';
    path: string;
    detail?: string;
    added?: number;
    removed?: number;
    loc?: number;
  }> = [];
  const { formatActivityPlain } = await import('./tui/execution_view.js');
  const { digest } = await executeProject(store, projectRoot, {
    onActivity: (e) => {
      execEvents.push({ ...e });
      console.log(formatActivityPlain({ ...e }));
    },
  });
  const { summarizeTotals } = await import('./tui/execution_view.js');
  const totals = summarizeTotals(execEvents);
  console.log(`TOTAL  ${totals.files} files changed  +${totals.added} -${totals.removed}`);
  const changedFiles = store.byStatus('implemented');
  console.log(`Implemented: ${changedFiles.join(', ')}`);
  console.log('✓ Generate file manifest');
  console.log(`✓ Skeleton pass — ${store.list().length} files`);
  console.log(`◐ Implementation pass — ${changedFiles.length} of ${store.list().length} done`);
  console.log('○ Run smoke tests');
  console.log('○ Run regression tests');
  console.log('○ Generate report');

  // DEBUG (+ capped self-loop repair)
  console.log('\n--- DEBUG ---');
  const controller = new LoopController();
  let results: TestResults;
  const risks: string[] = [...review.risks];
  if (flags.smokeOnly) {
    const { existsSync: exists } = await import('node:fs');
    const missing = store.snapshot().files.filter((f) => !exists(join(projectRoot, f.path)));
    results = { ...emptyTestResults(), smoke: missing.length === 0 ? { passed: 1, failed: 0 } : { passed: 0, failed: missing.length } };
    console.log(`smoke-only: ${missing.length === 0 ? 'PASS' : `MISSING ${missing.map((f) => f.path).join(', ')}`} (vitest skipped)`);
  } else {
    results = await runTests({
      braidRoot: BRAID_ROOT,
      projectRoot,
      manifest: store.snapshot(),
      stubs: plan.testStubs,
    });
    if (results.stubs.failed + results.smoke.failed > 0) {
      console.log(`Failures detected — repair loop (max ${controller.maxSelfLoop})...`);
      const priorStubs = { ...results.stubs };
      const repaired = await runRepairLoop({
        controller,
        store,
        digest: digest instanceof DigestStore ? digest : new DigestStore(),
        projectRoot,
        failures: `smoke failed=${results.smoke.failed} stubs failed=${results.stubs.failed}`,
        allowedPaths: store.snapshot().files.map((f) => f.path),
        retest: () => runTests({
          braidRoot: BRAID_ROOT,
          projectRoot,
          manifest: store.snapshot(),
          stubs: plan.testStubs,
          priorStubs,
        }),
      });
      results = repaired.results;
      console.log(`Repair: ${repaired.attempts} attempt(s), converged=${repaired.converged}`);
      if (!repaired.converged) risks.push('self-loop budget exhausted with failing tests');
    }
  }
  console.log(`Tests — smoke ${results.smoke.passed}/${results.smoke.failed}, stubs ${results.stubs.passed}/${results.stubs.failed}`);

  // REPORT + GATE 2
  const report = await generateReport({
    manifest: store.snapshot(),
    testResults: results,
    changedFiles,
    risks,
    requirements: prdToRequirements(prd),
  });
  writeFileSync(join(projectRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const reportSummary = formatReportSummary(report);
  console.log('\n--- REPORT ---\n' + reportSummary);

  const gate2 = flags.autoApprove ? decideGateReport(true) : await promptGateReport(reportSummary);
  if (!gate2.approved) {
    console.log(`\nGate 2: LOOP BACK TO PLAN.\n${gate2.feedback}`);
    writeFileSync(join(projectRoot, 'gate2-feedback.txt'), (gate2.feedback ?? '') + '\n');
    process.exitCode = 3;
  } else {
    console.log('\nDone.');
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  try {
    if (command === 'plan') await cmdPlan(flags);
    else if (command === 'run') await cmdRun(flags);
    else console.log(usage());
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// Only auto-run as the entry point — the REPL imports these without side effects.
if (
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('cli.js'))
) {
  void main();
}

export { cmdPlan, cmdRun, installMock, setMockManifest, parseArgs, readPrd, usage };
export type { Flags };
