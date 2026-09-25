/**
 * human_gate/gate_report.ts
 * Gate 2: Human satisfaction gate after the Cycle Report.
 * Human can approve (completes the build) or request changes (triggers an agile loop back to PLAN).
 */
import { createInterface } from 'node:readline';
import type { CycleReport, GateDecision, TestResults } from '../shared/types.js';

export type GateReportHandler = (report: CycleReport) => Promise<GateDecision> | GateDecision;

let customReportGateHandler: GateReportHandler | null = null;

export function setGateReportHandler(handler: GateReportHandler | null): void {
  customReportGateHandler = handler;
}

export function decideGateReport(
  approved: boolean,
  feedback?: string,
): GateDecision {
  if (!approved && (!feedback || feedback.trim().length === 0)) {
    throw new Error('[gate_report] feedback is required when rejecting the report');
  }
  return approved
    ? { approved: true }
    : { approved: false, feedback: feedback!.trim() };
}

function totalPassed(t: TestResults): number {
  return t.smoke.passed + t.regression.passed + t.stubs.passed;
}
function totalFailed(t: TestResults): number {
  return t.smoke.failed + t.regression.failed + t.stubs.failed;
}

export function formatReportSummary(report: CycleReport): string {
  const t = report.testResults;
  return [
    `Manifest completeness: ${report.manifestCompleteness.toFixed(1)}%`,
    `Tests: ${totalPassed(t)} passed / ${totalFailed(t)} failed (smoke ${t.smoke.passed}/${t.smoke.failed}, regression ${t.regression.passed}/${t.regression.failed}, stubs ${t.stubs.passed}/${t.stubs.failed})`,
    `Diff: ${report.diffSummary}`,
    `Risks (${report.flaggedRisks.length}):`,
    ...report.flaggedRisks.map((r) => `  ! ${r}`),
    `PRD coverage:`,
    ...report.prdCoverage.map((c) => `  [${c.status}] ${c.requirement} → ${c.files.join(', ') || '—'}`),
  ].join('\n');
}

export async function promptGateReport(
  summaryOrReport: string | CycleReport,
): Promise<GateDecision> {
  if (typeof summaryOrReport !== 'string') {
    if (customReportGateHandler) {
      return await customReportGateHandler(summaryOrReport);
    }
  }

  // Non-interactive fallback
  if (!process.stdin.isTTY) {
    console.log('[gate_report] Non-interactive environment detected. Auto-approving.');
    return { approved: true };
  }

  const summary = typeof summaryOrReport === 'string'
    ? summaryOrReport
    : formatReportSummary(summaryOrReport);

  console.log('\n=== GATE 2: Satisfaction ===\n' + summary + '\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));
  try {
    const answer = (await ask('Satisfied? [y/N]: ')).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') {
      return { approved: true };
    }
    const feedback = (await ask('What must change (required): ')).trim();
    return decideGateReport(false, feedback);
  } finally {
    rl.close();
  }
}
