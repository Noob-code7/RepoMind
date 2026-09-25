/**
 * planning/schemas.ts
 * Strict Zod schemas and TypeScript contracts for the Braid Planning Engine.
 */
import { z } from 'zod';
import { ContextAssessmentSchema } from '../context/schemas.js';

export const RequirementTypeSchema = z.enum([
  'functional',
  'non_functional',
  'constraint',
  'user_flow',
  'technical',
]);
export type RequirementType = z.infer<typeof RequirementTypeSchema>;

export const RequirementSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  type: RequirementTypeSchema.default('functional'),
  acceptanceCriteria: z.array(z.string()).default([]),
  ambiguities: z.array(z.string()).default([]),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const TaskTypeSchema = z.enum([
  'create',
  'modify',
  'delete',
  'test',
  'configuration',
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskPrioritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  type: TaskTypeSchema,
  dependencies: z.array(z.string()).default([]),
  priority: TaskPrioritySchema.default('medium'),
  relatedFiles: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});
export type Task = z.infer<typeof TaskSchema>;

export const ManifestActionSchema = z.enum([
  'create',
  'modify',
  'delete',
  'unchanged',
]);
export type ManifestAction = z.infer<typeof ManifestActionSchema>;

export const ManifestRiskSchema = z.enum(['low', 'medium', 'high']);
export type ManifestRisk = z.infer<typeof ManifestRiskSchema>;

export const ManifestEntrySchema = z.object({
  path: z.string().min(1),
  action: ManifestActionSchema,
  purpose: z.string().min(1),
  relatedTasks: z.array(z.string()).default([]),
  expectedExports: z.array(z.string()).default([]),
  expectedSymbols: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  tests: z.array(z.string()).default([]),
  risk: ManifestRiskSchema.default('low'),
  reasoning: z.string().optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const TestTypeSchema = z.enum([
  'unit',
  'integration',
  'e2e',
  'regression',
  'smoke',
]);
export type TestType = z.infer<typeof TestTypeSchema>;

export const TestSpecificationSchema = z.object({
  id: z.string().min(1),
  target: z.string().min(1),
  type: TestTypeSchema,
  description: z.string().min(1),
  setup: z.string().optional(),
  assertions: z.array(z.string()).min(1),
  relatedRequirements: z.array(z.string()).default([]),
  relatedFiles: z.array(z.string()).default([]),
});
export type TestSpecification = z.infer<typeof TestSpecificationSchema>;

export const RequirementTraceSchema = z.object({
  requirementId: z.string().min(1),
  tasks: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  tests: z.array(z.string()).default([]),
});
export type RequirementTrace = z.infer<typeof RequirementTraceSchema>;

export const ProjectSummarySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  targetStack: z.string().optional(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ArchitecturePlanSchema = z.object({
  overview: z.string(),
  reusedPatterns: z.array(z.string()).default([]),
  newComponents: z.array(z.string()).default([]),
  dataFlow: z.string(),
});
export type ArchitecturePlan = z.infer<typeof ArchitecturePlanSchema>;

export const PlanRiskSchema = z.object({
  category: z.string(),
  description: z.string(),
  impact: z.enum(['critical', 'high', 'medium', 'low']),
  mitigation: z.string(),
});
export type PlanRisk = z.infer<typeof PlanRiskSchema>;

export const PlanningResultSchema = z.object({
  schemaVersion: z.string().default('1.0.0'),
  runId: z.string(),
  project: ProjectSummarySchema,
  requirements: z.array(RequirementSchema),
  context: ContextAssessmentSchema,
  architecture: ArchitecturePlanSchema,
  tasks: z.array(TaskSchema),
  manifest: z.array(ManifestEntrySchema),
  tests: z.array(TestSpecificationSchema),
  traceability: z.array(RequirementTraceSchema),
  risks: z.array(PlanRiskSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
});
export type PlanningResult = z.infer<typeof PlanningResultSchema>;
