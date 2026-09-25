/**
 * human_gate/gate_report.ts
 * Gate 2: Human satisfaction gate after the Cycle Report.
 * Human can approve (completes the build) or request changes (triggers an agile loop back to PLAN).
 */
import readline from 'node:readline';
import { CycleReport, GateDecision } from '../shared/types.js';

export type GateReportHandler = (report: CycleReport) => Promise<GateDecision> | GateDecision;

let customReportGateHandler: GateReportHandler | null = null;

export function setGateReportHandler(handler: GateReportHandler | null): void {
  customReportGateHandler = handler;
}

export async function promptGateReport(report: CycleReport): Promise<GateDecision> {
  if (customReportGateHandler) {
    return await customReportGateHandler(report);
  }

  // Non-interactive fallback
  if (!process.stdin.isTTY) {
    console.log('[gate_report] Non-interactive environment detected. Auto-approving.');
    return { approved: true };
  }

  // Interactive CLI prompt
  console.log('\n================== HUMAN GATE: REPORT SATISFACTION ==================');
  console.log(`Manifest Completeness: ${report.manifestCompleteness}%`);
  console.log('Test Results:');
  console.log(`  - Smoke: ${report.testResults.smoke.passed} passed, ${report.testResults.smoke.failed} failed`);
  console.log(`  - Regression: ${report.testResults.regression.passed} passed, ${report.testResults.regression.failed} failed`);
  console.log(`  - Stubs: ${report.testResults.stubs.passed} passed, ${report.testResults.stubs.failed} failed`);
  console.log(`\nDiff Summary:\n${report.diffSummary}\n`);

  if (report.prdCoverage.length > 0) {
    console.log('PRD Coverage:');
    for (const cov of report.prdCoverage) {
      console.log(`  [${cov.status.toUpperCase()}] ${cov.requirement} (files: ${cov.files.join(', ')})`);
    }
  }

  if (report.flaggedRisks.length > 0) {
    console.log('\nFlagged Risks:');
    report.flaggedRisks.forEach((r) => console.log(`  ! ${r}`));
  }
  console.log('====================================================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<GateDecision>((resolve) => {
    rl.question('Are you satisfied with the generated project? (y/n): ', (ans) => {
      const lower = ans.trim().toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        rl.close();
        resolve({ approved: true });
      } else {
        rl.question(
          'Please describe what changes/fixes you want in the next agile cycle: ',
          (feedback) => {
            rl.close();
            resolve({ approved: false, feedback: feedback.trim() });
          },
        );
      }
    });
  });
}
