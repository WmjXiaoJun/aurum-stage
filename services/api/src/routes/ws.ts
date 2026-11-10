import type { FastifyInstance } from 'fastify';
import { registerClient } from '../ws/hub.js';

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket) => {
    registerClient(socket);
  });
}
