import { Manifest, Plan, TaskNode } from '../orchestrator/types';

/** Review findings severity levels */
export type Severity = 'info' | 'warning' | 'error' | 'critical';

/** Individual review finding */
export interface ReviewFinding {
  id: string;
  severity: Severity;
  category: string;
  message: string;
  location?: string;
  suggestion?: string;
}

/** Complete review result */
export interface ReviewResult {
  approved: boolean;
  findings: ReviewFinding[];
  riskScore: number;
  summary: string;
}

/**
 * Review a generated plan for correctness, completeness, and risk.
 * Returns approval status with detailed findings.
 */
export async function reviewPlan(plan: Plan): Promise<ReviewResult> {
  const findings: ReviewFinding[] = [];
  let findingId = 0;

  const addFinding = (
    severity: Severity,
    category: string,
    message: string,
    location?: string,
    suggestion?: string
  ) => {
    findings.push({
      id: `finding-${++findingId}`,
      severity,
      category,
      message,
      location,
      suggestion,
    });
  };

  const { manifest, taskGraph, metadata } = plan;

  if (!manifest || !manifest.id) {
    addFinding('critical', 'manifest', 'Plan missing manifest or manifest ID');
  } else {
    if (!manifest.name || manifest.name.trim() === '') {
      addFinding('error', 'manifest', 'Manifest name is empty', manifest.id);
    }
    if (!manifest.version || manifest.version.trim() === '') {
      addFinding('warning', 'manifest', 'Manifest version is empty', manifest.id);
    }
    if (!manifest.description || manifest.description.trim() === '') {
      addFinding('info', 'manifest', 'Manifest description is empty', manifest.id);
    }
  }

  if (!taskGraph || taskGraph.length === 0) {
    addFinding('critical', 'taskGraph', 'Plan contains no tasks');
  } else {
    const taskIds = new Set<string>();
    const dependencyGraph = new Map<string, Set<string>>();
    const reverseDependencies = new Map<string, Set<string>>();

    for (const task of taskGraph) {
      if (taskIds.has(task.id)) {
        addFinding('error', 'taskGraph', `Duplicate task ID: ${task.id}`, task.id);
      }
      taskIds.add(task.id);
      dependencyGraph.set(task.id, new Set(task.dependencies));
      reverseDependencies.set(task.id, new Set());
    }

    for (const task of taskGraph) {
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          addFinding('error', 'dependencies', `Task ${task.id} depends on non-existent task: ${dep}`, task.id);
        } else {
          reverseDependencies.get(dep)?.add(task.id);
        }
      }
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycle = (nodeId: string, path: string[]): string[] | null => {
      if (recursionStack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        return path.slice(cycleStart).concat(nodeId);
      }
      if (visited.has(nodeId)) return null;

      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const deps = dependencyGraph.get(nodeId) || new Set();
      for (const dep of deps) {
        const cycle = detectCycle(dep, [...path]);
        if (cycle) return cycle;
      }

      recursionStack.delete(nodeId);
      return null;
    };

    for (const taskId of taskIds) {
      if (!visited.has(taskId)) {
        const cycle = detectCycle(taskId, []);
        if (cycle) {
          addFinding('critical', 'dependencies', `Circular dependency detected: ${cycle.join(' -> ')}`, cycle[0]);
        }
      }
    }

    const tasksWithoutDescription = taskGraph.filter(t => !t.description || t.description.trim() === '');
    for (const task of tasksWithoutDescription) {
      addFinding('warning', 'completeness', `Task missing description`, task.id, 'Add a clear description of what this task accomplishes');
    }

    const tasksWithoutArtifacts = taskGraph.filter(t => !t.artifacts || t.artifacts.length === 0);
    for (const task of tasksWithoutArtifacts) {
      addFinding('info', 'completeness', `Task has no declared artifacts`, task.id, 'Consider declaring expected output artifacts for traceability');
    }

    const orphanTasks = taskGraph.filter(t => 
      t.dependencies.length === 0 && 
      (reverseDependencies.get(t.id)?.size ?? 0) === 0 &&
      taskGraph.length > 1
    );
    for (const task of orphanTasks) {
      addFinding('warning', 'structure', `Task is isolated (no dependencies and no dependents)`, task.id, 'Verify this task should be independent or add appropriate dependencies');
    }

    const maxDepth = calculateMaxDepth(taskGraph, dependencyGraph);
    if (maxDepth > 10) {
      addFinding('warning', 'complexity', `Task graph depth is ${maxDepth} (exceeds recommended 10)`, undefined, 'Consider flattening the dependency chain');
    }

    const highFanOutTasks = taskGraph.filter(t => (reverseDependencies.get(t.id)?.size ?? 0) > 5);
    for (const task of highFanOutTasks) {
      addFinding('info', 'complexity', `Task has high fan-out (${reverseDependencies.get(task.id)?.size} dependents)`, task.id, 'Consider splitting into smaller tasks');
    }

    const highFanInTasks = taskGraph.filter(t => t.dependencies.length > 5);
    for (const task of highFanInTasks) {
      addFinding('info', 'complexity', `Task has high fan-in (${task.dependencies} dependencies)`, task.id, 'Consider consolidating dependencies or splitting task');
    }
  }

  const criticalFindings = findings.filter(f => f.severity === 'critical');
  const errorFindings = findings.filter(f => f.severity === 'error');
  const warningFindings = findings.filter(f => f.severity === 'warning');

  let riskScore = 0;
  riskScore += criticalFindings.length * 25;
  riskScore += errorFindings.length * 10;
  riskScore += warningFindings.length * 3;
  riskScore += findings.filter(f => f.severity === 'info').length * 1;

  if (taskGraph) {
    const avgDependencies = taskGraph.reduce((sum, t) => sum + t.dependencies.length, 0) / taskGraph.length;
    riskScore += Math.min(avgDependencies * 2, 20);

    const maxDepth = calculateMaxDepth(taskGraph, new Map(taskGraph.map(t => [t.id, new Set(t.dependencies)])));
    riskScore += Math.min(maxDepth * 1.5, 15);
  }

  riskScore = Math.min(Math.round(riskScore), 100);

  const approved = criticalFindings.length === 0 && errorFindings.length === 0 && riskScore < 70;

  const summary = generateSummary(approved, findings, riskScore, taskGraph?.length ?? 0);

  return {
    approved,
    findings,
    riskScore,
    summary,
  };
}

