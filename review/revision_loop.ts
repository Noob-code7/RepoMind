/**
 * review/revision_loop.ts
 * Structured revision loop: Plan v1 → Review → Revision Instructions → Plan v2 → Review.
 * Preserves stable parts of the plan and explicitly addresses review findings.
 */
import { RepositoryContext } from '../context/schemas.js';
import { generatePlan } from '../planning/planner_engine.js';
import { PlanningResult } from '../planning/schemas.js';
import { LLMProvider } from '../providers/llm_provider.js';
import { reviewPlan } from './review_engine.js';
import { PlanningReviewPackage, ReviewResult } from './schemas.js';

export interface RevisePlanOptions {
  prd: string;
  context: RepositoryContext;
  previousPlan: PlanningResult;
  review: ReviewResult;
  planner: LLMProvider;
}

export async function revisePlan(
  options: RevisePlanOptions,
): Promise<PlanningResult> {
  const { prd, context, previousPlan, review, planner } = options;

  const instructions = [
    `REVISION MANDATE FOR AGILE RE-PLANNING:`,
    `Reviewer Status: ${review.status.toUpperCase()}`,
    `Review Summary: ${review.summary}`,
    '',
    `FINDINGS TO RESOLVE:`,
    ...review.findings.map(
      (f, idx) =>
        `${idx + 1}. [${f.severity.toUpperCase()}] ${f.title}: ${f.explanation}\n   Recommendation: ${f.recommendation}`,
    ),
    '',
    `EXPLICIT REVISION INSTRUCTIONS:`,
    ...review.revisionInstructions.map((inst, idx) => `* ${inst}`),
    '',
    `STABILITY RULE: Preserve all existing valid tasks, manifest entries, and tests from Plan v1 that are NOT affected by the findings above.`,
  ].join('\n');

  return await generatePlan({
    prd,
    context,
    planner,
    runId: previousPlan.runId,
    feedback: instructions,
    previousPlan,
  });
}

export interface RunPlanningReviewCycleOptions {
  prd: string;
  context: RepositoryContext;
  planner: LLMProvider;
  reviewer: LLMProvider;
  maxRevisions?: number;
}

/**
 * Execute the full autonomous Plan → Review → Revise cycle until approved or max revisions reached.
 */
export async function runPlanningReviewCycle(
  options: RunPlanningReviewCycleOptions,
): Promise<PlanningReviewPackage> {
  const { prd, context, planner, reviewer, maxRevisions = 2 } = options;

  let currentPlan = await generatePlan({ prd, context, planner });
  let currentReview = await reviewPlan({ prd, context, plan: currentPlan, reviewer });

  let revisionCount = 0;
  while (
    currentReview.status === 'needs_revision' &&
    revisionCount < maxRevisions
  ) {
    revisionCount++;
    console.log(`[revision_loop] Review requested revisions (${revisionCount}/${maxRevisions}). Re-planning...`);

    currentPlan = await revisePlan({
      prd,
      context,
      previousPlan: currentPlan,
      review: currentReview,
      planner,
    });

    currentReview = await reviewPlan({
      prd,
      context,
      plan: currentPlan,
      reviewer,
    });
  }

  const finalStatus =
    currentReview.status === 'approved'
      ? 'ready_for_approval'
      : currentReview.status === 'blocked'
      ? 'blocked'
      : 'needs_revision';

  return {
    plan: currentPlan,
    review: currentReview,
    status: finalStatus,
  };
}
