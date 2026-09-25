/**
 * review/schemas.ts
 * Strict Zod schemas and TypeScript contracts for the Braid Review Engine.
 */
import { z } from 'zod';
import { PlanningResultSchema } from '../planning/schemas.js';

export const FindingSeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'info',
]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingCategorySchema = z.enum([
  'missing_requirement',
  'missing_file',
  'unnecessary_file',
  'dependency',
  'architecture',
  'duplication',
  'testing',
  'logic_preservation',
  'complexity',
  'ambiguity',
  'security',
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const ReviewFindingSchema = z.object({
  id: z.string().min(1),
  severity: FindingSeveritySchema,
  category: FindingCategorySchema,
  title: z.string().min(1),
  explanation: z.string(),
  affectedTasks: z.array(z.string()).optional().default([]),
  affectedFiles: z.array(z.string()).optional().default([]),
  recommendation: z.string(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewStatusSchema = z.enum([
  'approved',
  'needs_revision',
  'blocked',
]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ReviewResultSchema = z.object({
  runId: z.string(),
  status: ReviewStatusSchema,
  summary: z.string(),
  findings: z.array(ReviewFindingSchema).default([]),
  missingRequirements: z.array(z.string()).default([]),
  missingFiles: z.array(z.string()).default([]),
  unnecessaryFiles: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema.default('low'),
  revisionInstructions: z.array(z.string()).default([]),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const PlanningReviewPackageSchema = z.object({
  plan: PlanningResultSchema,
  review: ReviewResultSchema,
  status: z.enum(['ready_for_approval', 'needs_revision', 'blocked']),
});
export type PlanningReviewPackage = z.infer<typeof PlanningReviewPackageSchema>;
