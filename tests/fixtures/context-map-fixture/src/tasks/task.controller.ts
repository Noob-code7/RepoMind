import { TaskService } from './task.service.js';

export class TaskController {
  private service = new TaskService();

  create(id: string, title: string) {
    return this.service.createTask(id, title);
  }

  list() {
    return this.service.getTasks();
  }
}
