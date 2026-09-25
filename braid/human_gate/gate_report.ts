/**
 * human_gate/gate_report.ts — Gate 2: approve or loop after the cycle report.
 * Unsatisfied → agile loop back to PLAN with feedback folded into re-plan.
 */
import { createInterface } from 'node:readline';
import type { CycleReport, GateDecision } from '../shared/types.js';
import { totalFailed, totalPassed } from '../shared/types.js';

export function decideGateReport(
  approved: boolean,
  feedback?: string,
): GateDecision {
  if (!approved && (!feedback || feedback.trim().length === 0)) {
    throw new Error('[gate_report] feedback is required to loop back to PLAN');
  }
  return approved
    ? { approved: true }
    : { approved: false, feedback: feedback!.trim() };
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
  summary: string,
): Promise<GateDecision> {
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
