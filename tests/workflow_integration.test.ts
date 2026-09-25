/**
 * tests/workflow_integration.test.ts
 * End-to-end integration test suite verifying the unified Braid workflow:
 *   1. PRD → Context
 *   2. Context → Plan
 *   3. Plan → Validation
 *   4. Plan → Review
 *   5. Review → Revision
 *   6. Approved Plan → Execution Boundary
 *   7. Final Report
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRepositoryContext } from '../context/mapper.js';
import { ContextRelevanceEngine } from '../context/relevance.js';
import { MockExecutor } from '../orchestrator/execution_boundary.js';
import { PipelineOrchestrator } from '../orchestrator/pipeline_orchestrator.js';
import { SemanticPlanValidator } from '../planning/dag_validator.js';
import { generatePlan } from '../planning/planner_engine.js';
import { PrdParser } from '../planning/prd_parser.js';
import { MockProvider } from '../providers/mock_provider.js';
import { reviewPlan } from '../review/review_engine.js';
import { revisePlan } from '../review/revision_loop.js';

describe('Braid End-to-End Workflow Integration', () => {
  const fixtureDir = path.resolve('tests/fixtures/task-manager');
  const tempProjectDir = path.resolve('dist/test_workflow_tmp');

  const samplePrd = `# Task Prioritization & Validation PRD
## Goals
1. Add high/medium/low priority levels to the task manager.
2. Reuse existing validation schemas in src/utils/validation.ts.
3. Ensure 100% test coverage with Vitest unit tests.
`;

  beforeEach(() => {
    fs.mkdirSync(tempProjectDir, { recursive: true });
    // Copy fixture files to temp directory for realistic repository state
    fs.cpSync(fixtureDir, tempProjectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  });

  it('1. PRD → Context: maps repository architecture, AST symbols, and identifies relevance', async () => {
    const context = await buildRepositoryContext({ root: tempProjectDir });

    expect(context.files.length).toBeGreaterThan(0);
    expect(context.symbols.length).toBeGreaterThan(0);

    // Verify TypeScript AST analysis discovered task service and validation utilities
    const taskServiceFile = context.files.find((f) => f.path.includes('task.service.ts'));
    expect(taskServiceFile).toBeDefined();
    expect(taskServiceFile?.exports).toContain('TaskService');

    const validationFile = context.files.find((f) => f.path.includes('validation.ts'));
    expect(validationFile).toBeDefined();

    // Verify relevance analysis against PRD
    const relevance = ContextRelevanceEngine.analyzeRelevance(samplePrd, context);
    expect(relevance.assessment.confidence).toBe('high');
    expect(relevance.relevantFiles.some((f) => f.path.includes('task.service') || f.path.includes('validation'))).toBe(true);
  });

  it('2. Context → Plan: synthesizes a repository-aware plan with task DAG and manifest', async () => {
    const planResult = await PipelineOrchestrator.plan({
      prdContent: samplePrd,
      projectRoot: tempProjectDir,
    });

    expect(planResult.plan).toBeDefined();
    expect(planResult.requirementsCount).toBeGreaterThan(0);
    expect(planResult.tasksCount).toBeGreaterThan(0);
    expect(planResult.filesToModify).toBeGreaterThan(0); // Mandates reuse of existing files!
    expect(planResult.testsCount).toBeGreaterThan(0);

    // Check disk persistence
    const savedPlan = path.join(tempProjectDir, '.braid', 'plan.json');
    expect(fs.existsSync(savedPlan)).toBe(true);
  });

  it('3. Plan → Validation: validates DAG acyclicity, task uniqueness, and zero dropped files', async () => {
    const context = await buildRepositoryContext({ root: tempProjectDir });
    const planResult = await PipelineOrchestrator.plan({
      prdContent: samplePrd,
      projectRoot: tempProjectDir,
    });

    const validation = SemanticPlanValidator.validate(planResult.plan, context);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('4. Plan → Review: runs independent 11-point critique and outputs structured findings', async () => {
    // Generate plan first
    await PipelineOrchestrator.plan({
      prdContent: samplePrd,
      projectRoot: tempProjectDir,
    });

    const reviewResult = await PipelineOrchestrator.review({
      projectRoot: tempProjectDir,
    });

    expect(reviewResult.review).toBeDefined();
    expect(['approved', 'needs_revision']).toContain(reviewResult.status);
    expect(Array.isArray(reviewResult.findings)).toBe(true);

    const savedReview = path.join(tempProjectDir, '.braid', 'review.json');
    expect(fs.existsSync(savedReview)).toBe(true);
  });

  it('5. Review → Revision: revises plan based on review findings while preserving stable tasks', async () => {
    const context = await buildRepositoryContext({ root: tempProjectDir });
    const planResult = await PipelineOrchestrator.plan({
      prdContent: samplePrd,
      projectRoot: tempProjectDir,
    });

    const mockReviewer = new MockProvider('StrictReviewer', () => {
      return JSON.stringify({
        runId: 'rev_strict_001',
        status: 'needs_revision',
        summary: 'Missing rate-limit validation on task creation.',
        findings: [
          {
            id: 'CRIT-001',
            severity: 'high',
            category: 'security',
            title: 'Missing rate-limit check',
            explanation: 'Task creation lacks validation against burst creation.',
            affectedTasks: ['task-1'],
            affectedFiles: ['src/services/task.service.ts'],
            recommendation: 'Add rate-limit validation schema.',
          },
        ],
        missingRequirements: [],
        missingFiles: [],
        unnecessaryFiles: [],
        riskLevel: 'medium',
        revisionInstructions: ['Incorporate rate-limit validation in task.service.ts'],
      });
    });

    const reviewRes = await reviewPlan({
      prd: samplePrd,
      context,
      plan: planResult.plan,
      reviewer: mockReviewer,
    });

    expect(reviewRes.status).toBe('needs_revision');

    // Revise plan
    const revisedPlan = await revisePlan({
      prd: samplePrd,
      context,
      previousPlan: planResult.plan,
      review: reviewRes,
      planner: PipelineOrchestrator.resolvePlannerProvider(),
    });

    expect(revisedPlan).toBeDefined();
    expect(revisedPlan.tasks.length).toBeGreaterThan(0);
    const validation = SemanticPlanValidator.validate(revisedPlan, context);
    expect(validation.valid).toBe(true);
  });

  it('6. Approved Plan → Execution Boundary: enforces approval gate and queues manifest', async () => {
    // Attempting build without plan/approval must throw
    await expect(PipelineOrchestrator.build({ projectRoot: tempProjectDir })).rejects.toThrow(
      /Plan is not approved/i,
    );

    // 1. Generate plan
    await PipelineOrchestrator.plan({
      prdContent: samplePrd,
      projectRoot: tempProjectDir,
    });

    // 2. Review plan
    await PipelineOrchestrator.review({
      projectRoot: tempProjectDir,
    });

    // 3. Approve plan
    const approveResult = await PipelineOrchestrator.approve({
      projectRoot: tempProjectDir,
      operator: 'test_operator',
    });

    expect(approveResult.approval.operator).toBe('test_operator');
    expect(approveResult.filesQueued).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tempProjectDir, '.braid', 'approval.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempProjectDir, '.braid', 'execution_manifest.json'))).toBe(true);

    // 4. Build via clean execution boundary
    const mockExecutor = new MockExecutor();
    const buildResult = await PipelineOrchestrator.build({
      projectRoot: tempProjectDir,
      executor: mockExecutor,
    });

    expect(buildResult.result.success).toBe(true);
    expect(buildResult.result.completeness).toBe(100);
    expect(buildResult.result.missingFiles).toHaveLength(0);
    expect(fs.existsSync(path.join(tempProjectDir, '.braid', 'build.json'))).toBe(true);
  });

  it('7. Final Report: compiles deterministic metrics across the complete lifecycle', async () => {
    // Complete the full lifecycle
    await PipelineOrchestrator.plan({ prdContent: samplePrd, projectRoot: tempProjectDir });
    await PipelineOrchestrator.review({ projectRoot: tempProjectDir });
    await PipelineOrchestrator.approve({ projectRoot: tempProjectDir });
    await PipelineOrchestrator.build({ projectRoot: tempProjectDir, executor: new MockExecutor() });

    const report = PipelineOrchestrator.report(tempProjectDir);

    expect(report.prdCoverage).toBe(100);
    expect(report.plannedTasks).toBeGreaterThan(0);
    expect(report.filesAffected).toBeGreaterThan(0);
    expect(report.testsSpecified).toBeGreaterThan(0);
    expect(report.status).toBe('BUILT');
    expect(report.details.approved).toBe(true);
    expect(report.details.built).toBe(true);

    expect(fs.existsSync(path.join(tempProjectDir, '.braid', 'report.json'))).toBe(true);
  });
});
