/** Two-pass (skeleton/implementation) generation engine */
import { Manifest, TaskNode, Plan } from '../orchestrator/types';
import { DigestState, InterfaceSummary } from './digest';

/** Execution mode */
export type ExecutionMode = 'skeleton' | 'implementation';

/** Execution context for a single task */
export interface ExecutionContext {
  task: TaskNode;
  plan: Plan;
  digest: DigestState;
  mode: ExecutionMode;
  previousOutputs: Map<string, string>;
}

/** Result of task execution */
export interface ExecutionResult {
  taskId: string;
  success: boolean;
  output: string;
  artifacts: string[];
  errors?: string[];
  metadata?: Record<string, unknown>;
}

/** Complete execution run result */
export interface ExecutionRunResult {
  results: ExecutionResult[];
  overallSuccess: boolean;
  durationMs: number;
}

/**
 * Execute a plan in two passes: first skeleton generation, then implementation.
 * Uses digest for context-efficient LLM calls.
 */
export async function executePlan(
  plan: Plan,
  mode: ExecutionMode = 'skeleton'
): Promise<ExecutionRunResult> {
  throw new Error("not implemented");
}
