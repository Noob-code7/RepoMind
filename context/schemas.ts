/**
 * context/schemas.ts
 * Strict Zod schemas and TypeScript types for repository intelligence and context mapping.
 */
import { z } from 'zod';

export const FileTypeSchema = z.enum([
  'source',
  'test',
  'config',
  'documentation',
  'asset',
  'unknown',
]);
export type FileType = z.infer<typeof FileTypeSchema>;

export const FileImportanceSchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
]);
export type FileImportance = z.infer<typeof FileImportanceSchema>;

export const SymbolKindSchema = z.enum([
  'function',
  'class',
  'interface',
  'type',
  'variable',
  'component',
  'route',
  'service',
]);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export const SymbolContextSchema = z.object({
  name: z.string().min(1),
  kind: SymbolKindSchema,
  file: z.string(),
  exported: z.boolean().default(false),
  signature: z.string().optional(),
  docstring: z.string().optional(),
});
export type SymbolContext = z.infer<typeof SymbolContextSchema>;

export const DependencyEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  specifier: z.string(),
  isExternal: z.boolean().default(false),
});
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;

export const FileContextSchema = z.object({
  path: z.string().min(1),
  type: FileTypeSchema,
  language: z.string().optional(),
  size: z.number().nonnegative().optional(),
  exports: z.array(z.string()).default([]),
  imports: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  summary: z.string().optional(),
  importance: FileImportanceSchema.default('medium'),
  relatedFiles: z.array(z.string()).default([]),
});
export type FileContext = z.infer<typeof FileContextSchema>;

export const TestContextSchema = z.object({
  file: z.string(),
  framework: z.string().optional(),
  suites: z.array(z.string()).default([]),
  testCases: z.array(z.string()).default([]),
  assertionsCount: z.number().nonnegative().default(0),
});
export type TestContext = z.infer<typeof TestContextSchema>;

export const ArchitectureSummarySchema = z.object({
  pattern: z.string(),
  layers: z.array(z.string()).default([]),
  entryPoints: z.array(z.string()).default([]),
  dataFlowSummary: z.string(),
});
export type ArchitectureSummary = z.infer<typeof ArchitectureSummarySchema>;

export const ConventionSchema = z.object({
  category: z.string(),
  pattern: z.string(),
  description: z.string(),
  examples: z.array(z.string()).default([]),
});
export type Convention = z.infer<typeof ConventionSchema>;

export const GitContextSchema = z.object({
  branch: z.string().default('unknown'),
  isClean: z.boolean().default(true),
  modifiedFiles: z.array(z.string()).default([]),
  untrackedFiles: z.array(z.string()).default([]),
  recentCommits: z
    .array(
      z.object({
        hash: z.string(),
        message: z.string(),
        author: z.string().optional(),
        date: z.string().optional(),
      }),
    )
    .default([]),
});
export type GitContext = z.infer<typeof GitContextSchema>;

export const RepositoryMetadataSchema = z.object({
  name: z.string(),
  root: z.string(),
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  packageManager: z.string().optional(),
  testFramework: z.string().optional(),
});
export type RepositoryMetadata = z.infer<typeof RepositoryMetadataSchema>;

export const RepositoryContextSchema = z.object({
  repository: RepositoryMetadataSchema,
  files: z.array(FileContextSchema).default([]),
  symbols: z.array(SymbolContextSchema).default([]),
  dependencies: z.array(DependencyEdgeSchema).default([]),
  tests: z.array(TestContextSchema).default([]),
  entryPoints: z.array(z.string()).default([]),
  architecture: ArchitectureSummarySchema,
  conventions: z.array(ConventionSchema).default([]),
  git: GitContextSchema,
});
export type RepositoryContext = z.infer<typeof RepositoryContextSchema>;

export const ContextGapTypeSchema = z.enum([
  'missing_file',
  'unknown_dependency',
  'ambiguous_architecture',
  'missing_test_context',
  'unknown_configuration',
  'insufficient_symbol_information',
  'missing_information',
]);
export type ContextGapType = z.infer<typeof ContextGapTypeSchema>;

export const ContextGapSchema = z.object({
  type: ContextGapTypeSchema,
  description: z.string(),
  affectedArea: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
});
export type ContextGap = z.infer<typeof ContextGapSchema>;

export const ContextConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type ContextConfidence = z.infer<typeof ContextConfidenceSchema>;

export const ContextAssessmentSchema = z.object({
  confidence: ContextConfidenceSchema,
  relevantFiles: z.array(z.string()).default([]),
  ignoredFiles: z.array(z.string()).default([]),
  gaps: z.array(ContextGapSchema).default([]),
  reasoning: z.string(),
});
export type ContextAssessment = z.infer<typeof ContextAssessmentSchema>;

export const RelevantContextSchema = z.object({
  assessment: ContextAssessmentSchema,
  relevantFiles: z.array(FileContextSchema),
  digest: z.string(),
  dependencies: z.array(DependencyEdgeSchema).default([]),
  testContexts: z.array(TestContextSchema).default([]),
});
export type RelevantContext = z.infer<typeof RelevantContextSchema>;
