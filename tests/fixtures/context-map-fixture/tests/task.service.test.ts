import { describe, expect, it } from 'vitest';
import { TaskService } from '../src/tasks/task.service.js';

describe('TaskService', () => {
  it('creates task', () => {
    const s = new TaskService();
    expect(s.createTask('1', 'Sample').title).toBe('Sample');
  });
});
