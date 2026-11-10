/** 视频生成适配器：云端 Muse / 本地 ComfyUI·H3 双链路。
 *  真实 GPU / 云端不可用时，用 FFmpeg 生成“可播放代理片”（配色卡 + 真实配音），
 *  完整跑通 audio-first 时长驱动、依赖链与回存，等真实引擎接入后仅替换 exec 层。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RenderEngine, VisualStyleId } from '@aurum/core';
import { ENGINE_META, STYLE_PRESETS } from '@aurum/core';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ApiError } from '../http/errors.js';
import { assetKey, createAsset, objectPath } from './storage.js';
import { buildPosterSvg } from './poster.js';
import { renderCardClip, ffmpegPath } from '../media/ffmpeg.js';
import { acquireAccount, allowQps, coolDown } from './accounts.js';
import { pickSeed, sleep } from '../util.js';
import { museSubmit, musePoll } from './muse.js';
import { comfyDirectRender } from './comfy-direct.js';
import { comfySimulate, museConfig } from '../domain/settings-service.js';
import { probeDuration, runFfmpeg } from '../media/ffmpeg.js';
import { CAMERA_LABEL, type Camera } from '@aurum/core';

export interface VideoSpec {
  project_id: number;
  shot_id: number;
  task_id: number;
  shot_code: string;
  prompt: string;
  negative: string;
  engine: RenderEngine;
  engine_params: Record<string, unknown>;
  duration_ms: number;
  aspect_ratio: string;
  visual_style: VisualStyleId;
  camera: string;
  /** 该镜头台词（云端 T2V 模型会把台词当字幕画进画面，必须从 prompt 里剔除） */
  text_clean?: string;
  segment_title?: string;
  audio_path?: string | null;
  width: number;
  height: number;
  fps: number;
  candidate?: number;
  privacy?: boolean;
  /** 角色锚定参考图（绝对路径）：云端作为首帧参考，本地作为首帧 */
  reference_image_path?: string | null;
}

export interface VideoResult {
  asset_id: number;
  poster_asset_id: number | null;
  duration_ms: number;
  simulated: boolean;
  degraded: boolean;
  path: string | null;
}

