/** 任务 DAG（10.2）：tts → video → lipsync，合成任务独立。 */
import type { RenderTask, Shot } from '@aurum/core';
import { TASK_PRIORITY, type TaskType } from '@aurum/core';
import { all, get, jstr, json, nowIso, run } from '../db/index.js';
import { mapTask } from '../domain/mappers.js';
import { mapShot } from '../domain/mappers.js';
import { sha256 } from '../util.js';
import { ApiError, notFound } from '../http/errors.js';
import { emit } from '../ws/hub.js';
import { comfyDefaultTemplate } from '../domain/settings-service.js';

export interface CreateTaskInput {
  project_id: number;
  shot_id?: number | null;
  segment_id?: number | null;
  task_type: TaskType;
  engine: string;
  engine_params?: Record<string, unknown>;
  idempotency_key: string;
  depends_on?: number[];
  priority?: number;
  max_attempt?: number;
  meta?: Record<string, unknown>;
}

export function createTask(input: CreateTaskInput): { task: RenderTask; replay: boolean } {
  const existing = get('SELECT * FROM render_task WHERE idempotency_key = ?', [input.idempotency_key]);
  if (existing) {
    return { task: mapTask(existing), replay: true };
  }
  const now = nowIso();
  const res = run(
    'INSERT INTO render_task (project_id, shot_id, segment_id, task_type, engine, engine_params, idempotency_key, status, priority, node_id, external_task_id, attempt, max_attempt, depends_on, progress, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      input.project_id, input.shot_id ?? null, input.segment_id ?? null, input.task_type, input.engine,
      jstr(input.engine_params ?? {}), input.idempotency_key, 'pending', input.priority ?? TASK_PRIORITY[input.task_type] ?? 5,
      null, null, 0, input.max_attempt ?? 2, jstr(input.depends_on ?? []), 0, jstr(input.meta ?? {}), now
    ]
  );
  const row = get('SELECT * FROM render_task WHERE id = ?', [res.lastInsertRowid]);
  return { task: mapTask(row as Record<string, unknown>), replay: false };
}

/** 队列排空后自动合成：项目开启 auto_compose 时，任务全部结束即排队一次合成 */
export function maybeAutoCompose(projectId: number): number | null {
  const project = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!project || Number(project.auto_compose) !== 1) return null;
  const pending = get("SELECT COUNT(*) AS n FROM render_task WHERE project_id = ? AND status IN ('pending','assigned','running')", [projectId]);
  if (Number(pending?.n ?? 0) > 0) return null;
  const generated = get('SELECT COUNT(*) AS n FROM round_shot WHERE project_id = ? AND preview_asset_id IS NOT NULL', [projectId]);
  if (Number(generated?.n ?? 0) === 0) return null;
  const recent = get('SELECT created_at FROM compose_export WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
  if (recent && Date.now() - new Date(String(recent.created_at)).getTime() < 120000) return null;
  const res = createTask({
    project_id: projectId,
    shot_id: null,
    task_type: 'compose',
    engine: 'ffmpeg',
    engine_params: { bgm: true },
    idempotency_key: 'auto-compose-' + projectId + '-' + Math.floor(Date.now() / 60000),
    priority: 6,
    max_attempt: 1,
    meta: { bgm: true, auto: true }
  });
  emit({ type: 'compose.progress', project_id: projectId, payload: { task_id: res.task.id, progress: 0, auto: true, status: 'queued' } });
  return res.task.id;
}

export function getTask(id: number): RenderTask {
  const row = get('SELECT * FROM render_task WHERE id = ?', [id]);
  if (!row) throw notFound('任务不存在：' + id);
  return mapTask(row);
}

export interface TaskFilter {
  project_id?: number;
  shot_id?: number;
  status?: string;
  task_type?: string;
  limit?: number;
}

export function listTasks(filter: TaskFilter = {}): RenderTask[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.project_id) { where.push('project_id = ?'); params.push(filter.project_id); }
  if (filter.shot_id) { where.push('shot_id = ?'); params.push(filter.shot_id); }
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  if (filter.task_type) { where.push('task_type = ?'); params.push(filter.task_type); }
  const sql = 'SELECT * FROM render_task' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ' + Number(filter.limit ?? 200);
  return all(sql, params).map(mapTask);
}

export function taskDag(shotId: number): RenderTask[] {
  return all('SELECT * FROM render_task WHERE shot_id = ? ORDER BY id ASC', [shotId]).map(mapTask);
}

export function idempotencyFor(kind: string, parts: Array<string | number | null | undefined>): string {
  return sha256(kind + '|' + parts.map((p) => (p == null ? '' : String(p))).join('|'));
}

