/** Shared types for Plan, Manifest, and TaskGraph */

export type PipelineState = 'idle' | 'planning' | 'reviewing' | 'executing' | 'verifying' | 'reporting' | 'complete' | 'failed';

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description: string;
  tasks: TaskNode[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskNode {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';
  artifacts?: string[];
  metadata?: Record<string, unknown>;
}

export interface Plan {
  manifest: Manifest;
  taskGraph: TaskNode[];
  metadata: Record<string, unknown>;
}
