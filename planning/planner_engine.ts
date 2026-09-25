/**
 * planning/planner_engine.ts
 * AI Planning Engine: coordinates PRD ingestion, repository context injection,
 * duplication detection, DAG generation, manifest generation, test specifications,
 * and strict semantic validation.
 */
import { CodebaseDigestBuilder } from '../context/digest.js';
import { ContextRelevanceEngine } from '../context/relevance.js';
import { RepositoryContext } from '../context/schemas.js';
import { LLMProvider } from '../providers/llm_provider.js';
import { SemanticPlanValidator } from './dag_validator.js';
import { DuplicationDetector } from './duplication_detector.js';
import { PrdParser } from './prd_parser.js';
import { PlanningResult, PlanningResultSchema } from './schemas.js';

import { ContextMap } from '../context/schemas.js';

export interface GeneratePlanOptions {
  prd: string;
  context: RepositoryContext;
  planner: LLMProvider;
  runId?: string;
  feedback?: string;
  previousPlan?: PlanningResult;
  contextMap?: ContextMap;
}

export async function generatePlan(
  options: GeneratePlanOptions,
): Promise<PlanningResult> {
  const { prd, context, planner, feedback, contextMap } = options;
  const runId = options.runId || `braid_${Date.now()}`;

  // 1. Ingest and parse PRD
  const parsedPrd = PrdParser.parse(prd);

  // 2. Analyze repository relevance & context gaps (reuse ContextMap if provided)
  const relevantContext = ContextRelevanceEngine.analyzeRelevance(prd, context);

  // 3. Build compact codebase digest
  const digest = CodebaseDigestBuilder.buildDigest(context);

  // 4. Detect duplication & reuse opportunities
  const reuseOpportunities = DuplicationDetector.detectOpportunities(prd, context);

  // 5. Construct Prompts
  const systemPrompt = `# Braid Planning Engine
You are the Planning Engine of Braid, an autonomous multi-model SDLC orchestrator.
Your mission is to generate a comprehensive, repository-aware architectural build plan.

CRITICAL RULES:
1. REUSE EXISTING ARCHITECTURE: Distinguish between "create" and "modify".
   - If a file already exists in the repository, you MUST set action: "modify".
   - Only set action: "create" for genuinely new files.
   - Reuse existing utilities and services rather than generating duplicates.
2. NO CIRCULAR DEPENDENCIES: The task graph must be a strict Directed Acyclic Graph (DAG).
3. EXPLICIT MANIFEST: Declare EVERY file to be created, modified, or deleted. No file may exist without a dedicated task and requirement.
4. TEST SPECIFICATIONS BEFORE CODE: Define concrete test specifications with actionable assertions for every major requirement.
5. TRACEABILITY: Map Requirement → Task → File → Test explicitly.
6. CONTEXT AWARENESS: Explicitly state why files are modified vs created in the reasoning field.
`;

  // Build Context Map section for prompt
  const contextMapPrompt = contextMap
    ? [
        `=== BRAID CONTEXT MAP (Confidence: ${Math.round(contextMap.confidence * 100)}%) ===`,
        `Relevant Files (${contextMap.relevantFiles.length}):`,
        contextMap.relevantFiles
          .map((f) => {
            const syms = contextMap.nodes
              .filter((n) => n.type === 'symbol' && n.path === f)
              .map((n) => n.name)
              .slice(0, 4);
            return `- ${f} (symbols: ${syms.join(', ') || 'none'})`;
          })
          .join('\n'),
        '',
        `Dependency Relationships (${contextMap.edges.length}):`,
        contextMap.edges
          .slice(0, 10)
          .map((e) => `- ${e.source} --[${e.type}]--> ${e.target}`)
          .join('\n'),
        '',
        `Associated Tests (${contextMap.affectedTests.length}):`,
        contextMap.affectedTests.map((t) => `- ${t}`).join('\n') || '(None)',
        '',
        `Context Gaps (${contextMap.contextGaps.length}):`,
        contextMap.contextGaps.length > 0
          ? contextMap.contextGaps.map((g) => `! [${g.type}] in ${g.affectedArea}: ${g.description}`).join('\n')
          : '(No context gaps detected)',
      ].join('\n')
    : '';

  const userPrompt = [
    `RUN ID: ${runId}`,
    `PROJECT NAME: ${context.repository.name}`,
    '',
    `=== PRODUCT REQUIREMENTS DOCUMENT (PRD) ===`,
    prd,
    '',
    `=== EXTRACTED REQUIREMENTS (${parsedPrd.requirements.length}) ===`,
    JSON.stringify(parsedPrd.requirements, null, 2),
    '',
    `=== REPOSITORY CONTEXT & DIGEST ===`,
    digest,
    '',
    `=== RELEVANT REPOSITORY FILES (${relevantContext.relevantFiles.length}) ===`,
    relevantContext.relevantFiles
      .map((f) => `- ${f.path} (${f.importance} importance, exports: ${f.exports.join(', ') || 'none'})`)
      .join('\n'),
    '',
    `=== CONTEXT GAPS & ASSESSMENT ===`,
    `Confidence: ${relevantContext.assessment.confidence.toUpperCase()}`,
    relevantContext.assessment.gaps.length > 0
      ? relevantContext.assessment.gaps.map((g) => `! [${g.type}] in ${g.affectedArea}: ${g.description}`).join('\n')
      : '(No major context gaps)',
    '',
    contextMapPrompt ? `${contextMapPrompt}\n` : '',
    '',
    `=== REUSE MANDATES (${reuseOpportunities.length}) ===`,
    reuseOpportunities.length > 0
      ? reuseOpportunities.map((o) => `* ${o.recommendation}`).join('\n')
      : '(No duplicate conflicts detected)',
    '',
    feedback
      ? `=== CRITICAL REVISION INSTRUCTIONS FROM REVIEWER ===\n${feedback}\nYou MUST update the plan to directly resolve these findings while preserving unchanged stable sections.\n`
      : '',
    'Generate the complete PlanningResult strictly adhering to the schema. Output JSON only.',
  ].join('\n');

  // 6. Call LLM with Strict Zod Validation
  let plan = await planner.generateStructured<PlanningResult>(
    {
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 8192,
    },
    PlanningResultSchema,
  );

  // Guarantee runId and context match
  plan.runId = runId;
  plan.context = relevantContext.assessment;

  // 7. Semantic Validation
  const semantic = SemanticPlanValidator.validate(plan, context);
  if (!semantic.valid) {
    console.warn(`[planner_engine] Semantic validation issues detected, requesting repair...`, semantic.errors);

    const repairPrompt = [
      userPrompt,
      '',
      `[CRITICAL SEMANTIC VALIDATION FAILURES]:`,
      semantic.errors.map((e) => `- ${e}`).join('\n'),
      '',
      `Please fix these semantic errors in the task graph, manifest, or traceability and return the valid JSON.`,
    ].join('\n');

    plan = await planner.generateStructured<PlanningResult>(
      {
        systemPrompt,
        userPrompt: repairPrompt,
        temperature: 0.1,
        maxTokens: 8192,
      },
      PlanningResultSchema,
    );

    plan.runId = runId;
    plan.context = relevantContext.assessment;
  }

  return plan;
}
