/** LLM-based interpretation of test failure logs */
import { TestRunSummary, TestResult } from './runner';

/** Failure classification categories */
export type FailureCategory =
  | 'compilation'
  | 'runtime'
  | 'logic'
  | 'dependency'
  | 'flaky'
  | 'infrastructure'
  | 'unknown';

/** Triage result for a single failure */
export interface FailureTriage {
  testName: string;
  category: FailureCategory;
  rootCause: string;
  suggestedFix: string;
  confidence: number;
  relatedFiles: string[];
}

/** Complete triage report */
export interface TriageReport {
  timestamp: Date;
  triagedFailures: FailureTriage[];
  summary: string;
  recommendedActions: string[];
}

/**
 * Analyze test failure logs and classify root causes with suggested fixes.
 * Uses LLM to interpret error output and map to actionable categories.
 */
export async function triageFailure(summary: TestRunSummary): Promise<TriageReport> {
  throw new Error("not implemented");
}
