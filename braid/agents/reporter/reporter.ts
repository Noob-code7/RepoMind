/**
 * agents/reporter/reporter.ts — Per-cycle report. Deterministic core with an
 * LLM summarization pass (stage 'report'); falls back to templates offline.
 * Emits all five required fields (§5): manifestCompleteness, testResults,
 * diffSummary, flaggedRisks, prdCoverage.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeJson } from '../../shared/llm_client.js';
import { statusCompleteness } from '../../orchestrator/manifest_diff.js';
import type {
  CycleReport,
  FileManifest,
  PrdCoverageEntry,
  TestResults,
} from '../../shared/types.js';

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'report_prompt.md',
);

export interface ReportInput {
  manifest: FileManifest;
  testResults: TestResults;
  /** Repo-relative paths written/patched this cycle. */
  changedFiles: string[];
  /** Unresolved flags from Reviewer/Debugger. */
  risks: string[];
  /** Raw PRD requirement lines to map to files. */
  requirements: string[];
}

export function loadReportPrompt(): string {
  return readFileSync(PROMPT_PATH, 'utf8');
}

/** Deterministic fallback: keyword overlap between requirement and path/purpose. */
export function heuristicCoverage(
  manifest: FileManifest,
  requirements: string[],
  failing: boolean,
): PrdCoverageEntry[] {
  return requirements.map((requirement) => {
    const words = requirement.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const files = manifest.files
          .filter((f) =>
            words.some(
              (w) =>
                f.path.toLowerCase().includes(w) ||
                f.purpose.toLowerCase().includes(w),
            ),
          )
          .map((f) => f.path);
    const status = files.length === 0 ? 'missing' : failing ? 'partial' : 'implemented';
    return { requirement, status, files };
  });
}

export function buildDeterministicReport(input: ReportInput): CycleReport {
  const manifestCompleteness = statusCompleteness(input.manifest);
  const failing =
    input.testResults.smoke.failed + input.testResults.stubs.failed > 0;
  return {
    manifestCompleteness,
    testResults: input.testResults,
    diffSummary:
      input.changedFiles.length === 0
        ? 'No files changed this cycle.'
        : `Changed ${input.changedFiles.length} file(s): ${input.changedFiles.join(', ')}. Completeness ${manifestCompleteness.toFixed(1)}%.`,
    flaggedRisks: [...input.risks],
    prdCoverage: heuristicCoverage(input.manifest, input.requirements, failing),
  };
}

/** Full path: LLM summarization, deterministic fallback on any error. */
export async function generateReport(input: ReportInput): Promise<CycleReport> {
  const fallback = buildDeterministicReport(input);
  try {
    const summary = await completeJson<{
      diffSummary?: unknown;
      flaggedRisks?: unknown;
      prdCoverage?: unknown;
    }>({
      stage: 'report',
      systemPrompt: loadReportPrompt(),
      userPrompt: JSON.stringify({
        manifest: input.manifest,
        testResults: input.testResults,
        changedFiles: input.changedFiles,
        risks: input.risks,
        requirements: input.requirements,
      }),
      maxTokens: 3000,
      temperature: 0.2,
    });
    return {
      manifestCompleteness: fallback.manifestCompleteness,
      testResults: input.testResults,
      diffSummary:
        typeof summary.diffSummary === 'string' && summary.diffSummary.trim()
          ? summary.diffSummary
          : fallback.diffSummary,
      flaggedRisks: Array.isArray(summary.flaggedRisks)
        ? (summary.flaggedRisks.filter((r) => typeof r === 'string') as string[])
        : fallback.flaggedRisks,
      prdCoverage: Array.isArray(summary.prdCoverage)
        ? (summary.prdCoverage as PrdCoverageEntry[])
        : fallback.prdCoverage,
    };
  } catch {
    return fallback;
  }
}
