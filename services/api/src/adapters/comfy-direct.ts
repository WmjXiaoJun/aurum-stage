/**
 * 本地 ComfyUI 直连渲染（不需要 Python Agent，也能把镜头跑成真产物）
 *   POST {COMFYUI_URL}/prompt → 轮询 /history/{prompt_id} → 取 /view 产物
 * 产物为图片时用 FFmpeg 合成「静帧 + 配音」的 mp4，保证与云端产物同规格（720 / mp4）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { STYLE_PRESETS, type VisualStyleId } from '@aurum/core';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { assetKey, createAsset, objectPath } from './storage.js';
import { comfyDefaultTemplate, comfyUrl } from '../domain/settings-service.js';
import { imageToClip, probeMedia } from '../media/ffmpeg.js';
import { buildPosterSvg } from './poster.js';
import { pickSeed } from '../util.js';
import { ApiError } from '../http/errors.js';
import { all, get, json } from '../db/index.js';

interface TemplateRow {
  template_key: string;
  template_body: string;
  param_map: string;
}

function loadTemplate(key: string | null): { key: string; body: Record<string, { inputs?: Record<string, unknown> }>; paramMap: Record<string, unknown> } | null {
  if (!key) return null;
  const row = get<TemplateRow>('SELECT template_key, template_body, param_map FROM workflow_template WHERE template_key = ?', [key]);
  if (!row) return null;
  return { key: row.template_key, body: json(row.template_body, {}), paramMap: json(row.param_map, {}) };
}

function applyParams(
  workflow: Record<string, { inputs?: Record<string, unknown> }>,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(workflow)) as Record<string, { inputs?: Record<string, unknown> }>;
  for (const [key, value] of Object.entries(values)) {
    // 约定式注入：prompt→节点6、negative→7、seed→3、width/height→5
    const map: Record<string, [string, string]> = {
      prompt: ['6', 'text'],
      negative_prompt: ['7', 'text'],
      seed: ['3', 'seed'],
      width: ['5', 'width'],
      height: ['5', 'height']
    };
    const target = map[key];
    if (!target) continue;
    const node = out[target[0]];
    if (node?.inputs) node.inputs[target[1]] = value;
  }
  return out as unknown as Record<string, unknown>;
}

async function submit(baseUrl: string, workflow: Record<string, unknown>): Promise<string> {
  const res = await fetch(baseUrl + '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: 'aurum-api' })
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError('NODE_ERROR', 'ComfyUI 拒绝执行：' + text.slice(0, 300));
  const parsed = JSON.parse(text) as { prompt_id?: string };
  if (!parsed.prompt_id) throw new ApiError('NODE_ERROR', 'ComfyUI 未返回 prompt_id');
  return parsed.prompt_id;
}

interface ComfyImage { filename: string; subfolder: string; type: string }

async function waitForOutputs(baseUrl: string, promptId: string, timeoutMs = 240000): Promise<ComfyImage[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(baseUrl + '/history/' + encodeURIComponent(promptId));
    if (!res.ok) continue;
    const payload = (await res.json()) as Record<string, { outputs?: Record<string, { images?: ComfyImage[]; gifs?: ComfyImage[] }>; status?: { completed?: boolean; status_str?: string } }>;
    const entry = payload[promptId];
    if (!entry) continue;
    const images: ComfyImage[] = [];
    for (const out of Object.values(entry.outputs ?? {})) {
      for (const img of out.images ?? []) images.push(img);
      for (const gif of out.gifs ?? []) images.push(gif);
    }
    if (images.length > 0) return images;
    if (entry.status?.status_str === 'error') throw new ApiError('NODE_ERROR', 'ComfyUI 执行报错（查看 ComfyUI 控制台）');
  }
  throw new ApiError('CLOUD_TIMEOUT', 'ComfyUI 出图超时');
}

async function download(baseUrl: string, img: ComfyImage): Promise<Buffer> {
  const url = baseUrl + '/view?filename=' + encodeURIComponent(img.filename) + '&subfolder=' + encodeURIComponent(img.subfolder ?? '') + '&type=' + encodeURIComponent(img.type ?? 'output');
  const res = await fetch(url);
  if (!res.ok) throw new ApiError('NODE_ERROR', 'ComfyUI 取产物失败：HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

export interface ComfyDirectSpec {
  project_id: number;
  shot_id: number;
  task_id: number;
  shot_code: string;
  prompt: string;
  negative: string;
  visual_style: string;
  engine_params: Record<string, unknown>;
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
  audio_path?: string | null;
}

export async function comfyDirectRender(spec: ComfyDirectSpec): Promise<{
  asset_id: number;
  poster_asset_id: number | null;
  duration_ms: number;
  prompt_id: string;
  template_key: string;
  frames: number;
}> {
  const base = comfyUrl();
  const templateKey = String(spec.engine_params?.template_key ?? comfyDefaultTemplate() ?? STYLE_PRESETS[spec.visual_style as VisualStyleId]?.comfy_template_key ?? 'comfy_local_image');
  const tpl = loadTemplate(templateKey) ?? loadTemplate('comfy_local_image');
  if (!tpl) throw new ApiError('NODE_ERROR', '没有可用的本地工作流模板，请先在 GPU 节点页探测 ComfyUI');

  const seed = pickSeed(spec.shot_code + ':' + spec.prompt);
  const workflow = applyParams(tpl.body, {
    prompt: spec.prompt,
    negative_prompt: spec.negative,
    seed,
    width: spec.width,
    height: spec.height
  });
  const promptId = await submit(base, workflow);
  logger.info('ComfyUI 直连任务已提交', { service: 'comfy', shot_id: spec.shot_id, task_id: spec.task_id, prompt_id: promptId, template: tpl.key });
  const images = await waitForOutputs(base, promptId);
  const first = images[0];
  const buffer = await download(base, first);
  const ext = path.extname(first.filename) || '.png';

  // 1) 保存 ComfyUI 原图作为海报（真实画面，比 SVG 占位更好）
  const posterKey = assetKey('projects', spec.project_id, 'comfy', spec.shot_id, spec.task_id + '_frame' + ext);
  const posterAbs = objectPath('assets', posterKey);
  fs.mkdirSync(path.dirname(posterAbs), { recursive: true });
  fs.writeFileSync(posterAbs, buffer);
  const posterAsset = createAsset({
    project_id: spec.project_id,
    asset_type: 'image',
    source: 'comfy_h3',
    key: posterKey,
    width: spec.width,
    height: spec.height,
    meta: { kind: 'comfy_frame', prompt_id: promptId, template: tpl.key, seed, simulated: false }
  });

  // 2) 图片 → mp4（滚动静帧 + 配音），保证与云端同规格
  const clipKey = assetKey('projects', spec.project_id, 'comfy', spec.shot_id, spec.task_id + '.mp4');
  const clipAbs = objectPath('assets', clipKey);
  const clip = await imageToClip({
    imagePath: posterAbs,
    audioPath: spec.audio_path ?? null,
    outPath: clipAbs,
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    durationMs: spec.duration_ms
  });
  if (!clip.ok) throw new ApiError('NODE_ERROR', '本地静帧合成 mp4 失败：' + (clip.error ?? ''));

  const probe = await probeMedia(clipAbs);
  const asset = createAsset({
    project_id: spec.project_id,
    asset_type: 'video',
    source: 'comfy_h3',
    key: clipKey,
    width: spec.width,
    height: spec.height,
    duration_sec: Math.round(((probe.duration_ms || spec.duration_ms) / 1000) * 100) / 100,
    meta: {
      engine: 'comfy_h3',
      provider: 'comfyui-direct',
      template: tpl.key,
      prompt_id: promptId,
      seed,
      simulated: false,
      proxy: false,
      poster_asset_id: posterAsset.id,
      frames: images.length,
      source_size: { width: probe.width, height: probe.height },
      prompt: spec.prompt
    }
  });
  logger.info('本地 ComfyUI 成片完成', { service: 'comfy', shot_id: spec.shot_id, task_id: spec.task_id, prompt_id: promptId, bytes: fs.statSync(clipAbs).size });
  return {
    asset_id: asset.id,
    poster_asset_id: posterAsset.id,
    duration_ms: probe.duration_ms || spec.duration_ms,
    prompt_id: promptId,
    template_key: tpl.key,
    frames: images.length
  };
}

/** 便捷：列出可用的本地模板（给前端下拉） */
export function listComfyTemplates(): Array<{ key: string; name: string }> {
  return all<{ template_key: string; display_name: string }>("SELECT template_key, display_name FROM workflow_template WHERE template_type = 'comfy_workflow' AND enabled = 1 ORDER BY id")
    .map((r) => ({ key: r.template_key, name: r.display_name }));
}