function randomLatency(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

function cardText(spec: VideoSpec): { title: string; subtitle: string } {
  const engineLabel = ENGINE_META[spec.engine].label;
  const cam = CAMERA_LABEL[(spec.camera as Camera)] ?? spec.camera;
  return {
    title: spec.shot_code + '  ·  ' + (spec.segment_title ?? ''),
    subtitle: cam + ' · ' + STYLE_PRESETS[spec.visual_style].label + ' · ' + engineLabel + ' · ' + (spec.duration_ms / 1000).toFixed(1) + 's' + String.fromCharCode(10) + spec.prompt.slice(0, 90)
  };
}

function writePosterAsset(spec: VideoSpec): number | null {
  try {
    const svg = buildPosterSvg({
      width: spec.width,
      height: spec.height,
      shot_code: spec.shot_code,
      camera: spec.camera,
      engine: spec.engine,
      style: spec.visual_style,
      prompt: spec.prompt,
      duration_ms: spec.duration_ms,
      segment_title: spec.segment_title
    });
    const key = assetKey('projects', spec.project_id, 'posters', spec.shot_id, spec.task_id + '.svg');
    const abs = objectPath('assets', key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, svg, 'utf8');
    const asset = createAsset({
      project_id: spec.project_id,
      asset_type: 'image',
      source: spec.engine === 'muse_api' ? 'muse' : 'comfy_h3',
      key,
      width: spec.width,
      height: spec.height,
      meta: { kind: 'poster', shot_id: spec.shot_id, task_id: spec.task_id }
    });
    return asset.id;
  } catch (e) {
    logger.warn('海报生成失败：' + String(e), { service: 'video' });
    return null;
  }
}

/** 从成片抽 1 帧存为海报资产，前端卡片/缩略图直接显示真实画面 */
async function extractFramePoster(videoPath: string, spec: VideoSpec): Promise<number | null> {
  try {
    const key = assetKey('projects', spec.project_id, 'posters', spec.shot_id, spec.task_id + '_frame.jpg');
    const abs = objectPath('assets', key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const res = await runFfmpeg(['-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-q:v', '3', abs]);
    if (!res.ok || !fs.existsSync(abs)) return null;
    const asset = createAsset({
      project_id: spec.project_id,
      asset_type: 'image',
      source: 'muse',
      key,
      width: spec.width,
      height: spec.height,
      meta: { kind: 'frame_poster', shot_id: spec.shot_id, task_id: spec.task_id }
    });
    return asset.id;
  } catch {
    return null;
  }
}

async function writeProxyClip(spec: VideoSpec): Promise<{ key: string; absPath: string } | null> {
  if (!ffmpegPath()) return null;
  const key = assetKey('projects', spec.project_id, 'render', spec.shot_id, spec.task_id + '_c' + (spec.candidate ?? 1) + '.mp4');
  const absPath = objectPath('assets', key);
  const accent = spec.engine === 'muse_api' ? '#E8D6A8' : '#7FD3CE';
  const text = cardText(spec);
  const res = await renderCardClip({
    outPath: absPath,
    width: spec.width,
    height: spec.height,
    durationMs: spec.duration_ms,
    audioPath: spec.audio_path ?? null,
    title: text.title,
    subtitle: text.subtitle,
    accent,
    fps: spec.fps
  });
  if (!res.ok) {
    logger.warn('代理片渲染失败：' + (res.error ?? ''), { service: 'video' });
    return null;
  }
  return { key, absPath };
}

export interface MuseHooks {
  onProgress?: (percent: number) => void;
}

/** 云端 Muse 通道：配置了 APIMart Key 走真实调用，否则生成可播放代理片（明确标注 simulated） */
export async function generateWithMuse(spec: VideoSpec, hooks: MuseHooks = {}): Promise<VideoResult> {
  if (spec.privacy) {
    throw new ApiError('PRIVACY_BLOCK', '涉敏镜头禁止走云端引擎');
  }
  if (!allowQps(config.muse.qps)) {
    throw new ApiError('RATE_LIMITED', '云端 QPS 限流，已进入排队', { qps: config.muse.qps });
  }
  const account = acquireAccount('muse');
  if (!account) {
    throw new ApiError('QUOTA_EXHAUSTED', '云端账号额度不足，已切备用通道', { provider: 'muse' });
  }
  const cfg = museConfig();
  if (!cfg.apiKey) {
    return simulateMuse(spec, account, 'NO_API_KEY');
  }
  return realMuse(spec, account, hooks);
}

export interface VideoAccount {
  id: number;
  account_name: string;
}

/** 云端提示词清洗：把台词从画面描述里剔除，避免模型把对白直接画成字幕 */
export function stripDialogue(prompt: string, dialogue: string | undefined): string {
  if (!dialogue) return prompt;
  let out = prompt;
  const fragments = [dialogue, ...dialogue.split(/[，。！？；、,.;!?]/)];
  for (const frag of fragments) {
    const trimmed = frag.trim();
    if (trimmed.length >= 4) out = out.split(trimmed).join('');
  }
  // visual_prompt 里台词被截断到 24 字，按「最长前缀」再削一刀，避免残留半句
  const clean = dialogue.replace(/\s+/g, '');
  for (let len = Math.min(clean.length, 40); len >= 6; len -= 1) {
    const prefix = clean.slice(0, len);
    const compactOut = out.replace(/\s+/g, '');
    if (compactOut.includes(prefix)) {
      // 找到原文中该前缀的起止位置并删除（保留中间空格处理）
      const idx = out.indexOf(clean.slice(0, Math.min(4, len)));
      if (idx >= 0) out = out.slice(0, idx) + out.slice(idx + len);
      break;
    }
  }
  return out
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,、\s]+|[，,、\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 真实 APIMart 调用：提交 → 轮询 → 下载回存 → 入库 */
async function realMuse(spec: VideoSpec, account: VideoAccount, hooks: MuseHooks): Promise<VideoResult> {
  const cfg = museConfig();
  const model = String(spec.engine_params?.model ?? cfg.model);
  const prompt = stripDialogue(spec.prompt, spec.text_clean);
  const seed = pickSeed(spec.shot_code + ':' + spec.prompt);
  const started = Date.now();
  // 首帧参考：先把角色图垫成目标画幅（模糊底 + 居中），避免云端回传黑边/上下补条
  let reference: string | undefined;
  if (spec.reference_image_path && fs.existsSync(spec.reference_image_path)) {
    const tmp = path.join(process.cwd(), '.ref-tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const out = path.join(tmp, 'ref_' + spec.task_id + '.jpg');
    const filter = '[0:v]split[bg][fg];[bg]scale=' + spec.width + ':' + spec.height + ':force_original_aspect_ratio=increase,crop=' + spec.width + ':' + spec.height + ',gblur=sigma=28[b];[fg]scale=' + spec.width + ':' + spec.height + ':force_original_aspect_ratio=decrease[f];[b][f]overlay=(W-w)/2:(H-h)/2';
    const prepped = await runFfmpeg(['-y', '-i', spec.reference_image_path, '-filter_complex', filter, '-q:v', '3', out]);
    const refPath = prepped.ok && fs.existsSync(out) ? out : spec.reference_image_path;
    reference = 'data:image/jpeg;base64,' + fs.readFileSync(refPath).toString('base64');
    try { if (refPath !== spec.reference_image_path) fs.unlinkSync(refPath); } catch { /* ignore */ }
  }
  const submitted = await museSubmit({
    model,
    prompt,
    first_frame_image: reference,
    duration: spec.duration_ms / 1000,
    resolution: String(spec.engine_params?.resolution ?? cfg.resolution),
    aspect_ratio: spec.aspect_ratio,
    negative_prompt: spec.negative,
    seed,
    with_audio: spec.engine_params?.with_audio === true,
    // APIMart 建议每次独立生成一个幂等键：这里用「任务 + 镜头」保证重试不会重复计费
    idempotency_key: 'aurum-' + spec.task_id + '-' + spec.shot_code
  });
  hooks.onProgress?.(12);
  logger.info('APIMart 云端任务进入轮询', { service: 'muse', task_id: spec.task_id, apimart_task_id: submitted.task_id, model });
  const state = await musePoll(submitted.task_id, (p) => hooks.onProgress?.(Math.max(15, p)));
  if (state.status !== 'success' || !state.video_url) {
    coolDown(account.id, 20_000);
    throw new ApiError('CLOUD_TIMEOUT', 'APIMart 任务失败：' + (state.error ?? state.raw_status), { task_id: submitted.task_id });
  }
  hooks.onProgress?.(96);

  const key = assetKey('projects', spec.project_id, 'muse', spec.shot_id, spec.task_id + '.mp4');
  const absPath = objectPath('assets', key);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const remote = await fetch(state.video_url);
  if (!remote.ok) throw new ApiError('CLOUD_TIMEOUT', 'APIMart 产物下载失败：HTTP ' + remote.status);
  const buffer = Buffer.from(await remote.arrayBuffer());
  fs.writeFileSync(absPath, buffer);

  const realDuration = await probeDuration(absPath).catch(() => 0);
  // 用云端成片抽帧做海报（真实画面），抽帧失败再回退 SVG 占位
  const framePosterId = await extractFramePoster(absPath, spec);
  const posterId = framePosterId ?? writePosterAsset(spec);
  const asset = createAsset({
    project_id: spec.project_id,
    asset_type: 'video',
    source: 'muse',
    key,
    width: spec.width,
    height: spec.height,
    duration_sec: Math.round(((realDuration || spec.duration_ms) / 1000) * 100) / 100,
    meta: {
      engine: 'muse_api',
      provider: 'apimart',
      model,
      task_id: submitted.task_id,
      remote_url: state.video_url,
      simulated: false,
      proxy: false,
      poster_asset_id: posterId,
      reference: reference ? 'character-first-frame' : null,
      prompt,
      prompt_raw: spec.prompt,
      negative: spec.negative,
      seed,
      account: account.account_name,
      latency_ms: Date.now() - started,
      bytes: buffer.length
    }
  });
  logger.info('APIMart 云端成片回存完成', {
    service: 'muse', shot_id: spec.shot_id, task_id: spec.task_id,
    latency_ms: Date.now() - started, bytes: buffer.length, model
  });
  return { asset_id: asset.id, poster_asset_id: posterId, duration_ms: realDuration || spec.duration_ms, simulated: false, degraded: false, path: absPath };
}

/** 无 Key / 演练模式：生成导播代理片，meta 里写明原因，避免误判为真实云端产物 */
async function simulateMuse(spec: VideoSpec, account: VideoAccount, reason: string): Promise<VideoResult> {
  const latency = randomLatency(config.muse.simulateLatencyMin, config.muse.simulateLatencyMax);
  await sleep(latency);
  if (Math.random() < config.muse.simulateFailureRate) {
    coolDown(account.id, 30_000);
    throw new ApiError('CLOUD_TIMEOUT', '云端任务超时丢失（模拟），将自动重试', { account: account.account_name });
  }
  const seed = pickSeed(spec.shot_code + ':' + spec.prompt);
  const clip = await writeProxyClip({ ...spec, engine_params: { ...spec.engine_params, seed } });
  const posterId = writePosterAsset(spec);
  const asset = createAsset({
    project_id: spec.project_id,
    asset_type: 'video',
    source: 'muse',
    key: clip ? clip.key : assetKey('projects', spec.project_id, 'render', spec.shot_id, spec.task_id + '.json'),
    width: spec.width,
    height: spec.height,
    duration_sec: Math.round((spec.duration_ms / 1000) * 100) / 100,
    meta: {
      engine: 'muse_api',
      provider: 'apimart',
      simulated: true,
      proxy: !!clip,
      simulate_reason: reason,
      poster_asset_id: posterId,
      prompt: spec.prompt,
      negative: spec.negative,
      seed,
      account: account.account_name,
      latency_ms: latency
    }
  });
  if (!clip) {
    fs.writeFileSync(objectPath('assets', asset.object_key), JSON.stringify({ shot_code: spec.shot_code, prompt: spec.prompt, note: '占位清单：安装 FFmpeg 后可产出可播放代理片' }, null, 2), 'utf8');
  }
  logger.info('云端镜头渲染完成（模拟）', { service: 'muse', shot_id: spec.shot_id, task_id: spec.task_id, latency_ms: latency, proxy: !!clip, reason });
  return { asset_id: asset.id, poster_asset_id: posterId, duration_ms: spec.duration_ms, simulated: true, degraded: false, path: clip?.absPath ?? null };
}

export interface ComfyHooks {
  onProgress?: (percent: number) => void;
}

export async function generateWithComfy(spec: VideoSpec, hooks: ComfyHooks = {}): Promise<VideoResult> {
  // 先走真实本地 ComfyUI（COMFY_SIMULATE=false）；连不上再降级代理片，并标注原因
  if (!comfySimulate()) {
    hooks.onProgress?.(8);
    try {
      const result = await comfyDirectRender({
        project_id: spec.project_id,
        shot_id: spec.shot_id,
        task_id: spec.task_id,
        shot_code: spec.shot_code,
        prompt: spec.prompt,
        negative: spec.negative,
        visual_style: spec.visual_style,
        engine_params: spec.engine_params,
        duration_ms: spec.duration_ms,
        width: spec.width,
        height: spec.height,
        fps: spec.fps,
        audio_path: spec.audio_path
      });
      hooks.onProgress?.(96);
      return {
        asset_id: result.asset_id,
        poster_asset_id: result.poster_asset_id,
        duration_ms: result.duration_ms,
        simulated: false,
        degraded: false,
        path: null
      };
    } catch (err) {
      const apiErr = err as { code?: string; message?: string };
      logger.warn('本地 ComfyUI 直连失败，降级为代理片：' + (apiErr.code ?? '') + ' ' + (apiErr.message ?? String(err)), {
        service: 'comfy', shot_id: spec.shot_id, task_id: spec.task_id
      });
      return simulateComfy(spec, 'COMFY_OFFLINE: ' + (apiErr.message ?? '未知错误'));
    }
  }
  return simulateComfy(spec, 'SIMULATE_MODE');
}

async function simulateComfy(spec: VideoSpec, reason: string): Promise<VideoResult> {
  // 本地链路：H3 单机并发=1 的等待语义 + OOM 降级
  const latency = Math.round(cardLatency(spec.duration_ms));
  await sleep(latency);
  const oom = spec.duration_ms > 8000 && Math.random() < 0.08;
  let degraded = false;
  let duration = spec.duration_ms;
  if (oom) {
    degraded = true;
    duration = Math.min(spec.duration_ms, 6000);
    logger.warn('H3 显存不足，降级重试（缩短片段）', { service: 'comfy', shot_id: spec.shot_id, task_id: spec.task_id });
  }
  const clip = await writeProxyClip({ ...spec, duration_ms: duration });
  const posterId = writePosterAsset(spec);
  const asset = createAsset({
    project_id: spec.project_id,
    asset_type: 'video',
    source: 'comfy_h3',
    key: clip ? clip.key : assetKey('projects', spec.project_id, 'render', spec.shot_id, spec.task_id + '.json'),
    width: spec.width,
    height: spec.height,
    duration_sec: Math.round((duration / 1000) * 100) / 100,
    meta: {
      engine: 'comfy_h3',
      simulated: !clip,
      proxy: !!clip,
      simulate_reason: reason,
      degraded,
      poster_asset_id: posterId,
      prompt: spec.prompt,
      negative: spec.negative,
      workflow: spec.engine_params?.template_key ?? STYLE_PRESETS[spec.visual_style].comfy_template_key
    }
  });
  if (!clip) {
    fs.writeFileSync(objectPath('assets', asset.object_key), JSON.stringify({ shot_code: spec.shot_code, prompt: spec.prompt, note: '占位清单：安装 FFmpeg 后可产出可播放代理片' }, null, 2), 'utf8');
  }
  logger.info('本地镜头渲染完成', { service: 'comfy', shot_id: spec.shot_id, task_id: spec.task_id, latency_ms: latency, degraded });
  return { asset_id: asset.id, poster_asset_id: posterId, duration_ms: duration, simulated: true, degraded, path: clip?.absPath ?? null };
}

function cardLatency(durationMs: number): number {
  // 本地渲染随片段时长增长：5s ≈ 3.2s（模拟值，真实 H3 为 2.5–5min）
  return Math.max(700, Math.min(9000, 420 + durationMs * 0.55));
}

/** 工作流参数注入（Agent 拉任务时返回 true ComfyUI workflow） */
export function injectWorkflow(
  templateBody: Record<string, unknown>,
  paramMap: Record<string, unknown>,
  params: Record<string, unknown>
): Record<string, unknown> {
  const workflow = JSON.parse(JSON.stringify(templateBody ?? {})) as Record<string, unknown>;
  for (const [paramKey, target] of Object.entries(paramMap ?? {})) {
    if (!(paramKey in params)) continue;
    const t = target as { node?: string; field?: string };
    const nodeId = String(t?.node ?? '');
    const field = String(t?.field ?? 'inputs.text');
    const node = workflow[nodeId] as Record<string, unknown> | undefined;
    if (!node) continue;
    if (field.includes('.')) {
      const parts = field.split('.');
      let cursor: Record<string, unknown> = node;
      for (let i = 0; i < parts.length - 1; i++) {
        const next = cursor[parts[i]];
        if (!next || typeof next !== 'object') cursor[parts[i]] = {};
        cursor = cursor[parts[i]] as Record<string, unknown>;
      }
      cursor[parts[parts.length - 1]] = params[paramKey];
    } else {
      node[field] = params[paramKey];
    }
  }
  return workflow;
}
