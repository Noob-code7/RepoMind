/**
 * orchestrator/state_machine.ts
 * Deterministic pipeline state machine driving:
 *   PLAN → REVIEW → GATE_REVIEW → EXECUTE → DEBUG → REPORT → GATE_REPORT → DONE (or loop)
 * NO LLM calls live in this file — it acts as the deterministic coordinator.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runFailureTriage } from '../agents/debugger/failure_triage.js';
import { TestExecutionOutput, TestRunner } from '../agents/debugger/test_runner.js';
import { runExecutor } from '../agents/executor/executor.js';
import { runPlanner } from '../agents/planner/planner.js';
import { runReporter } from '../agents/reporter/reporter.js';
import { runReviewer } from '../agents/reviewer/reviewer.js';
import { promptGateReport } from '../human_gate/gate_report.js';
import { promptGateReview } from '../human_gate/gate_review.js';
import { config } from '../shared/config.js';
import {
  CycleReport,
  GateDecision,
  PIPELINE_STATES,
  PipelineState,
  PlanOutput,
  ReviewOutput,
  TestResults,
  emptyTestResults,
} from '../shared/types.js';
import { LoopController } from './loop_controller.js';
import { ManifestStore } from './manifest_store.js';

export interface BraidPipelineOptions {
  prd: string;
  projectName?: string;
  projectRoot?: string;
  autoApprove?: boolean;
}

export type StateListener = (state: PipelineState, payload?: unknown) => void;

export class BraidStateMachine {
  public currentState: PipelineState = 'PLAN';
  public readonly prd: string;
  public readonly projectName: string;
  public readonly projectRoot: string;
  public readonly loopController: LoopController;

  public plan: PlanOutput | null = null;
  public review: ReviewOutput | null = null;
  public testExecution: TestExecutionOutput | null = null;
  public report: CycleReport | null = null;
  public lastFeedback: string | undefined = undefined;

  private listeners: StateListener[] = [];

  constructor(options: BraidPipelineOptions) {
    this.prd = options.prd;
    this.projectName = options.projectName || 'braid_app';
    this.projectRoot =
      options.projectRoot ||
      path.resolve(config.generatedRoot, this.projectName);
    this.loopController = new LoopController(config.maxSelfLoopIterations);

    if (!fs.existsSync(this.projectRoot)) {
      fs.mkdirSync(this.projectRoot, { recursive: true });
    }
  }

  public onTransition(listener: StateListener): void {
    this.listeners.push(listener);
  }

  private transitionTo(state: PipelineState, payload?: unknown): void {
    this.currentState = state;
    this.loopController.recordEvent(state, `Transitioned to ${state}`, payload as Record<string, unknown>);
    for (const listener of this.listeners) {
      try {
        listener(state, payload);
      } catch (err) {
        console.error('[state_machine] Listener error:', err);
      }
    }
  }

  /**
   * Run the complete pipeline until DONE or unapproved exit.
   */
  public async run(): Promise<CycleReport> {
    console.log(`\n========================================================`);
    console.log(`🚀 BRAID PIPELINE START: ${this.projectName}`);
    console.log(`📁 Target Directory: ${this.projectRoot}`);
    console.log(`========================================================\n`);

    while (this.currentState !== 'DONE') {
      switch (this.currentState) {
        case 'PLAN': {
          console.log(`\n[Stage 1/7] PLAN (Agile Cycle #${this.loopController.agileCycle})`);
          this.plan = await runPlanner({
            prd: this.prd,
            projectName: this.projectName,
            feedback: this.lastFeedback,
          });
          ManifestStore.save(this.projectRoot, this.plan.manifest);
          this.transitionTo('REVIEW', this.plan);
          break;
        }

        case 'REVIEW': {
          console.log('\n[Stage 2/7] REVIEW (Independent Model Critique)');
          if (!this.plan) throw new Error('Missing plan in REVIEW stage');
          this.review = await runReviewer(this.prd, this.plan);
          this.transitionTo('GATE_REVIEW', this.review);
          break;
        }

        case 'GATE_REVIEW': {
          console.log('\n[Stage 3/7] GATE_REVIEW (Human Approval Gate 1)');
          if (!this.plan || !this.review) {
            throw new Error('Incomplete data for GATE_REVIEW');
          }
          const decision: GateDecision = await promptGateReview(this.plan, this.review);
          if (decision.approved) {
            this.lastFeedback = undefined;
            this.transitionTo('EXECUTE', { approved: true });
          } else {
            console.log(`[gate_review] Revisions requested: "${decision.feedback}"`);
            this.lastFeedback = decision.feedback;
            this.transitionTo('PLAN', { revised: true, feedback: decision.feedback });
          }
          break;
        }

        case 'EXECUTE': {
          console.log('\n[Stage 4/7] EXECUTE (Chunked Two-Pass Generation)');
          if (!this.plan) throw new Error('Missing plan in EXECUTE stage');
          const execResult = await runExecutor(this.projectRoot, this.plan.manifest);
          this.transitionTo('DEBUG', execResult);
          break;
        }

        case 'DEBUG': {
          console.log('\n[Stage 5/7] DEBUG (Deterministic Test Runner & Self-Loop)');
          if (!this.plan) throw new Error('Missing plan in DEBUG stage');

          // Initial test execution
          this.testExecution = await TestRunner.runTests(
            this.projectRoot,
            this.plan.manifest,
            this.plan.testStubs,
          );

          // Self-loop ("Relf") repair cycle
          while (
            this.testExecution.failures.length > 0 &&
            this.loopController.canSelfLoop()
          ) {
            const attempt = this.loopController.recordSelfLoop(
              `${this.testExecution.failures.length} failures detected`,
            );
            console.log(
              `\n[debug] Initiating automated self-repair loop (${attempt}/${this.loopController.maxSelfLoops})...`,
            );

            // LLM triage proposes targeted patches via AST patcher
            await runFailureTriage(
              this.projectRoot,
              this.plan.manifest,
              this.testExecution.failures,
            );

            // Re-run tests deterministically
            this.testExecution = await TestRunner.runTests(
              this.projectRoot,
              this.plan.manifest,
              this.plan.testStubs,
            );
          }

          this.transitionTo('REPORT', this.testExecution);
          break;
        }

        case 'REPORT': {
          console.log('\n[Stage 6/7] REPORT (Per-Cycle Synthesis)');
          if (!this.plan) throw new Error('Missing plan in REPORT stage');

          const testResults: TestResults =
            this.testExecution?.results ?? emptyTestResults();

          this.report = await runReporter({
            prd: this.prd,
            manifest: this.plan.manifest,
            testResults,
            review: this.review || undefined,
            unresolvedRisks: this.testExecution?.failures.map((f) => f.errorOutput),
          });

          this.transitionTo('GATE_REPORT', this.report);
          break;
        }

        case 'GATE_REPORT': {
          console.log('\n[Stage 7/7] GATE_REPORT (Human Satisfaction Gate 2)');
          if (!this.report) throw new Error('Missing report in GATE_REPORT stage');

          const decision = await promptGateReport(this.report);
          if (decision.approved) {
            console.log('\n🎉 Project approved! Pipeline complete.');
            this.transitionTo('DONE', { approved: true });
          } else {
            console.log(`\n🔄 Human requested agile iteration: "${decision.feedback}"`);
            this.lastFeedback = decision.feedback;
            this.loopController.startNewAgileCycle(decision.feedback || 'Iterate');
            this.transitionTo('PLAN', { agileLoop: true, feedback: decision.feedback });
          }
          break;
        }
      }
    }

    if (!this.report) throw new Error('Pipeline exited without report');
    return this.report;
  }
}

