/**
 * telemetry/summary_view.ts — Plain-text rendering for `braid telemetry --run`.
 * Pure functions only (no I/O, no database): trivially unit-testable.
 */

import type {
  FileGenerationMetrics,
  PrdCoverageMetrics,
  RunSummary,
  StagePerformanceRecord,
  TestMetrics,
} from './analytics_service.js';

export interface RunSummaryInput {
  summary: RunSummary;
  stages: StagePerformanceRecord[];
  tests: TestMetrics | null;
  files: FileGenerationMetrics | null;
  coverage: PrdCoverageMetrics | null;
}

function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  return `${n}%`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

export function formatRunSummaryText(input: RunSummaryInput): string {
  const { summary, stages, tests, files, coverage } = input;
  const lines: string[] = [];

  lines.push(`Run ${summary.runId} — ${summary.projectName} [${summary.status}]`);
  lines.push(
    `  Duration: ${fmtDuration(summary.totalDurationMs)}  ` +
      `Stages: ${summary.stagesCompleted.length > 0 ? summary.stagesCompleted.join(' → ') : 'none'}`,
  );
  lines.push('');

  lines.push('Stages (avg / p90 / max):');
  if (stages.length === 0) {
    lines.push('  no stage metrics recorded');
  } else {
    for (const s of stages) {
      const p90 = s.p90DurationMs === null ? 'n/a' : fmtDuration(s.p90DurationMs);
      lines.push(
        `  ${pad(s.stage, 8)} ${pad(fmtDuration(s.avgDurationMs), 8)} ${pad(p90, 8)} ${pad(fmtDuration(s.maxDurationMs), 8)}` +
          `  x${s.executionsCount}  failures=${s.failuresCount}` +
          (s.modelUsed ? `  ${s.modelUsed}` : ''),
      );
    }
  }
  lines.push('');

  lines.push('Tests:');
  if (!tests) {
    lines.push('  no test metrics recorded');
  } else {
    lines.push(
      `  ${tests.testsPassed} passed / ${tests.testsFailed} failed  (pass rate ${fmtPct(tests.passRatePct)})`,
    );
    lines.push(
      `  smoke ${tests.smoke.passed}/${tests.smoke.failed}  ` +
        `stubs ${tests.stubs.passed}/${tests.stubs.failed}  ` +
        `regression ${tests.regression.passed}/${tests.regression.failed}`,
    );
  }
  lines.push('');

  lines.push('Files:');
  if (!files) {
    lines.push('  no file generation metrics recorded');
  } else {
    lines.push(
      `  planned=${files.filesPlanned} generated=${files.filesGenerated} ` +
        `missing=${files.filesMissing} repaired=${files.filesRepaired}`,
    );
    lines.push(
      `  by phase: skeleton=${files.generationByPhase.skeleton} ` +
        `implementation=${files.generationByPhase.implementation} patch=${files.generationByPhase.patch}`,
    );
    if (files.throughputFilesPerSec !== null) {
      lines.push(`  throughput: ${files.throughputFilesPerSec.toFixed(2)} files/sec`);
    }
  }
  lines.push('');

  const coveragePct = coverage
    ? coverage.coveragePercentage
    : summary.prdCoverage;
  lines.push(
    `PRD coverage: ${fmtPct(coveragePct)}` +
      (coverage ? ` (${coverage.implementedRequirementCount}/${coverage.totalRequirementCount} requirements)` : ''),
  );
  lines.push(`Manifest completeness: ${fmtPct(summary.manifestCompleteness)}`);
  lines.push(`Verification: ${summary.verificationStatus ?? 'n/a'}`);

  return lines.join('\n');
}