export interface ShotForTask {
  id: number;
  project_id: number;
  segment_id: number;
  shot_code: string;
  text_clean: string | null;
  lines: string[];
  emotion: string | null;
  emotion_instruction: string | null;
  voice_id: string | null;
  tts_engine: string | null;
  tts_speed: number;
  render_engine: string;
  visual_prompt: string | null;
  negative_prompt: string | null;
  engine_params: Record<string, unknown>;
  camera: string;
  lipsync_required: number | boolean;
  native_audio: number | boolean;
  privacy: number | boolean;
  speaker_role_id: string | null;
  visual_style: string;
  duration_ms: number;
  locked: number | boolean;
}

export function loadShot(shotId: number): ShotForTask {
  const row = get('SELECT * FROM round_shot WHERE id = ?', [shotId]);
  if (!row) throw notFound('镜头不存在');
  const project = get('SELECT aspect_ratio, fps FROM project WHERE id = ?', [Number(row.project_id)]);
  return { ...(row as unknown as ShotForTask), aspect_ratio: project?.aspect_ratio } as ShotForTask;
}

export interface RenderOptions {
  candidates?: number;
  overrides?: Record<string, unknown>;
  tts_only?: boolean;
  force?: boolean;
}

export interface SubmitResult {
  shot_id: number;
  tasks: RenderTask[];
  replays: number[];
  blocked: boolean;
}

/** 提交镜头渲染：自动建立 tts → video → lipsync 依赖链（9.1 / 20.1） */
export function submitShotRender(shotId: number, opts: RenderOptions = {}): SubmitResult {
  const row = get('SELECT * FROM round_shot WHERE id = ?', [shotId]);
  if (!row) throw notFound('镜头不存在');
  const shot = mapShot(row);
  const nonce = opts.force ? ':' + Date.now() : '';
  const overrides = opts.overrides ?? {};

  const engine = String(overrides.render_engine ?? shot.render_engine);
  // 覆盖引擎时把镜头字段一并落库，避免界面仍显示旧引擎（产物明明是云端出的）
  if (overrides.render_engine && String(overrides.render_engine) !== shot.render_engine) {
    run('UPDATE round_shot SET render_engine = ?, updated_at = ? WHERE id = ?', [engine, nowIso(), shot.id]);
  }
  const emotion = String(overrides.emotion ?? shot.emotion ?? '');
  const instruction = String(overrides.emotion_instruction ?? shot.emotion_instruction ?? '');
  const speed = Number(overrides.tts_speed ?? shot.tts_speed ?? 1);
  const text = shot.text_clean || shot.lines.join(' ');

  const hasText = text.trim().length > 0;
  const tasks: RenderTask[] = [];
  const replays: number[] = [];
  let ttsTaskId: number | null = null;

  // 空镜（无台词）不建 TTS 任务：直接出画面，避免上游必然失败把整条链阻断
  if (hasText) {
    const ttsKey = idempotencyFor('tts', [shot.id, text, emotion, instruction, speed, shot.voice_id, shot.tts_engine, nonce]);
    const tts = createTask({
      project_id: shot.project_id,
      shot_id: shot.id,
      segment_id: shot.segment_id,
      task_type: 'tts',
      engine: shot.tts_engine ?? 'indextts2',
      engine_params: { voice_id: shot.voice_id, emotion, emotion_instruction: instruction, speed, candidates: opts.candidates ?? 3 },
      idempotency_key: ttsKey,
      meta: { text }
    });
    tasks.push(tts.task);
    ttsTaskId = tts.task.id;
    if (tts.replay) replays.push(tts.task.id);
  } else if (opts.tts_only) {
    throw new ApiError('PARAM_INVALID', '空镜没有台词，无法单独配音');
  }

  if (!opts.tts_only) {
    if (shot.privacy && engine === 'muse_api') {
      throw new ApiError('PRIVACY_BLOCK', '涉敏镜头必须本地生成');
    }
    const videoKey = idempotencyFor('video', [
      shot.id, engine, shot.visual_prompt, JSON.stringify(shot.engine_params), shot.duration_ms, shot.visual_style, nonce
    ]);
    const video = createTask({
      project_id: shot.project_id,
      shot_id: shot.id,
      segment_id: shot.segment_id,
      task_type: engine === 'muse_api' ? 'muse_api' : 'comfy_h3',
      engine,
      engine_params: {
        ...(shot.engine_params ?? {}),
        // 本地探测出的默认工作流优先（comfy_h3 链路），保证「用我本地的 ComfyUI」生效
        ...(engine === 'comfy_h3' && comfyDefaultTemplate() ? { template_key: comfyDefaultTemplate() } : {}),
        ...((overrides.engine_params as Record<string, unknown>) ?? {})
      },
      idempotency_key: videoKey,
      depends_on: ttsTaskId ? [ttsTaskId] : [],
      max_attempt: 2
    });
    tasks.push(video.task);
    if (video.replay) replays.push(video.task.id);

    const needsLipsync = hasText && Boolean(shot.lipsync_required) && !shot.native_audio;
    if (needsLipsync) {
      const lipsyncKey = idempotencyFor('lipsync', [shot.id, video.task.id, String((video.task.meta as Record<string, unknown>)?.asset_id ?? ''), nonce]);
      const lip = createTask({
        project_id: shot.project_id,
        shot_id: shot.id,
        segment_id: shot.segment_id,
        task_type: 'lipsync',
        engine: 'musetalk',
        engine_params: { protect_region: 'mouth_mask', camera: shot.camera },
        idempotency_key: lipsyncKey,
        depends_on: [video.task.id],
        max_attempt: 1
      });
      tasks.push(lip.task);
      if (lip.replay) replays.push(lip.task.id);
    }

    run('UPDATE round_shot SET status = ?, error_code = NULL, updated_at = ? WHERE id = ?', [
      shot.locked ? 'locked' : 'queued', nowIso(), shot.id
    ]);
  }

  emit({
    type: 'task.created',
    project_id: shot.project_id,
    payload: { shot_id: shot.id, tasks: tasks.map((t) => ({ id: t.id, type: t.task_type, status: t.status })) }
  });
  return { shot_id: shot.id, tasks, replays, blocked: false };
}