// Standalone CLI entrypoint if executed directly:
// npm run demo or tsx orchestrator/state_machine.ts
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('state_machine.ts')) {
  const samplePrd = `# Sample Task API PRD
## Goal
Build a lightweight in-memory task manager with authentication and task CRUD.

## Requirements
1. User registration and token generation.
2. In-memory task repository supporting create, list, and complete task.
3. Unit test coverage for auth and task operations.
`;

  const machine = new BraidStateMachine({
    prd: samplePrd,
    projectName: 'sample_task_api',
  });

  // If no API keys are configured, provide offline realistic mocks so demo works out of the box
  import('../shared/config.js').then(({ apiKeyFor }) => {
    import('../shared/llm_client.js').then(({ setMockHandler, hasMockHandler }) => {
      if (!apiKeyFor('plan') && !apiKeyFor('review') && !hasMockHandler()) {
        console.log(
          '💡 [Braid Demo] No API keys detected in environment. Running with realistic offline simulation.\n' +
          '   (Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env to call live LLMs)\n',
        );

        setMockHandler((req) => {
          if (req.stage === 'plan') {
            return JSON.stringify({
              taskGraph: {
                nodes: [
                  { id: 'task-1', title: 'User Authentication', dependsOn: [], files: ['src/auth.ts'] },
                  { id: 'task-2', title: 'Task Store', dependsOn: ['task-1'], files: ['src/tasks.ts'] },
                  { id: 'task-3', title: 'HTTP App', dependsOn: ['task-2'], files: ['src/index.ts'] },
                ],
              },
              manifest: {
                project: 'sample_task_api',
                files: [
                  { path: 'src/auth.ts', purpose: 'JWT auth utilities', expectedExports: ['createToken'], dependencies: [], status: 'planned' },
                  { path: 'src/tasks.ts', purpose: 'In-memory task CRUD repository', expectedExports: ['TaskStore'], dependencies: ['src/auth.ts'], status: 'planned' },
                  { path: 'src/index.ts', purpose: 'Application bootstrap', expectedExports: ['startApp'], dependencies: ['src/tasks.ts'], status: 'planned' },
                ],
              },
              testStubs: [
                {
                  file: 'tests/auth.test.ts',
                  name: 'generates tokens',
                  code: "import { describe, it, expect } from 'vitest';\nimport { createToken } from '../src/auth.js';\ndescribe('auth', () => { it('creates token', () => { expect(createToken('user-1')).toBeDefined(); }); });",
                },
              ],
            });
          }
          if (req.stage === 'review') {
            return JSON.stringify({
              critiques: ['In-memory store will reset on crash; recommend disk/sqlite backing in v2'],
              risks: ['Authentication tokens require secret rotation'],
              riskScore: 0.15,
            });
          }
          if (req.stage === 'execute') {
            if (req.userPrompt.includes('skeletons for the following files')) {
              return JSON.stringify({
                files: {
                  'src/auth.ts': 'export function createToken(userId: string): string;',
                  'src/tasks.ts': 'export class TaskStore { getTasks(): any[]; }',
                  'src/index.ts': 'export function startApp(): void;',
                },
              });
            }
            if (req.userPrompt.includes('src/auth.ts')) {
              return 'export function createToken(userId: string): string {\n  return `token_for_${userId}`;\n}\n';
            }
            if (req.userPrompt.includes('src/tasks.ts')) {
              return 'export class TaskStore {\n  private tasks: any[] = [];\n  getTasks() { return this.tasks; }\n}\n';
            }
            return 'export function startApp(): void {\n  console.log("App ready");\n}\n';
          }
          if (req.stage === 'triage') {
            return JSON.stringify({ summary: 'All tests pass', patches: [] });
          }
          if (req.stage === 'report') {
            return JSON.stringify({
              manifestCompleteness: 100,
              diffSummary: 'Created src/auth.ts, src/tasks.ts, and src/index.ts with 100% manifest completeness.',
              flaggedRisks: ['In-memory store noted for v2 persistent upgrade'],
              prdCoverage: [
                { requirement: 'User Registration & Auth', status: 'implemented', files: ['src/auth.ts'] },
                { requirement: 'Task Storage', status: 'implemented', files: ['src/tasks.ts'] },
                { requirement: 'Application Entry', status: 'implemented', files: ['src/index.ts'] },
              ],
            });
          }
          return '{}';
        });
      }

      machine.run().catch((err) => {
        console.error('[state_machine] Fatal pipeline error:', err);
        process.exit(1);
      });
    });
  });
}

