import { validateNonEmptyString } from '../utils/validation.js';

export interface TaskRecord {
  id: string;
  title: string;
  completed: boolean;
}

export class TaskService {
  private tasks: Map<string, TaskRecord> = new Map();

  createTask(id: string, title: string): TaskRecord {
    validateNonEmptyString(title, 'title');
    const task: TaskRecord = { id, title, completed: false };
    this.tasks.set(id, task);
    return task;
  }

  getTasks(): TaskRecord[] {
    return Array.from(this.tasks.values());
  }

  completeTask(id: string): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.completed = true;
    return task;
  }
}
