/** Executes generated stubs and smoke tests */
export class TestRunner {
  /** Creates a new test runner */
  constructor(options?: TestRunnerOptions);

  /** Runs all tests in a project */
  async runAll(projectRoot: string): Promise<TestRunResult>;

  /** Runs tests matching a pattern */
  async runPattern(projectRoot: string, pattern: string): Promise<TestRunResult>;

  /** Runs smoke tests for a specific file */
  async runSmokeTest(filePath: string): Promise<SmokeTestResult>;

  /** Generates test stubs for a file */
  async generateStubs(filePath: string): Promise<string[]>;
}

/** Configuration options for test runner */
export interface TestRunnerOptions {
  timeout?: number;
  parallel?: boolean;
  coverage?: boolean;
  reporter?: "verbose" | "minimal" | "json";
}

/** Result of a test run */
export interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  coverage?: CoverageReport;
  failures: TestFailure[];
}

/** Result of a smoke test */
export interface SmokeTestResult {
  success: boolean;
  output: string;
  errors: string[];
}

/** Individual test failure */
export interface TestFailure {
  test: string;
  message: string;
  stack?: string;
}

/** Code coverage report */
export interface CoverageReport {
  lines: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
}

/** Coverage metric */
export interface CoverageMetric {
  total: number;
  covered: number;
  percentage: number;
}
