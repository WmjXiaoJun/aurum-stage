import type { FastifyInstance } from 'fastify';
import { type Camera } from '@aurum/core';
import { all, get, json, run } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { getProject } from '../domain/project-service.js';
import {
  assertSegmentCompliance, createShot, deleteShot, listShots, patchedShot, reorderShots, segmentShots
} from '../domain/script-service.js';
import { submitShotRender, submitShotTts, taskDag, listTasks } from '../scheduler/task-service.js';
import { findAsset } from '../adapters/storage.js';
import { mapShot } from '../domain/mappers.js';

export async function registerShotRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:id/shots', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const q = req.query as { segment_id?: string; status?: string; engine?: string; search?: string };
    return listShots(projectId, {
      segment_id: q.segment_id ? Number(q.segment_id) : undefined,
      status: q.status,
      engine: q.engine,
      search: q.search
    });
  });

  app.get('/segments/:segmentId/shots', async (req) => segmentShots(Number((req.params as { segmentId: string }).segmentId)));

  app.get('/shots/:shotId', async (req) => {
    const shotId = Number((req.params as { shotId: string }).shotId);
    const row = get('SELECT s.*, g.seq AS segment_seq, g.title AS segment_title FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.id = ?', [shotId]);
    if (!row) throw notFound('镜头不存在');
    const projectId = Number(row.project_id);
    return {
      shot: mapShot(row),
      tasks: taskDag(shotId),
      project: getProject(projectId),
      audio_candidates: all("SELECT * FROM shot_candidate WHERE shot_id = ? AND kind = 'tts' ORDER BY idx", [shotId]),
      video_candidates: all("SELECT * FROM shot_candidate WHERE shot_id = ? AND kind = 'video' ORDER BY idx", [shotId])
    };
  });

  app.patch('/shots/:shotId', async (req) => {
    const shotId = Number((req.params as { shotId: string }).shotId);
    return patchedShot(shotId, (req.body ?? {}) as Record<string, unknown>);
  });

  app.delete('/shots/:shotId', async (req) => {
    deleteShot(Number((req.params as { shotId: string }).shotId));
    return { ok: true };
  });

  app.post('/segments/:segmentId/shots', async (req, reply) => {
    const segmentId = Number((req.params as { segmentId: string }).segmentId);
    const seg = get('SELECT * FROM segment WHERE id = ?', [segmentId]);
    if (!seg) throw notFound('环节不存在');
    const shot = createShot(Number(seg.project_id), segmentId, (req.body ?? {}) as Record<string, unknown>);
    reply.status(201);
    return shot;
  });

  app.post('/segments/:segmentId/reorder', async (req) => {
    const segmentId = Number((req.params as { segmentId: string }).segmentId);
    const body = (req.body ?? {}) as { ordered_ids?: number[] };
    if (!Array.isArray(body.ordered_ids)) throw badRequest('缺少 ordered_ids');
    reorderShots(segmentId, body.ordered_ids.map(Number));
    return segmentShots(segmentId);
  });

  /** 提交渲染：先做段时长硬校验（>300s 直接拒绝，不建任务、不产生计费） */
  app.post('/shots/:shotId/render', async (req) => {
    const shotId = Number((req.params as { shotId: string }).shotId);
    const body = (req.body ?? {}) as { candidates?: number; overrides?: Record<string, unknown>; tts_only?: boolean; force?: boolean };
    const row = get('SELECT * FROM round_shot WHERE id = ?', [shotId]);
    if (!row) throw notFound('镜头不存在');
    const projectId = Number(row.project_id);
    assertSegmentCompliance(projectId, Number(row.segment_id));
    const result = submitShotRender(shotId, {
      candidates: body.candidates,
      overrides: body.overrides,
      tts_only: body.tts_only,
      force: body.force
    });
    return {
      shot_id: shotId,
      task_dag: result.tasks.map((t) => ({ task_id: t.id, type: t.task_type, status: t.status, depends_on: t.depends_on })),
      replays: result.replays
    };
  });

  /** 单独重配某句台词（不渲染画面） */
  app.post('/shots/:shotId/tts', async (req) => {
    const shotId = Number((req.params as { shotId: string }).shotId);
    const body = (req.body ?? {}) as { overrides?: Record<string, unknown>; candidates?: number };
    const result = submitShotTts(shotId, { overrides: body.overrides, candidates: body.candidates ?? 3 });
    return {
      task_id: result.task.id,
      preview_url: result.preview_url,
      duration_ms_estimated: null,
      status: result.task.status
    };
  });

  app.get('/shots/:shotId/audio', async (req) => {
    const shotId = Number((req.params as { shotId: string }).shotId);
    const candidates = all("SELECT * FROM shot_candidate WHERE shot_id = ? AND kind = 'tts' ORDER BY idx", [shotId]);
    return candidates.map((c) => ({
      id: Number(c.id),
      idx: Number(c.idx),
      state: String(c.state),
      duration_ms: c.duration_ms == null ? null : Number(c.duration_ms),
      url: '/api/v1/assets/' + Number(c.asset_id) + '/raw',
      meta: json(c.meta, {})
    }));
  });

  app.get('/shots/:shotId/tasks', async (req) => {
    const shotId = Number((req.params as { shotId: string }).shotId);
    return listTasks({ shot_id: shotId });
  });

  app.post('/shots/:shotId/lock', async (req) => {
    const shotId = Number((req.params as { shotId: string }).shotId);
    const body = (req.body ?? {}) as { locked?: boolean };
    return patchedShot(shotId, { locked: body.locked !== false, status: body.locked === false ? 'generated' : 'locked' });
  });

  app.post('/shots/:shotId/candidates/:candidateId/select', async (req) => {
    const shotId = Number((req.params as { shotId: string }).shotId);
    const candidateId = Number((req.params as { candidateId: string }).candidateId);
    const cand = get('SELECT * FROM shot_candidate WHERE id = ? AND shot_id = ?', [candidateId, shotId]);
    if (!cand) throw notFound('候选不存在');
    const kind = String(cand.kind);
    run("UPDATE shot_candidate SET state = 'ready' WHERE shot_id = ? AND kind = ?", [shotId, kind]);
    run("UPDATE shot_candidate SET state = 'selected' WHERE id = ?", [candidateId]);
    const assetId = cand.asset_id == null ? null : Number(cand.asset_id);
    if (kind === 'tts' && assetId) {
      const duration = cand.duration_ms == null ? null : Number(cand.duration_ms);
      run('UPDATE round_shot SET tts_asset_id = ?, tts_duration_ms = ?, duration_ms = ?, updated_at = ? WHERE id = ?', [
        assetId, duration, duration == null ? null : duration + 300, new Date().toISOString(), shotId
      ]);
    }
    if (kind === 'video' && assetId) {
      run('UPDATE round_shot SET preview_asset_id = ?, updated_at = ? WHERE id = ?', [assetId, new Date().toISOString(), shotId]);
    }
    const shotRow = get('SELECT s.*, g.seq AS segment_seq, g.title AS segment_title FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.id = ?', [shotId]);
    return mapShot(shotRow as Record<string, unknown>);
  });

  /** 批量渲染（跳过 locked 片段） */
  app.post('/projects/:id/render-all', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { segment_id?: number; force?: boolean; candidates?: number };
    const shots = listShots(projectId, body.segment_id ? { segment_id: body.segment_id } : {});
    assertSegmentCompliance(projectId, body.segment_id ?? null);
    const created: Array<{ shot_id: number; tasks: number[] }> = [];
    for (const shot of shots) {
      if (shot.locked) continue;
      const res = submitShotRender(shot.id, { candidates: body.candidates, force: body.force });
      created.push({ shot_id: shot.id, tasks: res.tasks.map((t) => t.id) });
    }
    return { submitted: created.length, tasks: created };
  });

  app.get('/projects/:id/shot-codes', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    return all('SELECT shot_code FROM round_shot WHERE project_id = ? ORDER BY id', [projectId]);
  });
}
