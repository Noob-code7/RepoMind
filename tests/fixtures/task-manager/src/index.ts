import { TaskService } from './services/task.service.js';

export function startApp(): void {
  const service = new TaskService();
  console.log('Task App running with', service.getTasks().length, 'tasks');
}
