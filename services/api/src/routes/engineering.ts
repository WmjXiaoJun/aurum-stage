/** 工程文件（平台版 SVML）接口：自动沉淀、复刻、抽象模板 */
import type { FastifyInstance } from 'fastify';
import { all, json } from '../db/index.js';
import { badRequest } from '../http/errors.js';
import { buildEngineering, saveEngineering, latestEngineering, cloneEngineering, abstractToTemplate } from '../domain/engineering-service.js';

export async function registerEngineeringRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:id/engineering', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const latest = latestEngineering(projectId);
    if (latest) return { version: latest.version, status: latest.status, body: latest.body, history: all('SELECT id, version, status, created_at FROM engineering_file WHERE project_id = ? ORDER BY version DESC LIMIT 10', [projectId]) };
    const body = buildEngineering(projectId, 'draft');
    return { version: 0, status: 'draft', body, history: [] };
  });

  app.post('/projects/:id/engineering/rebuild', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { status?: string };
    const saved = saveEngineering(projectId, body.status ?? 'draft');
    const latest = latestEngineering(projectId);
    return { ...saved, body: latest?.body ?? null };
  });

  app.get('/projects/:id/engineering/download', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const latest = latestEngineering(projectId) ?? { body: buildEngineering(projectId, 'draft') };
    reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="engineering-' + projectId + '.json"')
      .send(JSON.stringify(latest.body, null, 2));
  });

  app.post('/projects/:id/engineering/clone', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { name?: string; slots?: Record<string, string | null>; edits?: { line_text_map?: Record<string, string> } };
    return cloneEngineering({ project_id: projectId, name: body.name, slots: body.slots, edits: body.edits });
  });

  // 批量复刻：槽位矩阵一次生成多个变体
  app.post('/projects/:id/engineering/batch-clone', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { grid?: Array<Record<string, string | null>> };
    const grid = Array.isArray(body.grid) ? body.grid : [];
    if (grid.length === 0) throw badRequest('缺少 grid');
    const created: number[] = [];
    for (const slots of grid.slice(0, 12)) {
      const res = cloneEngineering({ project_id: projectId, slots, name: '复刻 · ' + Object.values(slots).filter(Boolean).join('-') });
      created.push(res.project_id);
    }
    return { created, count: created.length };
  });

  app.post('/projects/:id/engineering/abstract', async (req) => {
    return abstractToTemplate(Number((req.params as { id: string }).id));
  });
}

void json;
