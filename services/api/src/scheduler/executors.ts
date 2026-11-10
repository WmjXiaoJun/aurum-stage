/** 任务执行器：把 DAG 上的一个节点跑成产物，并回写镜头/候选/时间轴。 */
import type { RenderTask } from '@aurum/core';
import { COMPOSE_PRESETS, type Camera } from '@aurum/core';
import { all, get, jstr, json, nowIso, run } from '../db/index.js';
import { logger } from '../logger.js';
import { ApiError } from '../http/errors.js';
import { config } from '../config.js';
import { synthesize } from '../adapters/tts.js';
import { generateWithComfy, generateWithMuse, type VideoSpec } from '../adapters/video.js';
import { composeMultiReference } from '../adapters/multi-ref.js';
import { runLipsync, triggersLipsync } from '../adapters/lipsync.js';
import { composeProject, recordExport } from '../adapters/compose.js';
import { findAsset, objectPath , assetKey } from '../adapters/storage.js';;
import { emit } from '../ws/hub.js';
import { recomputeAll } from '../domain/script-service.js';
import { markProgress } from './task-service.js';

export interface AgentNodeRow {
  id: number;
  node_key: string;
  base_url: string;
  engine_tags: string;
  vram_total_gb: number | null;
  vram_free_gb: number | null;
  queue_len: number;
  status: string;
  models_loaded: string;
  last_heartbeat: string | null;
}

