import type { FastifyInstance } from 'fastify';
import {
  checkHealth, deleteProvider, discoverModels, getProjectOverride, getProvider, listProviders,
  setProjectOverride, upsertProvider, usageSummary
} from '../llm/service.js';
import { badRequest } from '../http/errors.js';

export async function registerLlmRoutes(app: FastifyInstance): Promise<void> {
  app.get('/llm/providers', async () => listProviders());

  app.post('/llm/providers', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.provider_key || !body.base_url) throw badRequest('缺少 provider_key / base_url');
    const provider = upsertProvider({
      provider_key: String(body.provider_key),
      display_name: body.display_name ? String(body.display_name) : undefined,
      protocol: body.protocol ? String(body.protocol) : undefined,
      base_url: String(body.base_url),
      api_keys: Array.isArray(body.api_keys) ? (body.api_keys as string[]) : undefined,
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
      is_default: body.is_default === undefined ? undefined : Boolean(body.is_default),
      meta: (body.meta as Record<string, unknown>) ?? undefined
    });
    reply.status(201);
    return provider;
  });

  app.patch('/llm/providers/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const current = getProvider(id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    return upsertProvider({
      provider_key: current.provider_key,
      display_name: body.display_name ? String(body.display_name) : current.display_name,
      protocol: body.protocol ? String(body.protocol) : current.protocol,
      base_url: body.base_url ? String(body.base_url) : current.base_url,
      api_keys: Array.isArray(body.api_keys) ? (body.api_keys as string[]) : current.api_keys,
      enabled: body.enabled === undefined ? Boolean(current.enabled) : Boolean(body.enabled),
      is_default: body.is_default === undefined ? Boolean(current.is_default) : Boolean(body.is_default),
      meta: (body.meta as Record<string, unknown>) ?? current.meta
    });
  });

  app.delete('/llm/providers/:id', async (req) => {
    deleteProvider(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  app.post('/llm/providers/:id/discover', async (req) => {
    const models = await discoverModels(Number((req.params as { id: string }).id));
    return { count: models.length, models };
  });

  app.post('/llm/providers/:id/health', async (req) => checkHealth(Number((req.params as { id: string }).id)));

  app.get('/llm/usage', async (req) => usageSummary(Number((req.query as { days?: string }).days ?? 7)));

  app.get('/projects/:id/llm', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    return { providers: listProviders(), override: getProjectOverride(projectId) };
  });

  app.put('/projects/:id/llm', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { provider_id?: number | null; model_id?: string | null; params?: Record<string, unknown> };
    setProjectOverride(projectId, body);
    return getProjectOverride(projectId);
  });
}
