/**
 * shared/types.ts — Stable contracts for every Braid module.
 * Defined first so orchestrator, agents, gates, and UI share one schema.
 * Keep this file dependency-free (no imports) for speed and reuse.
 */

// ---------------------------------------------------------------------------
// Manifest — the source of truth for "what must exist"
// ---------------------------------------------------------------------------

export const FILE_STATUSES = [
  'planned',
  'skeleton',
  'implemented',
  'verified',
  'failed',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export interface FileManifestEntry {
  /** Repo-relative posix path, e.g. "src/auth/login.ts" */
  path: string;
  /** Why this file exists (one line, shown in digest + report) */
  purpose: string;
  /** Symbols this file must export (checked by digest + tests) */
  expectedExports: string[];
  /** Repo-relative paths this file may import (full source injected) */
  dependencies: string[];
  status: FileStatus;
}

export interface FileManifest {
  project: string;
  files: FileManifestEntry[];
}

// ---------------------------------------------------------------------------
// Task graph — ordered, dependency-aware breakdown from the Planner
// ---------------------------------------------------------------------------

export interface TaskNode {
  id: string;
  title: string;
  /** Task ids that must complete first */
  dependsOn: string[];
  /** Manifest paths this task produces */
  files: string[];
}

export interface TaskGraph {
  nodes: TaskNode[];
}

// ---------------------------------------------------------------------------
// Test stubs — Planner defines "correct" before code is written
// ---------------------------------------------------------------------------

export interface TestStub {
  /** Where the stub lives inside generated_projects/<project>/ */
  file: string;
  name: string;
  /** Standalone test source (vitest-compatible) */
  code: string;
}

export interface PlanOutput {
  taskGraph: TaskGraph;
  manifest: FileManifest;
  testStubs: TestStub[];
}

// ---------------------------------------------------------------------------
// Review — independent critique, not prose-only
// ---------------------------------------------------------------------------

export interface ReviewOutput {
  critiques: string[];
  risks: string[];
  /** 0 (safe) → 1 (will likely fail) */
  riskScore: number;
}

// ---------------------------------------------------------------------------
// Pipeline state machine
// ---------------------------------------------------------------------------

export const PIPELINE_STATES = [
  'PLAN',
  'REVIEW',
  'GATE_REVIEW',
  'EXECUTE',
  'DEBUG',
  'REPORT',
  'GATE_REPORT',
  'DONE',
] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];

export interface GateDecision {
  approved: boolean;
  /** Required when approved === false; folded into next Planning pass */
  feedback?: string;
}

// ---------------------------------------------------------------------------
// Digest — condensed interface index fed into generation calls
// ---------------------------------------------------------------------------

export interface DigestEntry {
  path: string;
  /** Exported signatures / types (no bodies) */
  signatures: string[];
  docstring: string;
}

export type CodebaseDigest = DigestEntry[];

// ---------------------------------------------------------------------------
// Test results — always from a real runner, never an LLM verdict
// ---------------------------------------------------------------------------

export interface TestBucket {
  passed: number;
  failed: number;
}

export interface TestResults {
  smoke: TestBucket;
  regression: TestBucket;
  stubs: TestBucket;
}

export function emptyTestResults(): TestResults {
  const b = (): TestBucket => ({ passed: 0, failed: 0 });
  return { smoke: b(), regression: b(), stubs: b() };
}

export function totalPassed(r: TestResults): number {
  return r.smoke.passed + r.regression.passed + r.stubs.passed;
}

export function totalFailed(r: TestResults): number {
  return r.smoke.failed + r.regression.failed + r.stubs.failed;
}

// ---------------------------------------------------------------------------
// Report — exact required fields (§5 of spec)
// ---------------------------------------------------------------------------

export type PrdCoverageStatus =
  | 'implemented'
  | 'partial'
  | 'missing'
  | 'failed';

export interface PrdCoverageEntry {
  requirement: string;
  status: PrdCoverageStatus;
  /** Manifest paths evidencing this status */
  files: string[];
}

export interface CycleReport {
  /** % of planned files written and passing (0–100) */
  manifestCompleteness: number;
  testResults: TestResults;
  /** Human-readable summary of what changed this cycle */
  diffSummary: string;
  /** Reviewer/Debugger flags not auto-resolved */
  flaggedRisks: string[];
  prdCoverage: PrdCoverageEntry[];
}

// ---------------------------------------------------------------------------
// Patch proposal — only shape allowed to mutate an existing file
// ---------------------------------------------------------------------------

export interface PatchProposal {
  path: string;
  /** Function name or `// <braid:block name="...">` anchor */
  anchor: string;
  replacement: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Lightweight validators (fast, dependency-free; full zod intentionally
// avoided to keep install + test loop small)
// ---------------------------------------------------------------------------

export function isFileStatus(s: unknown): s is FileStatus {
  return (
    typeof s === 'string' &&
    (FILE_STATUSES as readonly string[]).includes(s)
  );
}

export function validateManifest(m: unknown): asserts m is FileManifest {
  if (typeof m !== 'object' || m === null) throw new Error('manifest must be an object');
  const obj = m as Record<string, unknown>;
  if (typeof obj['project'] !== 'string' || !obj['project']) throw new Error('manifest.project must be a non-empty string');
  if (!Array.isArray(obj['files']) || obj['files'].length === 0)
    throw new Error('manifest.files must be a non-empty array');
  const seen = new Set<string>();
  for (const f of obj['files'] as unknown[]) {
    const e = f as Record<string, unknown>;
    if (typeof e['path'] !== 'string' || !e['path']) throw new Error('manifest entry missing path');
    if (seen.has(e['path'] as string)) throw new Error(`duplicate manifest path: ${e['path']}`);
    seen.add(e['path'] as string);
    if (typeof e['purpose'] !== 'string') throw new Error(`manifest entry ${e['path']}: purpose must be string`);
    if (!Array.isArray(e['expectedExports'])) throw new Error(`manifest entry ${e['path']}: expectedExports must be array`);
    if (!Array.isArray(e['dependencies'])) throw new Error(`manifest entry ${e['path']}: dependencies must be array`);
    if (!isFileStatus(e['status'])) throw new Error(`manifest entry ${e['path']}: invalid status`);
  }
}
