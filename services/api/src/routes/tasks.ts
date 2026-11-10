import type { FastifyInstance } from 'fastify';
import { getTask, listTasks, retryTask, cancelTask, taskStats } from '../scheduler/task-service.js';
import { schedulerStats, tickOnce } from '../scheduler/scheduler.js';
import { all } from '../db/index.js';

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tasks', async (req) => {
    const q = req.query as { project_id?: string; status?: string; task_type?: string; shot_id?: string; limit?: string };
    return listTasks({
      project_id: q.project_id ? Number(q.project_id) : undefined,
      shot_id: q.shot_id ? Number(q.shot_id) : undefined,
      status: q.status,
      task_type: q.task_type,
      limit: q.limit ? Number(q.limit) : 200
    });
  });

  app.get('/tasks/:id', async (req) => getTask(Number((req.params as { id: string }).id)));

  app.post('/tasks/:id/retry', async (req) => retryTask(Number((req.params as { id: string }).id)));

  app.post('/tasks/:id/cancel', async (req) => cancelTask(Number((req.params as { id: string }).id)));

  app.get('/tasks/stats/:projectId', async (req) => taskStats(Number((req.params as { projectId: string }).projectId)));

  app.get('/scheduler/stats', async () => ({
    ...schedulerStats(),
    by_status: all('SELECT status, COUNT(*) AS n FROM render_task GROUP BY status'),
    by_type: all('SELECT task_type, status, COUNT(*) AS n FROM render_task GROUP BY task_type, status')
  }));

  app.post('/scheduler/tick', async () => {
    await tickOnce();
    return { ok: true, ...schedulerStats() };
  });
}
