/**
 * review/review_engine.ts
 * Independent Plan Review Engine: systematically critiques the generated plan
 * against the PRD, repository context, task DAG, manifest, and test specifications.
 */
import { RepositoryContext } from '../context/schemas.js';
import { PlanningResult } from '../planning/schemas.js';
import { LLMProvider } from '../providers/llm_provider.js';
import { ReviewResult, ReviewResultSchema } from './schemas.js';

export interface ReviewPlanOptions {
  prd: string;
  context: RepositoryContext;
  plan: PlanningResult;
  reviewer: LLMProvider;
}

export async function reviewPlan(
  options: ReviewPlanOptions,
): Promise<ReviewResult> {
  const { prd, context, plan, reviewer } = options;

  const systemPrompt = `# Braid Independent Plan Review Engine
You are an independent, adversarial Software Architect whose sole responsibility is to find flaws, missing requirements, duplication, and architectural risks in a proposed Braid build plan.

DO NOT rubber-stamp the plan. Challenge every assumption.

REVIEW CHECKS YOU MUST PERFORM:
1. Requirement Coverage: Are all PRD requirements mapped to concrete tasks and files?
2. Missing Files: Did the planner miss any existing file that will inevitably need changes?
3. Unnecessary Files: Did the planner invent generic or tutorial files that shouldn't exist?
4. Dependency Errors: Are dependencies correct in the task graph?
5. Architecture & Duplication: Does the plan duplicate existing utilities, services, or models in the repository?
6. Test Gaps: Are any critical workflows or regressions untested?
7. Logic Preservation: Could existing working functionality break without safe migration?
8. Complexity: Is the solution over-engineered?

STATUS CRITERIA:
- "approved": 0 critical/high findings, clean coverage, acceptable risk.
- "needs_revision": 1+ high or medium findings that can be fixed with revision instructions.
- "blocked": Critical architectural violation, incompatible stack, or fatal unresolvable ambiguity.
`;

  const userPrompt = [
    `RUN ID: ${plan.runId}`,
    `PROJECT: ${plan.project.name}`,
    '',
    `=== ORIGINAL PRD ===`,
    prd,
    '',
    `=== REPOSITORY ARCHITECTURE & CONTEXT ===`,
    `Frameworks: ${context.repository.frameworks.join(', ') || 'TypeScript'}`,
    `Architecture Pattern: ${context.architecture.pattern}`,
    `Existing Files (${context.files.length}):`,
    context.files.slice(0, 30).map((f) => `- ${f.path} (${f.type}, exports: ${f.exports.join(', ') || 'none'})`).join('\n'),
    '',
    `=== PROPOSED PLAN FOR REVIEW ===`,
    `Tasks (${plan.tasks.length}):`,
    JSON.stringify(
      plan.tasks.map((t) => ({ id: t.id, title: t.title, deps: t.dependencies, files: t.relatedFiles })),
      null,
      2,
    ),
    '',
    `Manifest Entries (${plan.manifest.length}):`,
    JSON.stringify(
      plan.manifest.map((m) => ({ path: m.path, action: m.action, purpose: m.purpose, reasoning: m.reasoning })),
      null,
      2,
    ),
    '',
    `Test Specifications (${plan.tests.length}):`,
    JSON.stringify(
      plan.tests.map((t) => ({ id: t.id, target: t.target, assertions: t.assertions })),
      null,
      2,
    ),
    '',
    `Traceability Mapping (${plan.traceability.length}):`,
    JSON.stringify(plan.traceability, null, 2),
    '',
    'Analyze the plan thoroughly and output your structured critique conforming strictly to the ReviewResult schema.',
  ].join('\n');

  const review = await reviewer.generateStructured<ReviewResult>(
    {
      systemPrompt,
      userPrompt,
      temperature: 0.1,
      maxTokens: 4096,
    },
    ReviewResultSchema,
  );

  review.runId = plan.runId;

  // Enforce status consistency with findings severity
  const hasCritical = review.findings.some((f) => f.severity === 'critical');
  const hasHigh = review.findings.some((f) => f.severity === 'high');

  if (hasCritical) {
    review.status = 'blocked';
    review.riskLevel = 'critical';
  } else if (hasHigh || review.findings.length > 0) {
    if (review.status === 'approved') {
      review.status = 'needs_revision';
    }
  }

  return review;
}
