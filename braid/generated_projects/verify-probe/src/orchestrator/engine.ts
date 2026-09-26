import { PipelineState, Manifest, Plan, TaskNode } from './types';
import { generatePlan, PlannerInput, PlannerResult } from '../agents/planner';
import { reviewPlan, ReviewResult, ReviewFinding, Severity } from '../agents/reviewer';
import { executePlan, ExecutionContext, ExecutionResult } from '../agents/executor';
import { runTests, TestConfig, TestRunSummary } from '../verification/runner';
import { triageFailure, FailureTriage, TriageReport } from '../verification/triage';
import { generateReport, PipelineReport, ReportOptions } from '../reporting/reporter';
import { updateDigest, getInterfaceContext, DigestConfig } from '../agents/digest';

type Phase = 'idle' | 'planning' | 'review' | 'executing' | 'verifying' | 'reporting' | 'completed' | 'failed';

interface OrchestratorState {
  phase: Phase;
  goal: string | null;
  plan: Plan | null;
  manifest: Manifest | null;
  reviewResult: ReviewResult | null;
  executionResults: ExecutionResult[];
  testSummary: TestRunSummary | null;
  triageReport: TriageReport | null;
  report: PipelineReport | null;
  error: Error | null;
  retryCount: number;
  currentTaskIndex: number;
}

const INITIAL_STATE: OrchestratorState = {
  phase: 'idle',
  goal: null,
  plan: null,
  manifest: null,
  reviewResult: null,
  executionResults: [],
  testSummary: null,
  triageReport: null,
  report: null,
  error: null,
  retryCount: 0,
  currentTaskIndex: 0,
};

function mapPhaseToPipelineState(phase: Phase): PipelineState {
  switch (phase) {
    case 'idle': return 'idle';
    case 'planning': return 'planning';
    case 'review': return 'review';
    case 'executing': return 'executing';
    case 'verifying': return 'verifying';
    case 'reporting': return 'reporting';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
  }
}

export class Orchestrator {
  private state: OrchestratorState;
  private plan: Plan | null;

  constructor() {
    this.state = { ...INITIAL_STATE };
    this.plan = null;
  }

  async initialize(goal: string): Promise<void> {
    this.reset();
    this.state.goal = goal;
    this.state.phase = 'planning';

    const plannerInput: PlannerInput = { goal };
    const plannerResult: PlannerResult = await generatePlan(plannerInput);

    this.state.plan = plannerResult.plan;
    this.state.manifest = plannerResult.manifest;
    this.plan = plannerResult.plan;

    await updateDigest({
      projectRoot: process.cwd(),
      includePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: ['**/node_modules/**', '**/dist/**'],
      maxFileSize: 100000,
    });

    this.state.phase = 'review';
  }

  async step(): Promise<PipelineState> {
    switch (this.state.phase) {
      case 'review':
        return await this.runReview();
      case 'executing':
        return await this.runExecution();
      case 'verifying':
        return await this.runVerification();
      case 'reporting':
        return await this.runReporting();
      case 'idle':
      case 'planning':
      case 'completed':
      case 'failed':
      default:
        return mapPhaseToPipelineState(this.state.phase);
    }
  }

  private async runReview(): Promise<PipelineState> {
    if (!this.state.plan || !this.state.manifest) {
      this.state.phase = 'failed';
      this.state.error = new Error('Plan or manifest not available for review');
      return 'failed';
    }

    this.state.reviewResult = await reviewPlan(this.state.plan, this.state.manifest);

    const hasBlockingIssues = this.state.reviewResult.findings.some(
      (f: ReviewFinding) => f.severity === 'critical' || f.severity === 'high'
    );

    if (hasBlockingIssues) {
      this.state.phase = 'failed';
      this.state.error = new Error('Review found blocking issues');
      return 'failed';
    }

    this.state.phase = 'executing';
    this.state.currentTaskIndex = 0;
    return 'executing';
  }

  private async runExecution(): Promise<PipelineState> {
    if (!this.state.plan || !this.state.manifest) {
      this.state.phase = 'failed';
      this.state.error = new Error('Plan or manifest not available for execution');
      return 'failed';
    }

    const context: ExecutionContext = {
      plan: this.state.plan,
      manifest: this.state.manifest,
      taskIndex: this.state.currentTaskIndex,
      previousResults: this.state.executionResults,
    };

    const result = await executePlan(context);
    this.state.executionResults.push(result);

    if (!result.success) {
      this.state.phase = 'failed';
      this.state.error = result.error ?? new Error('Task execution failed');
      return 'failed';
    }

    this.state.currentTaskIndex++;

    if (this.state.currentTaskIndex >= this.state.plan.tasks.length) {
      this.state.phase = 'verifying';
      return 'verifying';
    }

    return 'executing';
  }

  private async runVerification(): Promise<PipelineState> {
    if (!this.state.manifest) {
      this.state.phase = 'failed';
      this.state.error = new Error('Manifest not available for verification');
      return 'failed';
    }

    const testConfig: TestConfig = {
      projectRoot: process.cwd(),
      manifest: this.state.manifest,
      timeout: 120000,
    };

    this.state.testSummary = await runTests(testConfig);

    if (this.state.testSummary.failed > 0) {
      this.state.triageReport = await triageFailure({
        testSummary: this.state.testSummary,
        manifest: this.state.manifest,
        executionResults: this.state.executionResults,
      });

      if (this.state.triageReport.category === 'flaky' && this.state.retryCount < 2) {
        this.state.retryCount++;
        this.state.phase = 'executing';
        this.state.currentTaskIndex = 0;
        this.state.executionResults = [];
        return 'executing';
      }

      this.state.phase = 'failed';
      this.state.error = new Error(`Tests failed: ${this.state.triageReport.summary}`);
      return 'failed';
    }

    this.state.phase = 'reporting';
    return 'reporting';
  }

  private async runReporting(): Promise<PipelineState> {
    if (!this.state.plan || !this.state.manifest || !this.state.testSummary) {
      this.state.phase = 'failed';
      this.state.error = new Error('Missing data for report generation');
      return 'failed';
    }

    const reportOptions: ReportOptions = {
      plan: this.state.plan,
      manifest: this.state.manifest,
      executionResults: this.state.executionResults,
      testSummary: this.state.testSummary,
      triageReport: this.state.triageReport ?? undefined,
      format: 'markdown',
    };

    this.state.report = await generateReport(reportOptions);
    this.state.phase = 'completed';
    return 'completed';
  }

  getState(): PipelineState {
    return mapPhaseToPipelineState(this.state.phase);
  }

  getPlan(): Plan | null {
    return this.state.plan;
  }

  getManifest(): Manifest | null {
    return this.state.manifest;
  }

  async handleFailure(error: Error): Promise<'retry' | 'abort' | 'rollback'> {
    this.state.error = error;

    if (this.state.phase === 'executing' && this.state.retryCount < 3) {
      this.state.retryCount++;
      this.state.phase = 'executing';
      return 'retry';
    }

    if (this.state.phase === 'verifying' && this.state.triageReport?.category === 'flaky') {
      this.state.retryCount++;
      this.state.phase = 'executing';
      this.state.currentTaskIndex = 0;
      this.state.executionResults = [];
      return 'retry';
    }

    if (this.state.phase === 'review' || this.state.phase === 'planning') {
      return 'abort';
    }

    return 'rollback';
  }

  reset(): void {
    this.state = { ...INITIAL_STATE };
    this.plan = null;
  }
}
