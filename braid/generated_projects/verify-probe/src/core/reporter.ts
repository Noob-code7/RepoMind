import { ManifestManager, PlannedFileEntry } from "../core/manifest";

/** Generates PRD coverage and test pass rate reports */
export class Reporter {
  /** Creates a new reporter */
  constructor(manifest: ManifestManager);

  /** Generates PRD coverage report */
  generateCoverageReport(): Promise<CoverageReport>;

  /** Generates test pass rate report */
  generateTestReport(testResults: TestRunResult): Promise<TestReport>;

  /** Generates combined dashboard report */
  generateDashboard(): Promise<DashboardReport>;

  /** Exports report in specified format */
  exportReport(report: Report, format: "markdown" | "json" | "html"): string;
}

/** PRD coverage report */
export interface CoverageReport {
  totalPlanned: number;
  totalWritten: number;
  totalVerified: number;
  coverageByStage: Record<string, StageCoverage>;
  missingFiles: PlannedFileEntry[];
}

/** Coverage for a pipeline stage */
export interface StageCoverage {
  planned: number;
  written: number;
  percentage: number;
}

/** Test pass rate report */
export interface TestReport {
  overallPassRate: number;
  byFile: Record<string, FileTestResult>;
  flakyTests: string[];
}

/** Test results for a single file */
export interface FileTestResult {
  passed: number;
  failed: number;
  passRate: number;
}

/** Combined dashboard report */
export interface DashboardReport {
  coverage: CoverageReport;
  tests: TestReport;
  timestamp: Date;
  pipelineHealth: "healthy" | "degraded" | "critical";
}

/** Generic report type */
export type Report = CoverageReport | TestReport | DashboardReport;

import { TestRunResult } from "../core/test-runner";
