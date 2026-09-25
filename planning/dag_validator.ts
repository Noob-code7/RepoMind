/**
 * planning/dag_validator.ts
 * Semantic validation for PlanningResult:
 *  - DAG acyclicity & dependency integrity
 *  - Task ID uniqueness
 *  - Manifest path uniqueness
 *  - Existing vs new file verification
 *  - Requirement traceability coverage
 *  - Test specification completeness
 */
import { RepositoryContext } from '../context/schemas.js';
import { PlanningResult } from './schemas.js';

export interface SemanticValidationResult {
  valid: boolean;
  errors: string[];
}

export class SemanticPlanValidator {
  /**
   * Validate all semantic constraints of a PlanningResult.
   */
  static validate(
    plan: PlanningResult,
    context?: RepositoryContext,
  ): SemanticValidationResult {
    const errors: string[] = [];

    // 1. Task ID Uniqueness & Dependency Integrity
    const taskIds = new Set<string>();
    for (const task of plan.tasks) {
      if (taskIds.has(task.id)) {
        errors.push(`Duplicate task ID detected: "${task.id}"`);
      }
      taskIds.add(task.id);
    }

    for (const task of plan.tasks) {
      for (const depId of task.dependencies) {
        if (!taskIds.has(depId)) {
          errors.push(
            `Task "${task.id}" depends on unknown task ID "${depId}".`,
          );
        }
      }
    }

    // 2. DAG Cycle Detection (DFS Cycle Detection)
    const cycle = SemanticPlanValidator.detectCycle(plan.tasks);
    if (cycle) {
      errors.push(`Circular dependency detected in task graph: ${cycle.join(' → ')}`);
    }

    // 3. Manifest Path Uniqueness & Consistency
    const manifestPaths = new Set<string>();
    for (const entry of plan.manifest) {
      if (manifestPaths.has(entry.path)) {
        errors.push(`Duplicate file path in manifest: "${entry.path}"`);
      }
      manifestPaths.add(entry.path);

      // Verify related tasks exist
      for (const tId of entry.relatedTasks) {
        if (!taskIds.has(tId)) {
          errors.push(
            `Manifest entry "${entry.path}" references unknown task ID "${tId}".`,
          );
        }
      }
    }

    // 4. Verify Existing Files for "modify" vs "create" actions against RepositoryContext
    if (context) {
      const existingRepoPaths = new Set(context.files.map((f) => f.path));

      for (const entry of plan.manifest) {
        const exists = existingRepoPaths.has(entry.path);

        if (entry.action === 'modify' && !exists) {
          errors.push(
            `Manifest plans to "modify" file "${entry.path}", but this file does not exist in the repository. Action should be "create".`,
          );
        }

        if (entry.action === 'create' && exists) {
          errors.push(
            `Manifest plans to "create" file "${entry.path}", but this file already exists in the repository. Action should be "modify".`,
          );
        }
      }
    }

    // 5. Test Specifications & Target Verification
    const testIds = new Set<string>();
    for (const test of plan.tests) {
      if (testIds.has(test.id)) {
        errors.push(`Duplicate test specification ID: "${test.id}"`);
      }
      testIds.add(test.id);

      if (test.assertions.length === 0) {
        errors.push(`Test specification "${test.id}" must contain at least one concrete assertion.`);
      }
    }

    // 6. Traceability Coverage (Requirement → Task & Tests)
    const reqIds = new Set(plan.requirements.map((r) => r.id));
    const coveredReqs = new Set<string>();

    for (const trace of plan.traceability) {
      if (!reqIds.has(trace.requirementId)) {
        errors.push(`Traceability references unknown requirement ID "${trace.requirementId}".`);
      }
      coveredReqs.add(trace.requirementId);

      for (const tId of trace.tasks) {
        if (!taskIds.has(tId)) {
          errors.push(`Traceability for "${trace.requirementId}" references non-existent task "${tId}".`);
        }
      }
    }

    for (const req of plan.requirements) {
      if (!coveredReqs.has(req.id)) {
        errors.push(`Requirement "${req.id}" (${req.title}) has zero mapped tasks in traceability.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Detect cycles in task dependency graph using Depth First Search.
   */
  private static detectCycle(
    tasks: Array<{ id: string; dependencies: string[] }>,
  ): string[] | null {
    const adj = new Map<string, string[]>();
    for (const t of tasks) {
      adj.set(t.id, t.dependencies);
    }

    // 0 = unvisited, 1 = visiting (in stack), 2 = visited
    const state = new Map<string, number>();
    const parent = new Map<string, string>();

    function dfs(u: string, pathStack: string[]): string[] | null {
      state.set(u, 1);
      pathStack.push(u);

      const neighbors = adj.get(u) || [];
      for (const v of neighbors) {
        const vState = state.get(v) || 0;
        if (vState === 1) {
          // Cycle found!
          const cycleStart = pathStack.indexOf(v);
          return [...pathStack.slice(cycleStart), v];
        }
        if (vState === 0) {
          parent.set(v, u);
          const found = dfs(v, pathStack);
          if (found) return found;
        }
      }

      pathStack.pop();
      state.set(u, 2);
      return null;
    }

    for (const t of tasks) {
      if ((state.get(t.id) || 0) === 0) {
        const cycle = dfs(t.id, []);
        if (cycle) return cycle;
      }
    }

    return null;
  }
}
