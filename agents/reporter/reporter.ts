/**
 * agents/reporter/reporter.ts
 * Generates the per-cycle report containing all exact required fields:
 *  - manifestCompleteness (%)
 *  - testResults (real test bucket pass/fail counts)
 *  - diffSummary (human readable diff)
 *  - flaggedRisks (unresolved risks)
 *  - prdCoverage (mapping requirements to implementation status)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManifestStore } from '../../orchestrator/manifest_store.js';
import { completeJson } from '../../shared/llm_client.js';
import {
  CycleReport,
  FileManifest,
  ReviewOutput,
  TestResults,
} from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ReporterOptions {
  prd: string;
  manifest: FileManifest;
  testResults: TestResults;
  review?: ReviewOutput;
  unresolvedRisks?: string[];
  diffSummary?: string;
}

export async function runReporter(options: ReporterOptions): Promise<CycleReport> {
  const promptPath = path.join(__dirname, 'prompts', 'report_prompt.md');
  const systemPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, 'utf-8')
    : 'You are the Braid Reporter agent. Output JSON { manifestCompleteness, testResults, diffSummary, flaggedRisks, prdCoverage }.';

  // Compute deterministic completeness
  const completeness = ManifestStore.completeness(options.manifest);

  const userPrompt = `ORIGINAL PRD:\n${options.prd}\n\n` +
    `MANIFEST STATUS (${options.manifest.files.length} files, ${completeness}% complete):\n${JSON.stringify(
      options.manifest.files.map((f) => ({ path: f.path, status: f.status, purpose: f.purpose })),
      null,
      2,
    )}\n\n` +
    `REAL TEST RUNNER RESULTS:\n` +
    `Smoke: ${options.testResults.smoke.passed} passed, ${options.testResults.smoke.failed} failed\n` +
    `Regression: ${options.testResults.regression.passed} passed, ${options.testResults.regression.failed} failed\n` +
    `Stubs: ${options.testResults.stubs.passed} passed, ${options.testResults.stubs.failed} failed\n\n` +
    `REVIEW RISKS NOTED:\n${(options.review?.risks || []).join('\n')}\n\n` +
    `Synthesize the cycle report. Output JSON matching the schema.`;

  const output = await completeJson<CycleReport>({
    stage: 'report',
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
  });

  // Guarantee deterministic manifestCompleteness and testResults are preserved
  return {
    manifestCompleteness: completeness,
    testResults: options.testResults,
    diffSummary: output.diffSummary || options.diffSummary || 'Codebase generation cycle completed.',
    flaggedRisks: Array.isArray(output.flaggedRisks)
      ? output.flaggedRisks
      : options.unresolvedRisks || [],
    prdCoverage: Array.isArray(output.prdCoverage) ? output.prdCoverage : [],
  };
}

export interface GenerateReportRequest {
  manifest: FileManifest;
  testResults: TestResults;
  changedFiles: string[];
  risks?: string[];
  requirements?: string[];
}

export async function generateReport(
  req: GenerateReportRequest,
): Promise<CycleReport> {
  const prd = (req.requirements || []).join('\n') || 'Requirements coverage report';
  return runReporter({
    prd,
    manifest: req.manifest,
    testResults: req.testResults,
    unresolvedRisks: req.risks,
    diffSummary: `Cycle changed files: ${req.changedFiles.join(', ')}`,
  });
}
