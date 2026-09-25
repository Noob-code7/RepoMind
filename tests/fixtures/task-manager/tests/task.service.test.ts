import { describe, it, expect } from 'vitest';
import { TaskService } from '../src/services/task.service.js';

describe('TaskService', () => {
  it('creates and retrieves tasks', () => {
    const service = new TaskService();
    const task = service.createTask('1', 'Sample Task');
    expect(task.title).toBe('Sample Task');
    expect(service.getTasks().length).toBe(1);
  });

  it('completes tasks', () => {
    const service = new TaskService();
    service.createTask('2', 'Test Task');
    const completed = service.completeTask('2');
    expect(completed?.completed).toBe(true);
  });
});
