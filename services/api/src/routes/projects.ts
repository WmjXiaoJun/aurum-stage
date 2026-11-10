import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SEGMENT_TYPES, VISUAL_STYLES, type VisualStyleId } from '@aurum/core';
import {
  createProject, deleteProject, getProject, listProjects, listSegments, updateProject, rebuildProjectDerived
} from '../domain/project-service.js';
import { complianceOfProject, listShots } from '../domain/script-service.js';
import { addTimelineItem, buildTimeline, deleteTimelineItem, duplicateTimelineItem, listTimeline, splitTimelineItem, updateTimelineItem } from '../domain/timeline-service.js';
import { composeProject, listExports, recordExport } from '../adapters/compose.js';
import { mapSegment, mapShot } from '../domain/mappers.js';
import { listEpisodes } from '../domain/episode-service.js';
import { localizeProject, restoreChinese } from '../domain/localize-service.js';
import { saveEngineering } from '../domain/engineering-service.js';
import { taskStats, listTasks } from '../scheduler/task-service.js';
import { all, get, json, nowIso, run } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { config } from '../config.js';
import { ffmpegPath } from '../media/ffmpeg.js';

const projectSchema = z.object({
  name: z.string().min(1).max(120),
  variety_type: z.enum(['talk_show', 'standup', 'challenge', 'skit']).optional(),
  aspect_ratio: z.string().optional(),
  fps: z.number().int().min(12).max(60).optional(),
  visual_style: z.enum(VISUAL_STYLES as unknown as [string, ...string[]]).optional(),
  style_prompt: z.string().optional(),
  style_negative: z.string().optional(),
  privacy_mode: z.boolean().optional(),
  global_config: z.record(z.unknown()).optional()
});

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', async () => {
    const projects = listProjects();
    return projects.map((p) => {
      const segments = listSegments(p.id);
      const duration = segments.reduce((n, s) => n + s.duration_ms, 0);
      const shots = get('SELECT COUNT(*) AS n FROM round_shot WHERE project_id = ?', [p.id]);
      return { ...p, segment_count: segments.length, shot_count: Number(shots?.n ?? 0), duration_ms: duration };
    });
  });

  app.post('/projects', async (req, reply) => {
    const body = projectSchema.parse(req.body ?? {});
    const project = createProject({ ...body, visual_style: body.visual_style as VisualStyleId | undefined });
    reply.status(201);
    return project;
  });

  app.get('/projects/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getProject(id);
  });

  app.patch('/projects/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const patch = (req.body ?? {}) as Record<string, unknown>;
    const project = updateProject(id, patch);
    rebuildProjectDerived(id);
    return project;
  });

  app.delete('/projects/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    deleteProject(id);
    return { ok: true };
  });

  /** 批次看板：每个项目的渲染进度 / 自动成片 / 导出数量 */
  app.get('/board', async () => {
    const rows = all<Record<string, unknown>>('SELECT id, name, status, auto_compose, aspect_ratio, updated_at FROM project ORDER BY updated_at DESC LIMIT 40');
    return rows.map((p) => {
      const id = Number(p.id);
      const tasks = all<Record<string, unknown>>('SELECT status, task_type FROM render_task WHERE project_id = ?', [id]);
      const pending = tasks.filter((t) => ['pending', 'assigned', 'running'].includes(String(t.status))).length;
      const failed = tasks.filter((t) => String(t.status) === 'failed').length;
      const exportsCount = Number(get('SELECT COUNT(*) AS n FROM compose_export WHERE project_id = ?', [id])?.n ?? 0);
      const totalShots = Number(get('SELECT COUNT(*) AS n FROM round_shot WHERE project_id = ?', [id])?.n ?? 0);
      const generated = Number(get('SELECT COUNT(*) AS n FROM round_shot WHERE project_id = ? AND preview_asset_id IS NOT NULL', [id])?.n ?? 0);
      return { id, name: String(p.name), status: String(p.status), auto_compose: Number(p.auto_compose ?? 0), aspect_ratio: String(p.aspect_ratio ?? ''), pending, failed, exports: exportsCount, generated, total_shots: totalShots };
    });
  });

  app.get('/projects/:id/overview', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const episodeId = Number((req.query as { episode_id?: string }).episode_id ?? 0);
    const project = getProject(id);
    const segments = episodeId
      ? all('SELECT * FROM segment WHERE project_id = ? AND episode_id = ? ORDER BY seq', [id, episodeId]).map((r) => mapSegment(r as never))
      : listSegments(id);
    const shots = episodeId
      ? all('SELECT s.* FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.project_id = ? AND g.episode_id = ? ORDER BY g.seq, s.seq', [id, episodeId]).map((r) => mapShot(r as never, []))
      : listShots(id);
    const compliance = complianceOfProject(id);
    const issues = all('SELECT * FROM quality_issue WHERE project_id = ? AND resolved = 0 ORDER BY id DESC LIMIT 20', [id]);
    const exportsList = listExports(id).slice(0, 5);
    const latestScript = get('SELECT * FROM script WHERE project_id = ? ORDER BY version DESC LIMIT 1', [id]);
    return {
      project,
      episodes: listEpisodes(id),
      segments,
      shots,
      compliance,
      stats: {
        segments: segments.length,
        shots: shots.length,
        duration_ms: compliance.reduce((n, c) => n + c.duration_ms, 0),
        near_cap: compliance.filter((c) => c.status === 'near').length,
        exceed: compliance.filter((c) => c.status === 'exceed').length,
        locked: shots.filter((s) => s.locked).length,
        generated: shots.filter((s) => ['generated', 'reviewed', 'locked'].includes(s.status)).length,
        tasks: taskStats(id)
      },
      issues,
      exports: exportsList,
      script: latestScript ? { id: Number(latestScript.id), version: Number(latestScript.version), parse_status: String(latestScript.parse_status) } : null,
      runtime: { ffmpeg: !!ffmpegPath(), segment_cap_sec: project.segment_cap_sec }
    };
  });

  /** 项目封面：取最近的抽帧海报，供项目卡片做缩略图 */
  app.get('/projects/:id/covers', async (req) => {
    const id = Number((req.params as { id: string }).id);
    // 封面来源：图片资产 → 视频资产里的抽帧海报（meta.poster_asset_id）
    const images = all<Record<string, unknown>>("SELECT id FROM asset WHERE project_id = ? AND asset_type = 'image' ORDER BY id DESC LIMIT 6", [id]);
    const list = images.map((r) => '/api/v1/assets/' + Number(r.id) + '/raw');
    if (list.length === 0) {
      const videos = all<Record<string, unknown>>("SELECT meta FROM asset WHERE project_id = ? AND asset_type = 'video' ORDER BY id DESC LIMIT 12", [id]);
      const posterIds: number[] = [];
      for (const v of videos) {
        try {
          const meta = JSON.parse(String(v.meta ?? '{}')) as { poster_asset_id?: number; source_asset_id?: number };
          if (meta.poster_asset_id) posterIds.push(Number(meta.poster_asset_id));
        } catch { /* ignore */ }
      }
      for (const pid of posterIds.slice(0, 6)) list.push('/api/v1/assets/' + pid + '/raw');
    }
    return { covers: list };
  });

  app.get('/projects/:id/compliance', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const project = getProject(id);
    return { cap_sec: project.segment_cap_sec, items: complianceOfProject(id) };
  });

  // 环节
  app.get('/projects/:id/segments', async (req) => listSegments(Number((req.params as { id: string }).id)));

  app.post('/projects/:id/segments', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { title?: string; segment_type?: string; default_engine?: string };
    const maxSeq = get('SELECT MAX(seq) AS m FROM segment WHERE project_id = ?', [projectId]);
    const seq = Number(maxSeq?.m ?? 0) + 1;
    const res = run('INSERT INTO segment (project_id, seq, segment_type, title, default_engine, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)', [
      projectId,
      seq,
      SEGMENT_TYPES.includes(String(body.segment_type) as never) ? String(body.segment_type) : 'talk_round',
      body.title ?? '新环节 ' + seq,
      body.default_engine === 'comfy_h3' ? 'comfy_h3' : 'muse_api',
      0,
      nowIso()
    ]);
    reply.status(201);
    return get('SELECT * FROM segment WHERE id = ?', [res.lastInsertRowid]);
  });

  app.patch('/segments/:segmentId', async (req) => {
    const segmentId = Number((req.params as { segmentId: string }).segmentId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['title', 'segment_type', 'default_engine', 'visual_style']) {
      if (key in body) {
        fields.push(key + ' = ?');
        values.push(body[key]);
      }
    }
    if (fields.length) {
      values.push(segmentId);
      run('UPDATE segment SET ' + fields.join(', ') + ' WHERE id = ?', values);
    }
    return get('SELECT * FROM segment WHERE id = ?', [segmentId]);
  });

  app.delete('/segments/:segmentId', async (req) => {
    const segmentId = Number((req.params as { segmentId: string }).segmentId);
    const seg = get('SELECT * FROM segment WHERE id = ?', [segmentId]);
    if (!seg) throw notFound('环节不存在');
    run('DELETE FROM segment WHERE id = ?', [segmentId]);
    rebuildProjectDerived(Number(seg.project_id));
    return { ok: true };
  });

  // 时间轴
  app.get('/projects/:id/timeline', async (req) => listTimeline(Number((req.params as { id: string }).id)));

  app.post('/projects/:id/timeline/rebuild', async (req) => {
    buildTimeline(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  app.patch('/timeline/:itemId', async (req) => {
    const itemId = Number((req.params as { itemId: string }).itemId);
    return updateTimelineItem(itemId, (req.body ?? {}) as Record<string, unknown>);
  });

  app.post('/projects/:id/timeline', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { track?: string; start_ms?: number; end_ms?: number; payload?: Record<string, unknown> };
    if (!body.track) throw badRequest('缺少 track');
    const item = addTimelineItem(projectId, {
      track: body.track,
      start_ms: Number(body.start_ms ?? 0),
      end_ms: Number(body.end_ms ?? 1000),
      payload: body.payload ?? {}
    });
    reply.status(201);
    return item;
  });

  app.delete('/timeline/:itemId', async (req) => {
    deleteTimelineItem(Number((req.params as { itemId: string }).itemId));
    return { ok: true };
  });

  app.post('/timeline/:itemId/split', async (req) => {
    const itemId = Number((req.params as { itemId: string }).itemId);
    const body = (req.body ?? {}) as { at_ms?: number };
    return splitTimelineItem(itemId, Number(body.at_ms ?? 0));
  });

  app.post('/timeline/:itemId/duplicate', async (req) => {
    const itemId = Number((req.params as { itemId: string }).itemId);
    return duplicateTimelineItem(itemId);
  });

  // 出海本地化
  app.post('/projects/:id/localize', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { language?: string };
    const language = String(body.language ?? 'en');
    const result = await localizeProject(projectId, language);
    return result;
  });

  app.delete('/projects/:id/localize', async (req) => {
    return restoreChinese(Number((req.params as { id: string }).id));
  });

  // 合成导出
  app.post('/projects/:id/compose', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { segment_id?: number; bgm?: boolean };
    const result = await composeProject({ project_id: projectId, segment_id: body.segment_id ?? null, bgm: body.bgm !== false });
    // 生产即模板：出片后自动把工程文件归档为可复刻版本
    try { saveEngineering(projectId, 'renderable'); } catch { /* 工程归档失败不影响出片 */ }
    // 手动合成也写一条导出记录，和自动成片保持同一份历史
    try {
      recordExport({
        project_id: projectId,
        segment_id: body.segment_id ?? null,
        task_id: null,
        status: result.mode,
        duration_ms: result.total_ms,
        video_asset_id: result.video_asset_id ?? null,
        subtitle_asset_id: result.subtitle_asset_id ?? null,
        ass_asset_id: result.ass_asset_id ?? null,
        manifest: result.manifest as Record<string, unknown>,
        error_code: null,
        error_msg: result.warnings.join('；') || null
      });
    } catch { /* ignore */ }
    return {
      mode: result.mode,
      duration_sec: result.duration_sec,
      video_url: result.video_asset_id ? '/api/v1/assets/' + result.video_asset_id + '/raw' : null,
      subtitle_url: '/api/v1/assets/' + result.subtitle_asset_id + '/raw',
      ass_url: '/api/v1/assets/' + result.ass_asset_id + '/raw',
      warnings: result.warnings,
      manifest: result.manifest
    };
  });

  app.get('/projects/:id/exports', async (req) => listExports(Number((req.params as { id: string }).id)));

  // 质检问题
  app.get('/projects/:id/issues', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const resolved = (req.query as { resolved?: string }).resolved;
    const sql = resolved === 'all'
      ? 'SELECT * FROM quality_issue WHERE project_id = ? ORDER BY id DESC'
      : 'SELECT * FROM quality_issue WHERE project_id = ? AND resolved = 0 ORDER BY id DESC';
    return all(sql, [id]);
  });

  app.patch('/issues/:issueId', async (req) => {
    const issueId = Number((req.params as { issueId: string }).issueId);
    const body = (req.body ?? {}) as { resolved?: boolean };
    run('UPDATE quality_issue SET resolved = ? WHERE id = ?', [body.resolved === false ? 0 : 1, issueId]);
    return get('SELECT * FROM quality_issue WHERE id = ?', [issueId]);
  });

  // 线索（一致性）
  app.get('/projects/:id/clues', async (req) => all('SELECT * FROM clue WHERE project_id = ? ORDER BY id', [Number((req.params as { id: string }).id)]));

  app.post('/projects/:id/clues', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { clue_key?: string; kind?: string; description?: string; anchor?: string };
    if (!body.clue_key || !body.description) throw badRequest('缺少 clue_key / description');
    run('INSERT OR REPLACE INTO clue (project_id, clue_key, kind, description, anchor, pinned, created_at) VALUES (?,?,?,?,?,1,?)', [
      projectId, body.clue_key, body.kind ?? 'prop', body.description, body.anchor ?? '', nowIso()
    ]);
    reply.status(201);
    return get('SELECT * FROM clue WHERE project_id = ? AND clue_key = ?', [projectId, body.clue_key]);
  });

  app.delete('/clues/:clueId', async (req) => {
    run('DELETE FROM clue WHERE id = ?', [Number((req.params as { clueId: string }).clueId)]);
    return { ok: true };
  });

  app.get('/projects/:id/tasks', async (req) => listTasks({ project_id: Number((req.params as { id: string }).id), limit: 200 }));

  app.get('/projects/:id/assets', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const type = (req.query as { type?: string }).type;
    const rows = type
      ? all('SELECT * FROM asset WHERE project_id = ? AND asset_type = ? ORDER BY id DESC LIMIT 200', [id, type])
      : all('SELECT * FROM asset WHERE project_id = ? ORDER BY id DESC LIMIT 200', [id]);
    return rows.map((r) => ({ ...r, meta: json(r.meta, {}), url: '/api/v1/assets/' + Number(r.id) + '/raw' }));
  });

  app.get('/runtime', async () => ({
    ffmpeg: ffmpegPath(),
    segment_cap_sec: config.segmentCapSec,
    scheduler: config.scheduler,
    tts_worker: config.tts.workerUrl,
    comfy_simulate: config.comfy.simulate,
    muse_failure_rate: config.muse.simulateFailureRate
  }));
}
