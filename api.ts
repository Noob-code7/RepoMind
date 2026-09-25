/**
 * api.ts
 * Clean, modular public API of the Braid AI Planning & Review Engine + Context Mapping subsystem.
 * Exposes core functions for consumption by the downstream Braid CLI / Orchestrator.
 */
import { ContextMapBuilder } from './context/context_map.js';
import { buildRepositoryContext } from './context/mapper.js';
import { ImpactAnalyzer } from './context/impact_analyzer.js';
import { renderContextMap } from './context/renderer.js';
import {
  ContextAssessment,
  ContextEdge,
  ContextEdgeSchema,
  ContextEdgeType,
  ContextEdgeTypeSchema,
  ContextGap,
  ContextImpactAnalysis,
  ContextImpactAnalysisSchema,
  ContextMap,
  ContextMapSchema,
  ContextNode,
  ContextNodeSchema,
  ContextNodeType,
  ContextNodeTypeSchema,
  FileContext,
  RelevantContext,
  RepositoryContext,
  RepositoryContextSchema,
  RequirementContext,
  RequirementContextSchema,
  SymbolContext,
  TestContext,
} from './context/schemas.js';
import { SemanticPlanValidator } from './planning/dag_validator.js';
import { generatePlan } from './planning/planner_engine.js';
import { PrdParser } from './planning/prd_parser.js';
import {
  ManifestEntry,
  PlanningResult,
  PlanningResultSchema,
  Requirement,
  Task,
  TestSpecification,
} from './planning/schemas.js';
import { AnthropicProvider } from './providers/anthropic_provider.js';
import {
  LLMProvider,
  LLMRequest,
} from './providers/llm_provider.js';
import { MockProvider } from './providers/mock_provider.js';
import { OpenAIProvider } from './providers/openai_provider.js';
import { reviewPlan } from './review/review_engine.js';
import {
  revisePlan,
  runPlanningReviewCycle,
} from './review/revision_loop.js';
import {
  FindingCategory,
  FindingSeverity,
  PlanningReviewPackage,
  PlanningReviewPackageSchema,
  ReviewFinding,
  ReviewResult,
  ReviewResultSchema,
  ReviewStatus,
  RiskLevel,
} from './review/schemas.js';

// Re-export core types
export type {
  RepositoryContext,
  FileContext,
  SymbolContext,
  TestContext,
  ContextGap,
  ContextAssessment,
  RelevantContext,
  ContextNode,
  ContextNodeType,
  ContextEdge,
  ContextEdgeType,
  ContextImpactAnalysis,
  ContextMap,
  RequirementContext,
  Requirement,
  Task,
  ManifestEntry,
  TestSpecification,
  PlanningResult,
  ReviewFinding,
  ReviewResult,
  PlanningReviewPackage,
  ReviewStatus,
  RiskLevel,
  FindingSeverity,
  FindingCategory,
  LLMProvider,
  LLMRequest,
};

// Re-export Schemas
export {
  ContextMapSchema,
  ContextNodeSchema,
  ContextNodeTypeSchema,
  ContextEdgeSchema,
  ContextEdgeTypeSchema,
  ContextImpactAnalysisSchema,
  RequirementContextSchema,
};

// Re-export Providers
export {
  OpenAIProvider,
  AnthropicProvider,
  MockProvider,
};

// Re-export Pipelines & Engines
export {
  buildRepositoryContext,
  generatePlan,
  reviewPlan,
  revisePlan,
  runPlanningReviewCycle,
  PrdParser,
  ContextMapBuilder,
  ImpactAnalyzer,
  renderContextMap,
};

// Re-export Orchestrator & Execution Boundary
export {
  PipelineOrchestrator,
  DefaultExecutor,
  MockExecutor,
  planToExecutionManifest,
} from './orchestrator/index.js';
export type {
  ContextWorkflowOptions,
  PlanWorkflowResult,
  ReviewWorkflowResult,
  ApproveWorkflowResult,
  BuildWorkflowResult,
  BraidReportResult,
  ApprovalRecord,
} from './orchestrator/pipeline_orchestrator.js';
export type {
  ExecutionBoundaryResult,
  ExecutorInterface,
  ExecutorOptions,
} from './orchestrator/execution_boundary.js';

/**
 * Validate a ContextMap against Zod schema.
 */
export function validateContextMap(map: unknown): ContextMap {
  return ContextMapSchema.parse(map);
}

/**
 * Validate a PlanningResult against Zod schema and semantic rules.
 */
export function validatePlanningResult(
  plan: unknown,
  context?: RepositoryContext,
): PlanningResult {
  const parsed = PlanningResultSchema.parse(plan);
  const semantic = SemanticPlanValidator.validate(parsed, context);
  if (!semantic.valid) {
    throw new Error(
      `[Braid Validation] Semantic validation failed:\n${semantic.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  return parsed;
}

/**
 * Validate a ReviewResult against Zod schema.
 */
export function validateReviewResult(review: unknown): ReviewResult {
  return ReviewResultSchema.parse(review);
}

/**
 * Validate a RepositoryContext against Zod schema.
 */
export function validateRepositoryContext(context: unknown): RepositoryContext {
  return RepositoryContextSchema.parse(context);
}

/**
 * Validate a complete PlanningReviewPackage.
 */
export function validatePlanningReviewPackage(
  pkg: unknown,
): PlanningReviewPackage {
  return PlanningReviewPackageSchema.parse(pkg);
}

