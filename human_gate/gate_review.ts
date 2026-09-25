/**
 * human_gate/gate_review.ts
 * Gate 1: Checkpoint between Review and Execute.
 * Allows human to inspect the plan and review critique, and either approve
 * or provide feedback to revise the plan.
 */
import readline from 'node:readline';
import { GateDecision, PlanOutput, ReviewOutput } from '../shared/types.js';

export type GateReviewHandler = (
  plan: PlanOutput,
  review: ReviewOutput,
) => Promise<GateDecision> | GateDecision;

let customGateHandler: GateReviewHandler | null = null;

/** Set programmatic handler (for UI, tests, or auto-pilot mode). */
export function setGateReviewHandler(handler: GateReviewHandler | null): void {
  customGateHandler = handler;
}

export async function promptGateReview(
  plan: PlanOutput,
  review: ReviewOutput,
): Promise<GateDecision> {
  if (customGateHandler) {
    return await customGateHandler(plan, review);
  }

  // If running in headless/CI environment without TTY
  if (!process.stdin.isTTY) {
    console.log('[gate_review] Non-interactive environment detected. Auto-approving.');
    return { approved: true };
  }

  // Interactive CLI prompt
  console.log('\n================== HUMAN GATE: PLAN REVIEW ==================');
  console.log(`Project: ${plan.manifest.project}`);
  console.log(`Planned Files (${plan.manifest.files.length}):`);
  for (const f of plan.manifest.files) {
    console.log(`  - ${f.path}: ${f.purpose} [exports: ${f.expectedExports.join(', ')}]`);
  }
  console.log(`\nReview Risk Score: ${(review.riskScore * 100).toFixed(1)}%`);
  if (review.critiques.length > 0) {
    console.log('Critiques:');
    review.critiques.forEach((c) => console.log(`  * ${c}`));
  }
  if (review.risks.length > 0) {
    console.log('Risks:');
    review.risks.forEach((r) => console.log(`  ! ${r}`));
  }
  console.log('=============================================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<GateDecision>((resolve) => {
    rl.question('Approve this plan to proceed to execution? (y/n): ', (ans) => {
      const lower = ans.trim().toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        rl.close();
        resolve({ approved: true });
      } else {
        rl.question('Please enter your feedback/revisions for the Planner: ', (feedback) => {
          rl.close();
          resolve({ approved: false, feedback: feedback.trim() });
        });
      }
    });
  });
}
