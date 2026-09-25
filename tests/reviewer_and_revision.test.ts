/**
 * tests/reviewer_and_revision.test.ts
 * Unit tests for independent plan review, risk detection, structured findings, and the revision loop.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRepositoryContext } from '../context/mapper.js';
import { PlanningResult } from '../planning/schemas.js';
import { MockProvider } from '../providers/mock_provider.js';
import { reviewPlan } from '../review/review_engine.js';
import { revisePlan, runPlanningReviewCycle } from '../review/revision_loop.js';
import { ReviewResult } from '../review/schemas.js';

describe('Review Engine & Revision Loop', () => {
  const fixtureRoot = path.resolve('tests/fixtures/task-manager');

  const basePlan: PlanningResult = {
    schemaVersion: '1.0.0',
    runId: 'rev_test_1',
    project: { name: 'fixture-task-manager' },
    requirements: [
      {
        id: 'REQ-001',
        title: 'Task Filtering',
        description: 'Filter by priority',
        type: 'functional',
        acceptanceCriteria: ['Filters by low, med, high'],
        ambiguities: [],
      },
    ],
    context: { confidence: 'high', relevantFiles: ['src/services/task.service.ts'], ignoredFiles: [], gaps: [], reasoning: 'ok' },
    architecture: { overview: 'Layered', reusedPatterns: ['service'], newComponents: [], dataFlow: 'Direct' },
    tasks: [
      {
        id: 'task-1',
        title: 'Add filter method',
        description: 'Add filterByPriority to TaskService',
        type: 'modify',
        dependencies: [],
        priority: 'high',
        relatedFiles: ['src/services/task.service.ts'],
        acceptanceCriteria: ['Returns filtered items'],
        risks: [],
      },
    ],
    manifest: [
      {
        path: 'src/services/task.service.ts',
        action: 'modify',
        purpose: 'Add filter method',
        relatedTasks: ['task-1'],
        expectedExports: ['TaskService'],
        expectedSymbols: ['TaskService'],
        dependencies: [],
        tests: ['tests/task.service.test.ts'],
        risk: 'low',
      },
    ],
    tests: [
      {
        id: 'TEST-001',
        target: 'src/services/task.service.ts',
        type: 'unit',
        description: 'test filtering',
        assertions: ['matches count'],
        relatedRequirements: ['REQ-001'],
        relatedFiles: ['src/services/task.service.ts'],
      },
    ],
    traceability: [
      { requirementId: 'REQ-001', tasks: ['task-1'], files: ['src/services/task.service.ts'], tests: ['TEST-001'] },
    ],
    risks: [],
    assumptions: [],
    unresolvedQuestions: [],
  };

  it('performs independent review and flags structured findings and risks', async () => {
    const context = await buildRepositoryContext({ root: fixtureRoot });
    const prd = 'Add task priority filtering';

    const mockReviewer = new MockProvider('ReviewerMock', () => {
      const review: ReviewResult = {
        runId: 'rev_test_1',
        status: 'needs_revision',
        summary: 'Plan is viable but missing a regression test for existing task creation.',
        findings: [
          {
            id: 'F-001',
            severity: 'medium',
            category: 'testing',
            title: 'Missing existing workflow regression test',
            explanation: 'Modifying TaskService without explicitly testing that existing createTask() remains untouched.',
            affectedTasks: ['task-1'],
            affectedFiles: ['src/services/task.service.ts'],
            recommendation: 'Add TEST-002 as a regression test verifying task creation behavior.',
          },
        ],
        missingRequirements: [],
        missingFiles: [],
        unnecessaryFiles: [],
        riskLevel: 'medium',
        revisionInstructions: [
          'Add TEST-002: Regression test verifying existing task creation',
        ],
      };
      return JSON.stringify(review);
    });

    const review = await reviewPlan({
      prd,
      context,
      plan: basePlan,
      reviewer: mockReviewer,
    });

    expect(review.status).toBe('needs_revision');
    expect(review.findings.length).toBe(1);
    expect(review.findings[0].category).toBe('testing');
    expect(review.revisionInstructions.length).toBe(1);
  });

  it('revises plan based on review findings and instructions', async () => {
    const context = await buildRepositoryContext({ root: fixtureRoot });
    const prd = 'Add task priority filtering';

    const mockReview: ReviewResult = {
      runId: 'rev_test_1',
      status: 'needs_revision',
      summary: 'Missing regression test',
      findings: [
        {
          id: 'F-001',
          severity: 'medium',
          category: 'testing',
          title: 'Missing regression test',
          explanation: 'Needs regression test for existing create task',
          affectedTasks: ['task-1'],
          affectedFiles: ['src/services/task.service.ts'],
          recommendation: 'Add TEST-002',
        },
      ],
      missingRequirements: [],
      missingFiles: [],
      unnecessaryFiles: [],
      riskLevel: 'medium',
      revisionInstructions: ['Add TEST-002 for regression testing'],
    };

    const mockPlanner = new MockProvider('PlannerMock', (req) => {
      // Planner reflects revision instructions into plan
      const revisedPlan: PlanningResult = {
        ...basePlan,
        tests: [
          ...basePlan.tests,
          {
            id: 'TEST-002',
            target: 'src/services/task.service.ts',
            type: 'regression',
            description: 'regression test for task creation',
            assertions: ['existing createTask still functions identically'],
            relatedRequirements: ['REQ-001'],
            relatedFiles: ['src/services/task.service.ts'],
          },
        ],
      };
      return JSON.stringify(revisedPlan);
    });

    const revised = await revisePlan({
      prd,
      context,
      previousPlan: basePlan,
      review: mockReview,
      planner: mockPlanner,
    });

    expect(revised.tests.length).toBe(2);
    expect(revised.tests.some((t) => t.id === 'TEST-002')).toBe(true);
    expect(revised.tests.find((t) => t.id === 'TEST-002')?.type).toBe('regression');
  });

  it('runs complete autonomous Plan → Review → Revision loop to approval', async () => {
    const context = await buildRepositoryContext({ root: fixtureRoot });
    const prd = 'Add task priority filtering';

    let plannerCalls = 0;
    const mockPlanner = new MockProvider('LoopPlanner', () => {
      plannerCalls++;
      const currentTests = plannerCalls === 1 ? basePlan.tests : [
        ...basePlan.tests,
        {
          id: 'TEST-002',
          target: 'src/services/task.service.ts',
          type: 'regression',
          description: 'regression check',
          assertions: ['passes'],
          relatedRequirements: ['REQ-001'],
          relatedFiles: ['src/services/task.service.ts'],
        },
      ];

      return JSON.stringify({ ...basePlan, tests: currentTests });
    });

    let reviewerCalls = 0;
    const mockReviewer = new MockProvider('LoopReviewer', () => {
      reviewerCalls++;
      if (reviewerCalls === 1) {
        return JSON.stringify({
          runId: 'rev_test_1',
          status: 'needs_revision',
          summary: 'Needs regression test',
          findings: [
            {
              id: 'F-1',
              severity: 'medium',
              category: 'testing',
              title: 'Need regression test',
              explanation: 'Add regression test',
              recommendation: 'Add TEST-002',
            },
          ],
          missingRequirements: [],
          missingFiles: [],
          unnecessaryFiles: [],
          riskLevel: 'medium',
          revisionInstructions: ['Add TEST-002'],
        });
      }
      // Second review approves!
      return JSON.stringify({
        runId: 'rev_test_1',
        status: 'approved',
        summary: 'All findings resolved. Plan is ready for human approval.',
        findings: [],
        missingRequirements: [],
        missingFiles: [],
        unnecessaryFiles: [],
        riskLevel: 'low',
        revisionInstructions: [],
      });
    });

    const result = await runPlanningReviewCycle({
      prd,
      context,
      planner: mockPlanner,
      reviewer: mockReviewer,
      maxRevisions: 2,
    });

    expect(result.status).toBe('ready_for_approval');
    expect(result.review.status).toBe('approved');
    expect(result.plan.tests.length).toBe(2);
    expect(plannerCalls).toBe(2);
    expect(reviewerCalls).toBe(2);
  });
});
