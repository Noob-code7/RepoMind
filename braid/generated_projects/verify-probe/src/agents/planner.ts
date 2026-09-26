import { Manifest, TaskNode, Plan } from '../orchestrator/types';

/** Input context for plan generation */
export interface PlannerInput {
  goal: string;
  constraints?: string[];
  context?: Record<string, unknown>;
}

/** Result of plan generation */
export interface PlannerResult {
  plan: Plan;
  confidence: number;
  reasoning: string;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function inferTasksFromGoal(goal: string, constraints?: string[]): TaskNode[] {
  const lowerGoal = goal.toLowerCase();
  const tasks: TaskNode[] = [];
  let order = 0;

  const addTask = (name: string, description: string, deps: string[] = []): TaskNode => {
    const task: TaskNode = {
      id: generateId('task'),
      name,
      description,
      dependencies: deps,
      status: 'pending',
      metadata: { order: order++ }
    };
    tasks.push(task);
    return task;
  };

  // Always start with analysis
  const analyze = addTask('Analyze Requirements', 'Break down the goal into concrete requirements and acceptance criteria');

  // Determine task flow based on goal keywords
  if (lowerGoal.includes('api') || lowerGoal.includes('service') || lowerGoal.includes('backend')) {
    const design = addTask('Design API Contracts', 'Define endpoints, schemas, and data models', [analyze.id]);
    const implement = addTask('Implement Service Logic', 'Write core business logic and data access', [design.id]);
    const test = addTask('Write Tests', 'Create unit and integration tests', [implement.id]);
    const document = addTask('Document API', 'Generate OpenAPI specs and usage docs', [test.id]);
    addTask('Deploy & Validate', 'Deploy to staging and run smoke tests', [document.id]);
  } else if (lowerGoal.includes('ui') || lowerGoal.includes('frontend') || lowerGoal.includes('component')) {
    const design = addTask('Design UI Components', 'Create component specs and state management plan', [analyze.id]);
    const implement = addTask('Implement Components', 'Build React/Vue components with styling', [design.id]);
    const test = addTask('Write Tests', 'Create component and visual regression tests', [implement.id]);
    const integrate = addTask('Integrate & Polish', 'Connect to APIs, handle edge cases, optimize', [test.id]);
    addTask('Deploy & Validate', 'Deploy to preview and run accessibility checks', [integrate.id]);
  } else if (lowerGoal.includes('database') || lowerGoal.includes('migration') || lowerGoal.includes('schema')) {
    const design = addTask('Design Schema Changes', 'Define migrations, indexes, and constraints', [analyze.id]);
    const implement = addTask('Write Migrations', 'Create up/down migration scripts', [design.id]);
    const test = addTask('Test Migrations', 'Run against staging data, verify rollback', [implement.id]);
    addTask('Apply & Verify', 'Execute migrations in production with monitoring', [test.id]);
  } else if (lowerGoal.includes('refactor') || lowerGoal.includes('optimize') || lowerGoal.includes('improve')) {
    const audit = addTask('Audit Current State', 'Profile performance, identify bottlenecks', [analyze.id]);
    const plan = addTask('Plan Refactor', 'Define scope, risks, and rollback strategy', [audit.id]);
    const implement = addTask('Implement Changes', 'Apply refactoring in small, verified steps', [plan.id]);
    const test = addTask('Regression Testing', 'Run full test suite and benchmarks', [implement.id]);
    addTask('Monitor & Validate', 'Deploy with feature flags, monitor metrics', [test.id]);
  } else {
    // Generic software task flow
    const design = addTask('Design Solution', 'Architect approach, define interfaces', [analyze.id]);
    const implement = addTask('Implement', 'Write code following design', [design.id]);
    const test = addTask('Test', 'Unit, integration, and e2e tests', [implement.id]);
    const review = addTask('Code Review', 'Peer review for quality and correctness', [test.id]);
    addTask('Deploy', 'Release to production with monitoring', [review.id]);
  }

  // Apply constraints as additional tasks or metadata
  if (constraints && constraints.length > 0) {
    tasks.forEach(task => {
      task.metadata = { ...task.metadata, constraints };
    });
  }

  return tasks;
}

/**
 * Generate a complete execution plan from a high-level goal.
 * Returns a Manifest with task graph and metadata.
 */
export async function generatePlan(input: PlannerInput): Promise<PlannerResult> {
  const { goal, constraints, context } = input;

  if (!goal || goal.trim().length === 0) {
    throw new Error('Goal is required and cannot be empty');
  }

  const tasks = inferTasksFromGoal(goal, constraints);

  const manifest: Manifest = {
    id: generateId('manifest'),
    name: goal.slice(0, 80),
    version: '1.0.0',
    description: goal,
    tasks,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const plan: Plan = {
    manifest,
    taskGraph: tasks,
    metadata: {
      generatedAt: new Date().toISOString(),
      constraints: constraints || [],
      context: context || {},
      taskCount: tasks.length,
      estimatedDuration: tasks.length * 15 // rough minutes estimate
    }
  };

  // Calculate confidence based on goal clarity and constraint complexity
  let confidence = 0.85;
  if (goal.length < 20) confidence -= 0.15;
  if (constraints && constraints.length > 3) confidence -= 0.1;
  if (context && Object.keys(context).length > 0) confidence += 0.05;
  confidence = Math.max(0.5, Math.min(0.95, confidence));

  const reasoning = `Generated ${tasks.length} tasks for: "${goal}". ` +
    `Flow: ${tasks.map(t => t.name).join(' → ')}. ` +
    `Confidence: ${Math.round(confidence * 100)}% based on goal specificity and constraint complexity.`;

  return {
    plan,
    confidence,
    reasoning
  };
}