/** 单独重配某句台词（9.1 / 20.2）：不建视频任务，秒级可听 */
export function submitShotTts(shotId: number, opts: RenderOptions = {}): { task: RenderTask; preview_url: string | null; duration_ms: number | null } {
  const row = get('SELECT * FROM round_shot WHERE id = ?', [shotId]);
  if (!row) throw notFound('镜头不存在');
  const shot = mapShot(row);
  const overrides = opts.overrides ?? {};
  const emotion = String(overrides.emotion ?? shot.emotion ?? '');
  const instruction = String(overrides.emotion_instruction ?? shot.emotion_instruction ?? '');
  const speed = Number(overrides.speed ?? overrides.tts_speed ?? shot.tts_speed ?? 1);
  const text = String(overrides.text ?? shot.text_clean ?? shot.lines.join(' '));
  if (!text.trim()) throw new ApiError('PARAM_INVALID', '空镜没有台词，无法单独配音');
  const key = idempotencyFor('tts', [shot.id, text, emotion, instruction, speed, shot.voice_id, Date.now()]);
  const tts = createTask({
    project_id: shot.project_id,
    shot_id: shot.id,
    segment_id: shot.segment_id,
    task_type: 'tts',
    engine: 'indextts2',
    engine_params: { voice_id: shot.voice_id, emotion, emotion_instruction: instruction, speed, candidates: opts.candidates ?? 3 },
    idempotency_key: key,
    meta: { text, tts_only: true }
  });
  emit({ type: 'task.created', project_id: shot.project_id, payload: { shot_id: shot.id, tasks: [{ id: tts.task.id, type: 'tts' }] } });
  return { task: tts.task, preview_url: null, duration_ms: null };
}

export function retryTask(taskId: number): RenderTask {
  const task = getTask(taskId);
  if (['running', 'assigned'].includes(task.status)) {
    throw new ApiError('PARAM_INVALID', '任务正在执行中，无法重试');
  }
  run('UPDATE render_task SET status = ?, progress = 0, error_code = NULL, error_msg = NULL, attempt = 0, finished_at = NULL WHERE id = ?', ['pending', taskId]);
  const fresh = getTask(taskId);
  emit({ type: 'task.retry', project_id: fresh.project_id, payload: { task_id: fresh.id } });
  return fresh;
}

export function cancelTask(taskId: number): RenderTask {
  const task = getTask(taskId);
  if (task.status === 'success') return task;
  run('UPDATE render_task SET status = ?, finished_at = ? WHERE id = ?', ['canceled', nowIso(), taskId]);
  const fresh = getTask(taskId);
  emit({ type: 'task.canceled', project_id: fresh.project_id, payload: { task_id: fresh.id } });
  return fresh;
}

export function markProgress(taskId: number, progress: number, extra: Record<string, unknown> = {}): void {
  const row = get('SELECT * FROM render_task WHERE id = ?', [taskId]);
  if (!row) return;
  run('UPDATE render_task SET progress = ? WHERE id = ?', [Math.max(0, Math.min(100, Math.round(progress))), taskId]);
  emit({
    type: 'task.progress',
    project_id: Number(row.project_id),
    payload: { task_id: taskId, task_type: String(row.task_type), shot_id: row.shot_id, progress: Math.round(progress), ...extra }
  });
}

export function taskStats(projectId: number): Record<string, unknown> {
  const rows = all('SELECT task_type, status, COUNT(*) AS n FROM render_task WHERE project_id = ? GROUP BY task_type, status', [projectId]);
  const byType: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const type = String(r.task_type);
    byType[type] = byType[type] ?? {};
    byType[type][String(r.status)] = Number(r.n);
  }
  const totals = all('SELECT status, COUNT(*) AS n FROM render_task WHERE project_id = ? GROUP BY status', [projectId]);
  const total: Record<string, number> = {};
  for (const t of totals) total[String(t.status)] = Number(t.n);
  return { by_type: byType, total };
}

export function parseDepends(raw: unknown): number[] {
  return json<number[]>(raw, []);
}
