import type { FastifyInstance } from 'fastify';
import { STYLE_LIST, composePrompt, stylePreset } from '@aurum/core';
import { all, get, jstr, json, nowIso, run } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { findAsset } from '../adapters/storage.js';
import { getProject } from '../domain/project-service.js';

const GRID_LAYOUTS: Record<string, Array<{ x: number; y: number; w: number; h: number }>> = {
  grid_4: [
    { x: 0, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
  ],
  grid_6: [
    { x: 0, y: 0, w: 0.5, h: 0.33 },
    { x: 0.5, y: 0, w: 0.5, h: 0.33 },
    { x: 0, y: 0.33, w: 0.5, h: 0.34 },
    { x: 0.5, y: 0.33, w: 0.5, h: 0.34 },
    { x: 0, y: 0.67, w: 0.5, h: 0.33 },
    { x: 0.5, y: 0.67, w: 0.5, h: 0.33 }
  ],
  grid_9: Array.from({ length: 9 }, (_, i) => ({ x: (i % 3) / 3, y: Math.floor(i / 3) / 3, w: 1 / 3, h: 1 / 3 }))
};

export async function registerStyleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/styles', async () => STYLE_LIST);

  app.get('/styles/:id', async (req) => {
    const id = String((req.params as { id: string }).id);
    const preset = STYLE_LIST.find((s) => s.id === id);
    if (!preset) throw notFound('风格不存在');
    return preset;
  });

  app.post('/styles/preview-prompt', async (req) => {
    const body = (req.body ?? {}) as { style_id?: string; content?: string; anchor?: string; camera_language?: string };
    return {
      prompt: composePrompt({
        styleId: body.style_id ?? 'photoreal',
        content: body.content ?? '',
        anchor: body.anchor,
        camera_language: body.camera_language
      }),
      negative: stylePreset(body.style_id).negative
    };
  });

  /** 风格参考图：上传后登记为项目风格锚点（vision 分析可选） */
  app.post('/projects/:id/style-ref', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { asset_id?: number; apply_prefix?: string };
    if (!body.asset_id) throw badRequest('缺少 asset_id');
    const asset = findAsset(Number(body.asset_id));
    if (!asset) throw notFound('素材不存在');
    const project = getProject(projectId);
    const prefix = body.apply_prefix ? String(body.apply_prefix) : project.style_prompt;
    run('UPDATE project SET style_ref_asset_id = ?, style_prompt = ?, updated_at = ? WHERE id = ?', [asset.id, prefix, nowIso(), projectId]);
    return { ok: true, style_ref_asset_id: asset.id, style_prompt: prefix, analysis_prompt: stylePreset(project.visual_style).ref_analysis_prompt };
  });

  // 漫画面板 / 宫格 / webtoon
  app.get('/comic/panels', async (req) => {
    const projectId = Number((req.query as { project_id?: string }).project_id ?? 0);
    if (!projectId) throw badRequest('缺少 project_id');
    return all('SELECT * FROM comic_panel WHERE project_id = ? ORDER BY seq', [projectId]).map((p) => ({ ...p, panel_json: json(p.panel_json, {}) }));
  });

  app.post('/comic/panels', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const projectId = Number(body.project_id ?? 0);
    if (!projectId) throw badRequest('缺少 project_id');
    const maxSeq = get('SELECT MAX(seq) AS m FROM comic_panel WHERE project_id = ?', [projectId]);
    const layout = String(body.layout ?? 'grid_4');
    const res = run('INSERT INTO comic_panel (project_id, segment_id, shot_id, seq, layout, panel_json, created_at) VALUES (?,?,?,?,?,?,?)', [
      projectId, body.segment_id ?? null, body.shot_id ?? null, Number(maxSeq?.m ?? 0) + 1, layout,
      jstr({ panels: GRID_LAYOUTS[layout] ?? GRID_LAYOUTS.grid_4, ...(body.panel_json as Record<string, unknown> ?? {}) }), nowIso()
    ]);
    reply.status(201);
    return get('SELECT * FROM comic_panel WHERE id = ?', [res.lastInsertRowid]);
  });

  app.patch('/comic/panels/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['layout', 'seq', 'preview_asset_id']) {
      if (key in body) { fields.push(key + ' = ?'); values.push(body[key]); }
    }
    if ('panel_json' in body) { fields.push('panel_json = ?'); values.push(jstr({ panels: GRID_LAYOUTS[String(body.layout ?? 'grid_4')] ?? GRID_LAYOUTS.grid_4, ...(body.panel_json as Record<string, unknown>) })); }
    if (fields.length) { values.push(id); run('UPDATE comic_panel SET ' + fields.join(', ') + ' WHERE id = ?', values); }
    return get('SELECT * FROM comic_panel WHERE id = ?', [id]);
  });

  app.delete('/comic/panels/:id', async (req) => {
    run('DELETE FROM comic_panel WHERE id = ?', [Number((req.params as { id: string }).id)]);
    return { ok: true };
  });

  /** webtoon 纵向长条：按 seq 顺序输出面板与总高 */
  app.get('/comic/webtoon', async (req) => {
    const projectId = Number((req.query as { project_id?: string }).project_id ?? 0);
    if (!projectId) throw badRequest('缺少 project_id');
    const panels = all('SELECT * FROM comic_panel WHERE project_id = ? ORDER BY seq', [projectId]).map((p) => ({ ...p, panel_json: json(p.panel_json, {}) }));
    return {
      project_id: projectId,
      mode: 'webtoon-scroll',
      panels: panels.map((p, i) => ({ ...p, index: i, height_ratio: 1.4 })),
      total_ratio: panels.length * 1.4
    };
  });
}