/** 选点算法（10.4）：vram_free 权重 0.6 + queue_len 权重 0.4，且必须包含所需 tag */
export function selectNode(requiredTag: string): AgentNodeRow | null {
  const nodes = all<AgentNodeRow>('SELECT * FROM agent_node WHERE status = ?', ['online']);
  const candidates = nodes.filter((n) => json<string[]>(n.engine_tags, []).includes(requiredTag));
  if (candidates.length === 0) return null;
  const scored = candidates.map((n) => {
    const vram = Number(n.vram_free_gb ?? 0);
    const queue = Number(n.queue_len ?? 0);
    const score = (vram / Math.max(1, Number(n.vram_total_gb ?? 24))) * 0.6 + (1 / (queue + 1)) * 0.4;
    return { node: n, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].node;
}

function shotRow(shotId: number): Record<string, unknown> {
  const row = get('SELECT * FROM round_shot WHERE id = ?', [shotId]);
  if (!row) throw new ApiError('PARAM_INVALID', '镜头不存在：' + shotId);
  return row;
}

function projectOf(projectId: number): Record<string, unknown> {
  const row = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!row) throw new ApiError('PARAM_INVALID', '项目不存在');
  return row;
}

function replaceCandidates(shotId: number, kind: 'tts' | 'video' | 'lipsync', items: Array<{ idx: number; asset_id: number | null; duration_ms: number | null; meta?: Record<string, unknown> }>): void {
  run('DELETE FROM shot_candidate WHERE shot_id = ? AND kind = ?', [shotId, kind]);
  items.forEach((item, i) => {
    run('INSERT INTO shot_candidate (shot_id, kind, idx, asset_id, duration_ms, state, meta) VALUES (?,?,?,?,?,?,?)', [
      shotId, kind, item.idx, item.asset_id, item.duration_ms, i === 0 ? 'selected' : 'ready', jstr(item.meta ?? {})
    ]);
  });
}

export async function executeTts(task: RenderTask): Promise<Record<string, unknown>> {
  const shot = shotRow(Number(task.shot_id));
  const params = task.engine_params as Record<string, unknown>;
  const project = projectOf(Number(task.project_id));
  const language = String(project.language ?? 'zh');
  const voiceRow = shot.speaker_role_id
    ? get('SELECT provider, voice_id FROM voice_asset WHERE project_id = ? AND role_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1', [Number(task.project_id), String(shot.speaker_role_id)])
    : null;
  const boundEngine = String(voiceRow?.provider ?? '') === 'breeze' ? ('breeze' as const) : undefined;
  const voiceInstruction = String(voiceRow?.instruction ?? '');
  const localized = language !== 'zh' && shot.text_local ? String(shot.text_local) : null;
  const text = String(task.meta?.text ?? localized ?? shot.text_clean ?? json<string[]>(shot.lines, []).join(' '));
  const result = await synthesize({
    language,
    project_id: Number(task.project_id),
    shot_id: Number(task.shot_id),
    task_id: task.id,
    text,
    voice_id: String(voiceRow?.voice_id ?? params.voice_id ?? shot.voice_id ?? 'v_narrator'),
    engine: boundEngine,
    voice_instruction: voiceInstruction,
    emotion: String(params.emotion ?? shot.emotion ?? ''),
    emotion_instruction: String(params.emotion_instruction ?? shot.emotion_instruction ?? ''),
    speed: Number(params.speed ?? 1),
    target_duration_ms: shot.tts_duration_ms == null ? null : Number(shot.tts_duration_ms),
    candidates: Number(params.candidates ?? config.render.defaultCandidates)
  });

  const chosen = result.candidates[0];
  run(
    'UPDATE round_shot SET tts_asset_id = ?, tts_duration_ms = ?, duration_ms = ?, tts_engine = ?, voice_id = ?, updated_at = ? WHERE id = ?',
    [chosen.asset_id, chosen.duration_ms, chosen.duration_ms + 300, result.engine, String(params.voice_id ?? shot.voice_id ?? ''), nowIso(), Number(task.shot_id)]
  );
  replaceCandidates(Number(task.shot_id), 'tts', result.candidates.map((c) => ({
    idx: c.idx, asset_id: c.asset_id, duration_ms: c.duration_ms, meta: { engine: c.engine, url: c.url, word_ts: c.word_ts }
  })));

  emit({
    type: 'task.preview',
    project_id: Number(task.project_id),
    payload: {
      task_id: task.id,
      task_type: 'tts',
      shot_id: Number(task.shot_id),
      audio_url: chosen.url,
      duration_ms: chosen.duration_ms,
      candidates: result.candidates.map((c) => ({ idx: c.idx, url: c.url, duration_ms: c.duration_ms }))
    }
  });

  return { asset_id: chosen.asset_id, duration_ms: chosen.duration_ms, engine: result.engine, candidates: result.candidates.length };
}

/** 角色锚定参考图：优先概念立绘，其次三视图 */
function characterRefPath(projectId: number, roleId: string | null): string | null {
  if (!roleId) return null;
  const ch = get('SELECT id FROM character_asset WHERE project_id = ? AND role_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1', [projectId, roleId]);
  if (!ch) return null;
  const ref = get(
    "SELECT a.bucket, a.object_key FROM character_ref_image r JOIN asset a ON a.id = r.asset_id WHERE r.character_id = ? ORDER BY CASE WHEN a.meta LIKE '%\"art_kind\":\"portrait\"%' THEN 0 WHEN a.meta LIKE '%\"art_kind\":\"three_view\"%' THEN 1 ELSE 2 END, r.id LIMIT 1",
    [Number(ch.id)]
  );
  if (!ref) return null;
  try { return objectPath(String(ref.bucket), String(ref.object_key)); } catch { return null; }
}

export async function executeVideo(task: RenderTask): Promise<Record<string, unknown>> {
  const shot = shotRow(Number(task.shot_id));
  const project = projectOf(Number(task.project_id));
  const preset = COMPOSE_PRESETS[String(project.aspect_ratio ?? '16:9')] ?? COMPOSE_PRESETS['16:9'];
  const ttsAsset = shot.tts_asset_id ? findAsset(Number(shot.tts_asset_id)) : null;
  const audioPath = ttsAsset ? objectPath(ttsAsset.bucket, ttsAsset.object_key) : null;
  const duration = Number(shot.duration_ms ?? 0) || 3000;
  const camera = String(shot.camera) as Camera;

  // 多人同框：中景/全景且项目有 ≥2 个角色时，把两个角色参考图拼成首帧
  let multiPromptPrefix = '';
  let referencePath = characterRefPath(Number(task.project_id), shot.speaker_role_id == null ? null : String(shot.speaker_role_id));
  try {
    const camera = String(shot.camera ?? '');
    const characters = all('SELECT id FROM character_asset WHERE project_id = ? AND is_active = 1 ORDER BY id LIMIT 3', [Number(task.project_id)]);
    if (characters.length >= 2 && ['wide', 'medium_shot'].includes(camera)) {
      const paths: string[] = [];
      for (const c of characters) {
        const ref = get("SELECT a.bucket, a.object_key FROM character_ref_image r JOIN asset a ON a.id = r.asset_id WHERE r.character_id = ? ORDER BY r.id LIMIT 1", [Number(c.id)]);
        if (ref) paths.push(objectPath(String(ref.bucket), String(ref.object_key)));
      }
      const composite = objectPath('assets', assetKey('projects', Number(task.project_id), 'multi_ref', Number(shot.id) + '.jpg'));
      if (await composeMultiReference(paths, composite)) {
        referencePath = composite;
        multiPromptPrefix = (paths.length >= 3 ? 'three people in frame, ' : 'two people in frame, ') + 'conversation, cinematic two-shot, ';
      }
    }
  } catch { /* 多人合成失败就用单人参考 */ }

  const spec: VideoSpec = {
    project_id: Number(task.project_id),
    shot_id: Number(task.shot_id),
    task_id: task.id,
    shot_code: String(shot.shot_code),
    prompt: multiPromptPrefix + String(shot.visual_prompt ?? ''),
    negative: String(shot.negative_prompt ?? ''),
    engine: task.task_type === 'muse_api' ? 'muse_api' : 'comfy_h3',
    engine_params: task.engine_params,
    duration_ms: duration,
    aspect_ratio: String(project.aspect_ratio ?? '16:9'),
    visual_style: String(shot.visual_style ?? 'photoreal') as never,
    camera,
    text_clean: String(shot.text_clean ?? json<string[]>(shot.lines, []).join(' ')),
    segment_title: String(get('SELECT title FROM segment WHERE id = ?', [Number(shot.segment_id)])?.title ?? ''),
    audio_path: audioPath,
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    privacy: Number(shot.privacy) === 1,
    reference_image_path: referencePath
  };

  const result = task.task_type === 'muse_api'
    ? await generateWithMuse(spec, { onProgress: (p) => markProgress(task.id, p) })
    : await generateWithComfy(spec);
  return applyVideoResult(task, {
    asset_id: result.asset_id,
    duration_ms: result.duration_ms,
    poster_asset_id: result.poster_asset_id,
    degraded: result.degraded
  });
}

export function applyVideoResult(task: RenderTask, res: { asset_id: number; duration_ms?: number; poster_asset_id?: number | null; degraded?: boolean }): Record<string, unknown> {
  const shotId = Number(task.shot_id);
  const shot = shotRow(shotId);
  const asset = findAsset(res.asset_id);
  const locked = Number(shot.locked) === 1;
  // 新视频到位：旧的口型对齐产物必须失效，否则合成会拿到上一版镜头
  run('UPDATE round_shot SET preview_asset_id = ?, lipsync_asset_id = NULL, status = ?, error_code = NULL, updated_at = ? WHERE id = ?', [
    res.asset_id, locked ? 'locked' : 'generated', nowIso(), shotId
  ]);
  replaceCandidates(shotId, 'video', [{ idx: 1, asset_id: res.asset_id, duration_ms: res.duration_ms ?? null, meta: { url: '/api/v1/assets/' + res.asset_id + '/raw' } }]);
  emit({
    type: 'task.preview',
    project_id: Number(task.project_id),
    payload: {
      task_id: task.id,
      task_type: task.task_type,
      shot_id: shotId,
      video_url: '/api/v1/assets/' + res.asset_id + '/raw',
      poster_url: res.poster_asset_id ? '/api/v1/assets/' + res.poster_asset_id + '/raw' : asset?.url ?? null,
      duration_ms: res.duration_ms ?? null
    }
  });
  recomputeAll(Number(task.project_id));
  return { asset_id: res.asset_id, duration_ms: res.duration_ms ?? null, degraded: !!res.degraded };
}

export async function executeLipsync(task: RenderTask): Promise<Record<string, unknown>> {
  const shot = shotRow(Number(task.shot_id));
  const videoAssetId = shot.preview_asset_id == null ? null : Number(shot.preview_asset_id);
  const audioAssetId = shot.tts_asset_id == null ? null : Number(shot.tts_asset_id);
  const result = await runLipsync({
    project_id: Number(task.project_id),
    shot_id: Number(task.shot_id),
    task_id: task.id,
    shot_code: String(shot.shot_code),
    camera: String(shot.camera),
    has_face: String(shot.camera) !== 'empty_shot' && String(shot.camera) !== 'wide' && !!shot.speaker_role_id,
    video_asset_id: videoAssetId,
    audio_asset_id: audioAssetId,
    duration_ms: Number(shot.duration_ms ?? 0),
    engine: 'musetalk'
  });
  if (result.asset_id) {
    run('UPDATE round_shot SET lipsync_asset_id = ?, updated_at = ? WHERE id = ?', [result.asset_id, nowIso(), Number(task.shot_id)]);
    replaceCandidates(Number(task.shot_id), 'lipsync', [{ idx: 1, asset_id: result.asset_id, duration_ms: Number(shot.duration_ms ?? 0), meta: { quality: result.quality } }]);
    emit({ type: 'task.preview', project_id: Number(task.project_id), payload: { task_id: task.id, task_type: 'lipsync', shot_id: Number(task.shot_id), video_url: '/api/v1/assets/' + result.asset_id + '/raw' } });
    recomputeAll(Number(task.project_id));
  }
  return { asset_id: result.asset_id, skipped: result.skipped, reason: result.reason, quality: result.quality };
}

export async function executeCompose(task: RenderTask): Promise<Record<string, unknown>> {
  emit({ type: 'compose.progress', project_id: Number(task.project_id), payload: { task_id: task.id, progress: 10 } });
  const result = await composeProject({
    project_id: Number(task.project_id),
    segment_id: task.segment_id == null ? null : Number(task.segment_id),
    task_id: task.id,
    bgm: task.meta?.bgm !== false
  });
  emit({ type: 'compose.progress', project_id: Number(task.project_id), payload: { task_id: task.id, progress: 100 } });
  recordExport({
    project_id: Number(task.project_id),
    segment_id: task.segment_id == null ? null : Number(task.segment_id),
    task_id: task.id,
    status: result.mode,
    duration_ms: result.total_ms,
    video_asset_id: result.video_asset_id,
    subtitle_asset_id: result.subtitle_asset_id,
    ass_asset_id: result.ass_asset_id,
    manifest: result.manifest as Record<string, unknown>,
    error_code: null,
    error_msg: result.warnings.join('；') || null
  });
  if (result.video_asset_id) {
    emit({
      type: 'compose.success',
      project_id: Number(task.project_id),
      payload: { task_id: task.id, video_url: '/api/v1/assets/' + result.video_asset_id + '/raw', duration_sec: result.duration_sec }
    });
  }
  return {
    asset_id: result.video_asset_id,
    mode: result.mode,
    duration_ms: result.total_ms,
    warnings: result.warnings
  };
}

export async function executeTask(task: RenderTask): Promise<Record<string, unknown>> {
  logger.info('执行任务', { service: 'scheduler', task_id: task.id, shot_id: task.shot_id, task_type: task.task_type });
  switch (task.task_type) {
    case 'tts':
      return executeTts(task);
    case 'muse_api':
    case 'comfy_h3':
      return executeVideo(task);
    case 'lipsync':
      return executeLipsync(task);
    case 'compose':
      return executeCompose(task);
    default:
      throw new ApiError('PARAM_INVALID', '未知任务类型：' + task.task_type);
  }
}

export function needsAgent(task: RenderTask): boolean {
  if (task.task_type !== 'comfy_h3' && task.task_type !== 'lipsync') return false;
  if (config.comfy.simulate) return false;
  return !!selectNode(task.task_type === 'comfy_h3' ? 'h3' : 'lipsync');
}

export function depsSatisfied(task: RenderTask): { ok: boolean; failed: number[] } {
  const deps = task.depends_on ?? [];
  if (deps.length === 0) return { ok: true, failed: [] };
  const rows = all<{ id: number; status: string }>(
    'SELECT id, status FROM render_task WHERE id IN (' + deps.map(() => '?').join(',') + ')',
    deps
  );
  const failed = rows.filter((r) => ['failed', 'canceled', 'timeout'].includes(String(r.status))).map((r) => Number(r.id));
  if (failed.length > 0) return { ok: false, failed };
  return { ok: rows.length === deps.length && rows.every((r) => String(r.status) === 'success'), failed: [] };
}
