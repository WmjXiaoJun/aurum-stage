/**
 * APIMart 云端视频适配器（Muse 通道的真实实现）
 *   提交：POST {base}/videos/generations  → { code:200, data:[{ task_id, status }] }
 *   轮询：GET  {base}/tasks/{task_id}     → { status: SUCCESS|PROCESSING|FAILED, ... }
 * 文档：https://docs.apimart.ai/en/api-reference/videos/minimax-h3/generation
 */
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ApiError } from '../http/errors.js';
import { museConfig } from '../domain/settings-service.js';

export interface MuseSubmitInput {
  model: string;
  prompt: string;
  duration: number;
  resolution: string;
  aspect_ratio: string;
  first_frame_image?: string;
  negative_prompt?: string;
  seed?: number;
  with_audio?: boolean;
  idempotency_key?: string;
}

export interface MuseTaskState {
  status: 'pending' | 'success' | 'failed';
  raw_status: string;
  progress: number;
  video_url: string | null;
  error: string | null;
  raw: unknown;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };
}

function mapHttpError(status: number, text: string): ApiError {
  if (status === 401 || status === 403) return new ApiError('PARAM_INVALID', 'APIMart 鉴权失败，请检查 MUSE_API_KEY', { status, body: text.slice(0, 300) });
  if (status === 402) return new ApiError('QUOTA_EXHAUSTED', 'APIMart 账户余额不足', { status });
  if (status === 429) return new ApiError('RATE_LIMITED', 'APIMart 限流', { status });
  return new ApiError('CLOUD_TIMEOUT', 'APIMart 请求失败：HTTP ' + status, { status, body: text.slice(0, 300) });
}

function isMuseVideo(model: string): boolean {
  return /muse-video/i.test(model);
}

function clampDuration(model: string, ms: number): number {
  // muse-video-ext：固定约 10 秒（文档：duration 仅接受 10）
  if (isMuseVideo(model)) return 10;
  // MiniMax-H3 系列支持 4–15 秒整数
  return Math.max(4, Math.min(15, Math.ceil(ms / 1000)));
}

function resolutionFor(model: string, fallback: string): string {
  // muse-video-ext 只支持 720p（传 1080p/4k 会 400）
  if (isMuseVideo(model)) return '720p';
  if (/h3-max/i.test(model)) return /^(480P|768P|1080P)$/i.test(fallback) ? fallback.toUpperCase() : '720P';
  if (/h3/i.test(model)) return /^(768P|2K)$/i.test(fallback) ? fallback.toUpperCase() : '768P';
  return /^(480p|720p|1080p)$/i.test(fallback) ? fallback.toLowerCase() : '720p';
}

const MUSE_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];

function normalizeRatio(model: string, ratio: string): string {
  if (!isMuseVideo(model)) return ratio;
  if (MUSE_RATIOS.includes(ratio)) return ratio;
  if (ratio === '4:5') return '3:4';
  return '16:9';
}

export async function museSubmit(input: MuseSubmitInput): Promise<{ task_id: string; raw: unknown }> {
  const cfg = museConfig();
  if (!cfg.apiKey) throw new ApiError('PARAM_INVALID', '未配置 MUSE_API_KEY（APIMart）');
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    duration: clampDuration(input.model, input.duration * 1000),
    resolution: resolutionFor(input.model, input.resolution),
    aspect_ratio: normalizeRatio(input.model, input.aspect_ratio)
  };
  if (isMuseVideo(input.model)) {
    // muse-video-ext 契约：不接受 seed / negative_prompt / width / height / quality；声音默认开启
    if (input.first_frame_image) body.image_urls = [input.first_frame_image];
  } else {
    if (input.first_frame_image) body.first_frame_image = input.first_frame_image;
    if (input.negative_prompt) body.negative_prompt = input.negative_prompt;
    if (typeof input.seed === 'number') body.seed = input.seed;
    if (input.with_audio != null) body.with_audio = input.with_audio;
  }

  const url = cfg.baseUrl + cfg.submitPath;
  const headers = authHeaders(cfg.apiKey);
  if (input.idempotency_key) headers['Idempotency-Key'] = input.idempotency_key.slice(0, 190);
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw mapHttpError(res.status, text);
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  const data = (parsed as { data?: Array<{ task_id?: string; id?: string; status?: string }> })?.data;
  const taskId = data?.[0]?.task_id ?? data?.[0]?.id ?? (parsed as { task_id?: string })?.task_id;
  if (!taskId) throw new ApiError('CLOUD_TIMEOUT', 'APIMart 未返回 task_id', { body: text.slice(0, 400) });
  logger.info('APIMart 任务已提交', { service: 'muse', task_id: taskId, model: input.model });
  return { task_id: String(taskId), raw: parsed };
}

