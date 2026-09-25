/**
 * human_gate/gate_review.ts — Gate 1: approve/revise the plan before any code.
 * Minimal CLI-first flow. No LLM calls. Rejections require feedback,
 * which the orchestrator folds into the next Planning pass.
 */
import { createInterface } from 'node:readline';
import type {
  GateDecision,
  PlanOutput,
  ReviewOutput,
} from '../shared/types.js';

/** Validate + normalize a gate decision (feedback mandatory on reject). */
export function decideGateReview(
  approved: boolean,
  feedback?: string,
): GateDecision {
  if (!approved && (!feedback || feedback.trim().length === 0)) {
    throw new Error('[gate_review] feedback is required when rejecting the plan');
  }
  return approved
    ? { approved: true }
    : { approved: false, feedback: feedback!.trim() };
}

/** Human-readable plan + review summary shown at the gate. */
export function formatPlanSummary(
  plan: PlanOutput,
  review?: ReviewOutput,
): string {
  const lines = [
    `Project: ${plan.manifest.project}`,
    `Files (${plan.manifest.files.length}):`,
    ...plan.manifest.files.map(
      (f) => `  - ${f.path} — ${f.purpose} [${f.expectedExports.join(', ') || 'no exports'}]`,
    ),
    `Tasks (${plan.taskGraph.nodes.length}):`,
    ...plan.taskGraph.nodes.map(
      (t) => `  - ${t.id}: ${t.title} → ${t.files.join(', ')}`,
    ),
    `Test stubs (${plan.testStubs.length}):`,
    ...plan.testStubs.map((s) => `  - ${s.file}: ${s.name}`),
  ];
  if (review) {
    lines.push(
      `Review risks (${review.riskScore.toFixed(2)}):`,
      ...review.risks.map((r) => `  ! ${r}`),
      ...review.critiques.map((c) => `  - ${c}`),
    );
  }
  return lines.join('\n');
}

/** Interactive CLI prompt. Returns the human's decision. */
export async function promptGateReview(
  summary: string,
): Promise<GateDecision> {
  console.log('\n=== GATE 1: Plan Review ===\n' + summary + '\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));
  try {
    const answer = (await ask('Approve plan? [y/N]: ')).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') {
      return { approved: true };
    }
    const feedback = (await ask('Feedback for re-plan (required): ')).trim();
    return decideGateReview(false, feedback);
  } finally {
    rl.close();
  }
}
