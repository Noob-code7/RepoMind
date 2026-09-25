/**
 * review/review_engine.ts
 * Independent Plan Review Engine: systematically critiques the generated plan
 * against the PRD, repository context, task DAG, manifest, and test specifications.
 */
import { RepositoryContext } from '../context/schemas.js';
import { PlanningResult } from '../planning/schemas.js';
import { LLMProvider } from '../providers/llm_provider.js';
import { ReviewResult, ReviewResultSchema } from './schemas.js';

import { ContextMap } from '../context/schemas.js';

export interface ReviewPlanOptions {
  prd: string;
  context: RepositoryContext;
  plan: PlanningResult;
  reviewer: LLMProvider;
  contextMap?: ContextMap;
}

export async function reviewPlan(
  options: ReviewPlanOptions,
): Promise<ReviewResult> {
  const { prd, context, plan, reviewer, contextMap } = options;

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
9. Context Map Alignment: Check if planned files align with Context Map, if existing tests were missed, or if context gaps make the plan risky.

STATUS CRITERIA:
- "approved": 0 critical/high findings, clean coverage, acceptable risk.
- "needs_revision": 1+ high or medium findings that can be fixed with revision instructions.
- "blocked": Critical architectural violation, incompatible stack, or fatal unresolvable ambiguity.
`;

  const contextMapBlock = contextMap
    ? [
        `=== BRAID CONTEXT MAP ===`,
        `Confidence: ${Math.round(contextMap.confidence * 100)}%`,
        `Relevant Files: ${contextMap.relevantFiles.join(', ')}`,
        `Associated Tests: ${contextMap.affectedTests.join(', ')}`,
        `Context Gaps: ${contextMap.contextGaps.map((g) => `[${g.type}] in ${g.affectedArea}: ${g.description}`).join('; ') || 'None'}`,
      ].join('\n')
    : '';

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
    contextMapBlock ? `${contextMapBlock}\n` : '',
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

  // Context-Aware Deterministic Checks (Augment findings with Context Map)
  if (contextMap) {
    const plannedFiles = new Set(plan.manifest.map((m) => m.path));
    const modifiedFiles = plan.manifest.filter((m) => m.action === 'modify').map((m) => m.path);

    // Check 1: Existing tests covering modified files omitted from plan
    for (const modFile of modifiedFiles) {
      const stem = modFile.replace(/\.(ts|js|tsx|jsx)$/, '').split('/').pop() || '';
      for (const testFile of contextMap.affectedTests) {
        if (testFile.includes(stem)) {
          const testInManifest = plannedFiles.has(testFile);
          const testInSpecs = plan.tests.some((t) => t.target === testFile || t.target === modFile);
          if (!testInManifest && !testInSpecs) {
            const alreadyFlagged = review.findings.some((f) => f.affectedFiles?.includes(testFile));
            if (!alreadyFlagged) {
              review.findings.push({
                id: `RISK-${String(review.findings.length + 1).padStart(3, '0')}`,
                severity: 'medium',
                category: 'testing',
                title: `Unupdated test suite for modified file: ${modFile}`,
                explanation: `The plan modifies "${modFile}", but Context Map shows "${testFile}" covers the affected module. The plan does not include updating this test.`,
                affectedTasks: plan.tasks.filter((t) => t.relatedFiles.includes(modFile)).map((t) => t.id),
                affectedFiles: [modFile, testFile],
                recommendation: `Include "${testFile}" in manifest with action "modify" and specify updated regression assertions.`,
              });
            }
          }
        }
      }
    }

    // Check 2: Planned file completely unrelated to PRD and Context Map
    for (const pf of plannedFiles) {
      if (
        !contextMap.relevantFiles.includes(pf) &&
        !contextMap.affectedTests.includes(pf) &&
        !pf.startsWith('src/core/') &&
        !pf.endsWith('index.ts') &&
        contextMap.relevantFiles.length > 0
      ) {
        const alreadyFlagged = review.findings.some((f) => f.affectedFiles?.includes(pf));
        if (!alreadyFlagged) {
          review.findings.push({
            id: `WARN-${String(review.findings.length + 1).padStart(3, '0')}`,
            severity: 'low',
            category: 'architecture',
            title: `Planned file not present in Context Map relevance index: ${pf}`,
            explanation: `The file "${pf}" was targeted in manifest but was not identified as relevant in Context Map. Verify this file is strictly necessary.`,
            affectedTasks: [],
            affectedFiles: [pf],
            recommendation: `Verify requirement traceability for "${pf}".`,
          });
        }
      }
    }
  }

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