function pickStatus(node: Record<string, unknown>): string {
  const candidates = [node.status, node.state, node.task_status, (node.data as Record<string, unknown> | undefined)?.status];
  for (const c of candidates) if (typeof c === 'string' && c) return c.toUpperCase();
  return 'PENDING';
}

function pickProgress(node: Record<string, unknown>): number {
  const raw = node.progress ?? (node.data as Record<string, unknown> | undefined)?.progress;
  if (typeof raw === 'number') return Math.max(0, Math.min(100, raw));
  if (typeof raw === 'string') {
    const n = Number(raw.replace('%', ''));
    if (!Number.isNaN(n)) return Math.max(0, Math.min(100, n));
  }
  return 0;
}

function findUrl(node: unknown, depth = 0): string | null {
  if (depth > 6 || node == null) return null;
  if (typeof node === 'string') return /^https?:\/\//.test(node) ? node : null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findUrl(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const preferred = ['video_url', 'videoUrl', 'url', 'output_url', 'file_url', 'result_url', 'download_url', 'mp4'];
    for (const key of preferred) {
      const v = obj[key];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (/error|message|prompt/i.test(key)) continue;
      if (/video|output|result|url|data|file|assets/i.test(key)) {
        const hit = findUrl(value, depth + 1);
        if (hit) return hit;
      }
    }
    for (const value of Object.values(obj)) {
      const hit = findUrl(value, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

export function parseTaskState(payload: unknown): MuseTaskState {
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = (root.data ?? root.result ?? root) as Record<string, unknown>;
  const status = pickStatus(data);
  const ok = ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'FINISHED', 'DONE'].includes(status);
  const bad = ['FAILED', 'ERROR', 'CANCELED', 'CANCELLED', 'REJECTED'].includes(status);
  const errorRaw = data.error ?? data.fail_reason ?? data.message ?? (data.error_detail as unknown);
  return {
    status: ok ? 'success' : bad ? 'failed' : 'pending',
    raw_status: status,
    progress: ok ? 100 : pickProgress(data),
    video_url: ok ? findUrl(payload) : null,
    error: bad ? String(typeof errorRaw === 'string' ? errorRaw : JSON.stringify(errorRaw ?? '未知错误')).slice(0, 300) : null,
    raw: payload
  };
}

export async function musePoll(taskId: string, onProgress?: (percent: number) => void): Promise<MuseTaskState> {
  const cfg = museConfig();
  const deadline = Date.now() + cfg.timeoutMs;
  let last: MuseTaskState = { status: 'pending', raw_status: 'PENDING', progress: 0, video_url: null, error: null, raw: null };
  while (Date.now() < deadline) {
    const url = cfg.baseUrl + cfg.taskPath.replace('{id}', encodeURIComponent(taskId)).replace('{task_id}', encodeURIComponent(taskId));
    try {
      const res = await fetch(url, { headers: authHeaders(cfg.apiKey) });
      const text = await res.text();
      if (!res.ok) throw mapHttpError(res.status, text);
      const payload = JSON.parse(text);
      last = parseTaskState(payload);
      if (last.status === 'pending') onProgress?.(Math.max(5, Math.min(95, last.progress || 20)));
      if (last.status !== 'pending') return last;
    } catch (err) {
      if (err instanceof ApiError && err.code !== 'CLOUD_TIMEOUT') throw err;
      logger.warn('APIMart 轮询失败，继续重试：' + String((err as Error).message).slice(0, 160), { service: 'muse', task_id: taskId });
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
  throw new ApiError('CLOUD_TIMEOUT', 'APIMart 任务超时（' + Math.round(cfg.timeoutMs / 1000) + 's）', { task_id: taskId });
}

/** 探测 APIMart 连通性（不产生生成计费） */
export async function museHealth(): Promise<{ ok: boolean; detail: string; base_url: string; model: string; key_set: boolean }> {
  const cfg = museConfig();
  if (!cfg.apiKey) return { ok: false, detail: '未配置 API Key', base_url: cfg.baseUrl, model: cfg.model, key_set: false };
  try {
    const res = await fetch(cfg.baseUrl + '/models', { headers: authHeaders(cfg.apiKey) });
    const text = await res.text();
    return {
      ok: res.ok,
      detail: res.ok ? '鉴权通过' : 'HTTP ' + res.status + ' ' + text.slice(0, 120),
      base_url: cfg.baseUrl,
      model: cfg.model,
      key_set: true
    };
  } catch (err) {
    return { ok: false, detail: String((err as Error).message).slice(0, 160), base_url: cfg.baseUrl, model: cfg.model, key_set: true };
  }
}

export { config };