function calculateMaxDepth(taskGraph: TaskNode[], dependencyGraph: Map<string, Set<string>>): number {
  const memo = new Map<string, number>();

  const getDepth = (taskId: string): number => {
    if (memo.has(taskId)) return memo.get(taskId)!;
    
    const deps = dependencyGraph.get(taskId) || new Set();
    if (deps.size === 0) {
      memo.set(taskId, 1);
      return 1;
    }

    let maxDepDepth = 0;
    for (const dep of deps) {
      maxDepDepth = Math.max(maxDepDepth, getDepth(dep));
    }
    
    const depth = maxDepDepth + 1;
    memo.set(taskId, depth);
    return depth;
  };

  let maxDepth = 0;
  for (const task of taskGraph) {
    maxDepth = Math.max(maxDepth, getDepth(task.id));
  }
  return maxDepth;
}

function generateSummary(
  approved: boolean,
  findings: ReviewFinding[],
  riskScore: number,
  taskCount: number
): string {
  const critical = findings.filter(f => f.severity === 'critical').length;
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const info = findings.filter(f => f.severity === 'info').length;

  const status = approved ? 'APPROVED' : 'REJECTED';
  const riskLevel = riskScore >= 70 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW';

  return `Plan Review: ${status} | Risk: ${riskLevel} (${riskScore}/100) | Tasks: ${taskCount} | Findings: ${critical} critical, ${errors} errors, ${warnings} warnings, ${info} info`;
}
