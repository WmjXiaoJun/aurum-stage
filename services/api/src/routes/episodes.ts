/** 多期接口 */
import type { FastifyInstance } from 'fastify';
import { listEpisodes, createEpisode, getEpisode, updateEpisode, cloneEpisode } from '../domain/episode-service.js';

export async function registerEpisodeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:id/episodes', async (req) => listEpisodes(Number((req.params as { id: string }).id)));
  app.post('/projects/:id/episodes', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const row = createEpisode(Number((req.params as { id: string }).id), body);
    reply.status(201);
    return row;
  });
  app.get('/episodes/:id', async (req) => getEpisode(Number((req.params as { id: string }).id)));
  app.patch('/episodes/:id', async (req) => updateEpisode(Number((req.params as { id: string }).id), (req.body ?? {}) as Record<string, unknown>));
  app.post('/episodes/:id/clone', async (req, reply) => {
    const body = (req.body ?? {}) as { visual_style?: string; language?: string; title?: string };
    reply.status(201);
    return cloneEpisode(Number((req.params as { id: string }).id), body);
  });
}
