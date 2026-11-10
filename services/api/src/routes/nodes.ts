import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { STYLE_PRESETS } from '@aurum/core';
import { all, get, jstr, json, nowIso, run } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { config } from '../config.js';
import { applyVideoResult, selectNode, type AgentNodeRow } from '../scheduler/executors.js';
import { getTask } from '../scheduler/task-service.js';
import { mapTask } from '../domain/mappers.js';
import { assetKey, createAsset, objectPath } from '../adapters/storage.js';
import { injectWorkflow } from '../adapters/video.js';
import { emit } from '../ws/hub.js';

function checkToken(headers: Record<string, unknown>): void {
  const token = String(headers['x-agent-token'] ?? '');
  if (token !== config.agentToken) throw new Error('AGENT_TOKEN 校验失败');
}

function nodeByKey(nodeKey: string): AgentNodeRow | undefined {
  return get<AgentNodeRow>('SELECT * FROM agent_node WHERE node_key = ?', [nodeKey]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function registerNodeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/nodes', async () => all('SELECT * FROM agent_node ORDER BY id').map((n) => ({ ...n, engine_tags: json(n.engine_tags, []), models_loaded: json(n.models_loaded, []) })));

  app.post('/nodes', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.node_key) throw badRequest('缺少 node_key');
    run(
      'INSERT OR REPLACE INTO agent_node (node_key, base_url, engine_tags, vram_total_gb, vram_free_gb, queue_len, status, models_loaded, last_heartbeat, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        String(body.node_key), String(body.base_url ?? ''), jstr(body.engine_tags ?? ['h3']),
        Number(body.vram_total_gb ?? 24), Number(body.vram_free_gb ?? 24), 0, 'online',
        jstr(body.models_loaded ?? []), nowIso(), nowIso()
      ]
    );
    reply.status(201);
    return nodeByKey(String(body.node_key));
  });

  app.delete('/nodes/:nodeKey', async (req) => {
    run('DELETE FROM agent_node WHERE node_key = ?', [String((req.params as { nodeKey: string }).nodeKey)]);
    return { ok: true };
  });

  // === Agent 内部接口（内网，双向 token） ===
  app.post('/agent/register', async (req) => {
    checkToken(req.headers as Record<string, unknown>);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const nodeKey = String(body.node_key ?? '');
    if (!nodeKey) throw badRequest('缺少 node_key');
    run(
      'INSERT OR REPLACE INTO agent_node (node_key, base_url, engine_tags, vram_total_gb, vram_free_gb, queue_len, status, models_loaded, last_heartbeat, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [nodeKey, String(body.base_url ?? ''), jstr(body.engine_tags ?? []), Number(body.vram_total_gb ?? 24), Number(body.vram_free_gb ?? 24), 0, 'online', jstr(body.models_loaded ?? []), nowIso(), nowIso()]
    );
    return { ok: true, node: nodeByKey(nodeKey) };
  });

  app.post('/agent/heartbeat', async (req) => {
    checkToken(req.headers as Record<string, unknown>);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const nodeKey = String(body.node_key ?? '');
    if (!nodeKey) throw badRequest('缺少 node_key');
    const existing = nodeByKey(nodeKey);
    if (!existing) {
      run(
        'INSERT INTO agent_node (node_key, base_url, engine_tags, vram_total_gb, vram_free_gb, queue_len, status, models_loaded, last_heartbeat, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [nodeKey, String(body.base_url ?? ''), jstr(body.engine_tags ?? []), Number(body.vram_total_gb ?? 24), Number(body.vram_free_gb ?? 24), Number(body.queue_len ?? 0), 'online', jstr(body.models_loaded ?? []), nowIso(), nowIso()]
      );
    } else {
      run('UPDATE agent_node SET engine_tags = ?, vram_total_gb = ?, vram_free_gb = ?, queue_len = ?, status = ?, models_loaded = ?, last_heartbeat = ? WHERE node_key = ?', [
        jstr(body.engine_tags ?? json(existing.engine_tags, [])),
        Number(body.vram_total_gb ?? existing.vram_total_gb ?? 24),
        Number(body.vram_free_gb ?? existing.vram_free_gb ?? 24),
        Number(body.queue_len ?? 0),
        'online',
        jstr(body.models_loaded ?? json(existing.models_loaded, [])),
        nowIso(),
        nodeKey
      ]);
    }
    return { ok: true, next_heartbeat_ms: 10_000 };
  });

  /** 长轮询拉任务（20.4）：有任务 200，无任务 204 */
  app.get('/agent/tasks/pull', async (req, reply) => {
    checkToken(req.headers as Record<string, unknown>);
    const q = req.query as { node?: string; wait?: string };
    const nodeKey = String(q.node ?? '');
    const waitMs = Math.min(30, Number(q.wait ?? 30)) * 1000;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const node = nodeByKey(nodeKey);
      if (!node) throw notFound('节点未注册');
      const row = get(
        "SELECT * FROM render_task WHERE status IN ('assigned','pending') AND (node_id = ? OR node_id IS NULL) AND task_type IN ('comfy_h3','lipsync') ORDER BY priority ASC, created_at ASC LIMIT 1",
        [node.id]
      );
      if (row) {
        const task = mapTask(row);
        const params = task.engine_params as Record<string, unknown>;
        const style = String(params.visual_style ?? 'photoreal');
        const templateKey = String(params.template_key ?? STYLE_PRESETS[style as 'photoreal'].comfy_template_key);
        const tpl = get('SELECT * FROM workflow_template WHERE template_key = ?', [templateKey]);
        const workflowJson = tpl ? json<Record<string, unknown>>(tpl.template_body, {}) : {};
        const paramMap = tpl ? json<Record<string, unknown>>(tpl.param_map, {}) : {};
        run("UPDATE render_task SET status = 'running', node_id = ?, started_at = ?, progress = 10 WHERE id = ?", [node.id, nowIso(), task.id]);
        const injected = injectWorkflow(workflowJson, paramMap, {
          prompt: params.prompt,
          negative_prompt: params.negative,
          target_duration_ms: params.target_duration_ms,
          seed: params.seed,
          ref_image: params.ref_image,
          audio_path: params.audio_path,
          ...params
        });
        return {
          task_id: task.id,
          shot_id: task.shot_id,
          task_type: task.task_type,
          workflow_template: templateKey,
          workflow_json: injected,
          param_map: paramMap,
          params
        };
      }
      await sleep(700);
    }
    reply.status(204).send();
  });

  app.post('/agent/tasks/:id/progress', async (req) => {
    checkToken(req.headers as Record<string, unknown>);
    const taskId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { progress?: number; note?: string };
    const task = getTask(taskId);
    run('UPDATE render_task SET progress = ? WHERE id = ?', [Math.max(0, Math.min(100, Number(body.progress ?? 0))), taskId]);
    emit({ type: 'task.progress', project_id: task.project_id, payload: { task_id: taskId, task_type: task.task_type, shot_id: task.shot_id, progress: Number(body.progress ?? 0), note: body.note } });
    return { ok: true };
  });

  /** Agent 回传产物：可选内联 base64 视频，直接落 MinIO/NFS 同构路径 */
  app.post('/agent/tasks/:id/result', async (req) => {
    checkToken(req.headers as Record<string, unknown>);
    const taskId = Number((req.params as { id: string }).id);
    const task = getTask(taskId);
    const body = (req.body ?? {}) as {
      duration_ms?: number;
      video_base64?: string;
      external_id?: string;
      meta?: Record<string, unknown>;
    };
    let assetId = task.result_asset_id ?? null;
    if (body.video_base64) {
      const key = assetKey('projects', task.project_id, 'render', task.shot_id ?? 0, 'agent_' + taskId + '.mp4');
      fs.mkdirSync(path.dirname(objectPath('assets', key)), { recursive: true });
      fs.writeFileSync(objectPath('assets', key), Buffer.from(body.video_base64, 'base64'));
      const asset = createAsset({
        project_id: task.project_id,
        asset_type: 'video',
        source: task.task_type === 'comfy_h3' ? 'comfy_h3' : 'lipsync',
        key,
        duration_sec: (Number(body.duration_ms ?? 0) || 0) / 1000,
        meta: { agent: true, external_id: body.external_id ?? null, ...(body.meta ?? {}) }
      });
      assetId = asset.id;
    }
    run("UPDATE render_task SET status = 'success', progress = 100, finished_at = ?, result_asset_id = ?, external_task_id = ? WHERE id = ?", [
      nowIso(), assetId, body.external_id ?? task.external_task_id, taskId
    ]);
    if (assetId && task.task_type === 'comfy_h3') {
      applyVideoResult(task, { asset_id: assetId, duration_ms: body.duration_ms });
    }
    if (assetId && task.task_type === 'lipsync' && task.shot_id) {
      run('UPDATE round_shot SET lipsync_asset_id = ?, updated_at = ? WHERE id = ?', [assetId, nowIso(), Number(task.shot_id)]);
    }
    emit({ type: 'task.success', project_id: task.project_id, payload: { task_id: taskId, task_type: task.task_type, shot_id: task.shot_id, asset_id: assetId, agent: true } });
    return { ok: true, asset_id: assetId };
  });

  app.post('/agent/tasks/:id/fail', async (req) => {
    checkToken(req.headers as Record<string, unknown>);
    const taskId = Number((req.params as { id: string }).id);
    const task = getTask(taskId);
    const body = (req.body ?? {}) as { error_code?: string; error_msg?: string };
    run("UPDATE render_task SET status = 'pending', attempt = attempt + 1, error_code = ?, error_msg = ?, node_id = NULL, progress = 0 WHERE id = ?", [
      String(body.error_code ?? 'NODE_ERROR'), String(body.error_msg ?? '节点执行失败'), taskId
    ]);
    emit({ type: 'task.failed', project_id: task.project_id, payload: { task_id: taskId, error_code: body.error_code ?? 'NODE_ERROR', message: body.error_msg } });
    return { ok: true };
  });

  app.get('/nodes/select', async (req) => {
    const tag = String((req.query as { tag?: string }).tag ?? 'h3');
    return selectNode(tag);
  });
}
