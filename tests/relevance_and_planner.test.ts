/**
 * tests/relevance_and_planner.test.ts
 * Unit tests for PRD parsing, context relevance ranking, gap detection, duplication checking, and DAG validation.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRepositoryContext } from '../context/mapper.js';
import { ContextRelevanceEngine } from '../context/relevance.js';
import { SemanticPlanValidator } from '../planning/dag_validator.js';
import { DuplicationDetector } from '../planning/duplication_detector.js';
import { generatePlan } from '../planning/planner_engine.js';
import { PrdParser } from '../planning/prd_parser.js';
import { PlanningResult } from '../planning/schemas.js';
import { MockProvider } from '../providers/mock_provider.js';

describe('Planning & Relevance Engine', () => {
  const fixtureRoot = path.resolve('tests/fixtures/task-manager');

  it('parses PRD text and extracts structured requirements and ambiguity flags', () => {
    const prdText = `# Task Manager Pro PRD
## Goals
- Provide fast and scalable task tracking

## Requirements
1. **Task Priority Filtering**: Users can filter tasks by priority (low, medium, high).
   - Must return array of tasks matching priority
   - Must throw on invalid priority
2. **Performance Standard**: System should be fast etc.
`;

    const parsed = PrdParser.parse(prdText);
    expect(parsed.title).toBe('Task Manager Pro PRD');
    expect(parsed.goals.length).toBe(1);
    expect(parsed.requirements.length).toBe(2);
    expect(parsed.requirements[0].id).toBe('REQ-001');
    expect(parsed.requirements[0].acceptanceCriteria.length).toBe(2);

    // Verify ambiguity detection for vague requirement
    expect(parsed.requirements[1].ambiguities.length).toBeGreaterThan(0);
    expect(parsed.requirements[1].ambiguities[0]).toContain('vague criteria');
  });

  it('identifies relevant files and detects context gaps', async () => {
    const context = await buildRepositoryContext({ root: fixtureRoot });
    const prd = 'Add task priority validation and OAuth Google login.';

    const relevance = ContextRelevanceEngine.analyzeRelevance(prd, context);

    // Validation utility should be high relevance
    const relevantPaths = relevance.relevantFiles.map((f) => f.path);
    expect(relevantPaths).toContain('src/utils/validation.ts');

    // Context gaps should flag missing auth module
    const gapTypes = relevance.assessment.gaps.map((g) => g.type);
    expect(gapTypes).toContain('missing_file');
    const authGap = relevance.assessment.gaps.find((g) => g.affectedArea === 'authentication');
    expect(authGap).toBeDefined();
  });

  it('detects duplication opportunities and mandates reuse', async () => {
    const context = await buildRepositoryContext({ root: fixtureRoot });
    const prd = 'Create a new validation helper for checking task descriptions.';

    const opportunities = DuplicationDetector.detectOpportunities(prd, context);
    expect(opportunities.length).toBeGreaterThan(0);
    expect(opportunities[0].existingFile).toBe('src/utils/validation.ts');
    expect(opportunities[0].recommendation).toContain('REUSE EXISTING MODULE');
  });

  it('validates semantic DAG constraints: rejects circular dependencies and duplicate IDs', async () => {
    const invalidPlan: PlanningResult = {
      schemaVersion: '1.0.0',
      runId: 'test_run',
      project: { name: 'test' },
      requirements: [{ id: 'REQ-001', title: 'Task Feature', description: 'test', type: 'functional', acceptanceCriteria: ['passes'], ambiguities: [] }],
      context: { confidence: 'high', relevantFiles: [], ignoredFiles: [], gaps: [], reasoning: 'ok' },
      architecture: { overview: 'test', reusedPatterns: [], newComponents: [], dataFlow: 'test' },
      tasks: [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'd1',
          type: 'create',
          dependencies: ['task-2'], // Circular: 1 -> 2 -> 1
          priority: 'medium',
          relatedFiles: ['src/a.ts'],
          acceptanceCriteria: ['ok'],
          risks: [],
        },
        {
          id: 'task-2',
          title: 'Task 2',
          description: 'd2',
          type: 'create',
          dependencies: ['task-1'], // Circular!
          priority: 'medium',
          relatedFiles: ['src/b.ts'],
          acceptanceCriteria: ['ok'],
          risks: [],
        },
      ],
      manifest: [
        { path: 'src/a.ts', action: 'create', purpose: 'A', relatedTasks: ['task-1'], expectedExports: [], expectedSymbols: [], dependencies: [], tests: [], risk: 'low' },
        { path: 'src/b.ts', action: 'create', purpose: 'B', relatedTasks: ['task-2'], expectedExports: [], expectedSymbols: [], dependencies: [], tests: [], risk: 'low' },
      ],
      tests: [
        { id: 'TEST-001', target: 'src/a.ts', type: 'unit', description: 'test A', assertions: ['expect a'], relatedRequirements: ['REQ-001'], relatedFiles: ['src/a.ts'] },
      ],
      traceability: [
        { requirementId: 'REQ-001', tasks: ['task-1', 'task-2'], files: ['src/a.ts', 'src/b.ts'], tests: ['TEST-001'] },
      ],
      risks: [],
      assumptions: [],
      unresolvedQuestions: [],
    };

    const result = SemanticPlanValidator.validate(invalidPlan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Circular dependency'))).toBe(true);
  });

  it('generates a full validated plan using MockProvider', async () => {
    const context = await buildRepositoryContext({ root: fixtureRoot });
    const prd = 'Add task priority validation helper function.';

    const mockPlanner = new MockProvider('PlannerMock', () => {
      const validPlan: PlanningResult = {
        schemaVersion: '1.0.0',
        runId: 'mock_run_1',
        project: { name: 'fixture-task-manager' },
        requirements: [
          {
            id: 'REQ-001',
            title: 'Task Priority Validation',
            description: 'Validate priority strings',
            type: 'functional',
            acceptanceCriteria: ['Supports low, medium, high'],
            ambiguities: [],
          },
        ],
        context: { confidence: 'high', relevantFiles: ['src/utils/validation.ts'], ignoredFiles: [], gaps: [], reasoning: 'reused utility' },
        architecture: { overview: 'Layered', reusedPatterns: ['utils'], newComponents: [], dataFlow: 'Direct' },
        tasks: [
          {
            id: 'task-1',
            title: 'Extend validation utility',
            description: 'Add priority check to existing validation.ts',
            type: 'modify',
            dependencies: [],
            priority: 'high',
            relatedFiles: ['src/utils/validation.ts'],
            acceptanceCriteria: ['Validates allowed values'],
            risks: [],
          },
        ],
        manifest: [
          {
            path: 'src/utils/validation.ts',
            action: 'modify',
            purpose: 'Add validateTaskPriority helper',
            relatedTasks: ['task-1'],
            expectedExports: ['validateTaskPriority'],
            expectedSymbols: ['validateTaskPriority'],
            dependencies: [],
            tests: ['tests/task.service.test.ts'],
            risk: 'low',
            reasoning: 'Existing validation module',
          },
        ],
        tests: [
          {
            id: 'TEST-001',
            target: 'src/utils/validation.ts',
            type: 'unit',
            description: 'tests priority validator',
            assertions: ['returns true for valid', 'returns false for invalid'],
            relatedRequirements: ['REQ-001'],
            relatedFiles: ['src/utils/validation.ts'],
          },
        ],
        traceability: [
          { requirementId: 'REQ-001', tasks: ['task-1'], files: ['src/utils/validation.ts'], tests: ['TEST-001'] },
        ],
        risks: [],
        assumptions: [],
        unresolvedQuestions: [],
      };
      return JSON.stringify(validPlan);
    });

    const plan = await generatePlan({
      prd,
      context,
      planner: mockPlanner,
    });

    expect(plan.tasks.length).toBe(1);
    expect(plan.manifest[0].action).toBe('modify');
    expect(plan.manifest[0].path).toBe('src/utils/validation.ts');
    expect(plan.traceability[0].requirementId).toBe('REQ-001');
  });
});
