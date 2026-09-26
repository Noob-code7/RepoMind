#!/usr/bin/env node
/**
 * cli.ts — Headless Braid pipeline (CLI-first, per master.md §7).
 *   npx tsx cli.ts plan --project demo --prd ./prd.txt [--feedback "..."]
 *   npx tsx cli.ts run  --project demo --prd ./prd.txt [--auto-approve] [--smoke-only]
 *
 * Exit codes: 0 ok · 1 error · 2 rejected at Gate 1 · 3 loop back at Gate 2.
 * Live models only: every stage calls its configured API key. If a call
 * fails, the command fails with the provider error — no offline fallback.
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
import type { TestResults } from './shared/types.js';
import { emptyTestResults } from './shared/types.js';
import { C } from './tui/theme.js';

/** Headless color helper: same reference-chat palette as the TUI, but
 *  plain text when piped (CI-safe). */
// eslint-disable-next-line no-control-regex
function stripCliAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function tty(s: string): string {
  return process.stdout.isTTY ? s : stripCliAnsi(s);
}

/** Reference-style pipeline line for headless logs (TTY-colored, pipe-plain). */
function headlessPipeline(): string {
  const done = (label: string): string => `${C.pipelineGray}${label}${C.reset} ${C.pipelineDone}●${C.reset}`;
  const todo = (label: string): string => `${C.pipelineDim}${label}${C.reset} ${C.pipelineDim}○${C.reset}`;
  const arrow = `${C.pipelineDim} → ${C.reset}`;
  return tty(
    [done('Plan'), done('Review'), done('Approval'), done('Execute'), todo('Debug'), todo('Report')].join(arrow),
  );
}

const BRAID_ROOT = dirname(fileURLToPath(import.meta.url));

interface Flags {
  project: string;
  prd: string;
  feedback?: string;
  autoApprove: boolean;
  smokeOnly: boolean;
}

function usage(): string {
  return [
    'Braid — autonomous SDLC agent (headless CLI)',
    '',
    '  npx tsx cli.ts plan --project <name> --prd <file> [--feedback "..."]',
    '  npx tsx cli.ts run  --project <name> --prd <file> [--auto-approve] [--smoke-only]',
    '',
    'Flags:',
    '  --project <name>   output folder under generated_projects/<name>',
    '  --prd <file>       path to the PRD text file',
    '  --feedback <text>  prior gate feedback, folded into (re-)planning',
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

function prdToRequirements(prd: string): string[] {
  return prd.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20);
}

async function cmdPlan(flags: Flags): Promise<void> {
  if (!flags.project) throw new Error('Missing --project <name>');
  const prd = readPrd(flags.prd);
  const plan = await planProject({ project: flags.project, prd, feedback: flags.feedback });

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

  // PLAN + REVIEW
  const plan = await planProject({ project: flags.project, prd, feedback: flags.feedback });
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

  // EXECUTE — reference-chat colors (TTY) / plain when piped.
  const generatedRoot = resolve(config.generatedRoot);
  const projectRoot = join(generatedRoot, flags.project);
  mkdirSync(projectRoot, { recursive: true });
  const store = new ManifestStore(manifestPathFor(generatedRoot, flags.project), plan.manifest);
  writeFileSync(join(projectRoot, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(tty(`\n${C.pipelineDim}--- EXECUTE (skeleton → digest → implementation) ---${C.reset}`));
  console.log(headlessPipeline());
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
  console.log(tty(`${C.pipelineDim}TOTAL${C.reset}  ${C.placeholder}${totals.files} files changed${C.reset}  ${C.green}+${totals.added}${C.reset} ${C.red}−${totals.removed}${C.reset}`));
  const changedFiles = store.byStatus('implemented');
  console.log(tty(`${C.userBlue}You${C.reset} ${C.pipelineDim}[build]${C.reset} ${changedFiles.join(', ')}`));
  console.log(tty(`${C.pipelineDone}●${C.reset} ${C.pipelineGray}Generate file manifest${C.reset}`));
  console.log(tty(`${C.pipelineDone}●${C.reset} ${C.pipelineGray}Skeleton pass — ${store.list().length} files${C.reset}`));
  console.log(tty(`${C.amber}◐${C.reset} ${C.body}Implementation pass — ${changedFiles.length} of ${store.list().length} done${C.reset}`));
  console.log(tty(`${C.pipelineDim}○ Run smoke tests${C.reset}`));
  console.log(tty(`${C.pipelineDim}○ Run regression tests${C.reset}`));
  console.log(tty(`${C.pipelineDim}○ Generate report${C.reset}`));

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

export { cmdPlan, cmdRun, parseArgs, readPrd, usage };
export type { Flags };
