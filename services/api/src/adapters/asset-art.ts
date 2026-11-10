/** 视觉资产计划 → 真实出图：把技能规划的场景/道具提示词交给本机 SDXL 生成 */
import fs from 'node:fs';
import path from 'node:path';
import { get } from '../db/index.js';
import { logger } from '../logger.js';
import { assetKey, createAsset, objectPath } from './storage.js';

const STYLE = {
  photoreal: { ckpt: 'RealVisXL_V5.0_fp16.safetensors', steps: 20, cfg: 5.5, sampler: 'dpmpp_2m', neg: 'cartoon, anime, text, watermark, logo' },
  anime_2d: { ckpt: 'animagine-xl-4.0.safetensors', steps: 24, cfg: 6, sampler: 'euler_ancestral', neg: 'photo, realistic, text, watermark, logo' },
  cgi_3d: { ckpt: 'DreamShaperXL_Turbo_v2_1.safetensors', steps: 8, cfg: 2.2, sampler: 'dpmpp_sde', neg: 'photo, flat 2d, text, watermark, logo' },
  comic: { ckpt: 'NoobAI-XL-v1.0.safetensors', steps: 24, cfg: 6, sampler: 'euler_ancestral', neg: 'photo, realistic, 3d, text, watermark, logo' }
} as const;

type StyleKey = keyof typeof STYLE;

async function comfyFetch(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch('http://127.0.0.1:8188' + pathname, init);
}

async function renderOne(prompt: string, style: StyleKey, seed: number, width: number, height: number, outAbs: string): Promise<boolean> {
  const cfg = STYLE[style] ?? STYLE.photoreal;
  const wf = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: cfg.neg, clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { seed, steps: cfg.steps, cfg: cfg.cfg, sampler_name: cfg.sampler, scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'aurum_plan' } }
  };
  const res = await comfyFetch('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'aurum-plan' }) });
  if (!res.ok) { logger.warn('计划出图提交失败：' + (await res.text()).slice(0, 160), { service: 'asset-art' }); return false; }
  const id = JSON.parse(await res.text()).prompt_id as string;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const hist = (await comfyFetch('/history/' + id).then((r) => r.json())) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>;
    const img = hist[id]?.outputs?.['9']?.images?.[0];
    if (!img) continue;
    const view = '/view?filename=' + encodeURIComponent(img.filename) + '&subfolder=' + encodeURIComponent(img.subfolder ?? '') + '&type=' + encodeURIComponent(img.type ?? 'output');
    const ab = await comfyFetch(view).then((r) => r.arrayBuffer());
    const buf = Buffer.from(ab as ArrayBuffer);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, buf);
    return true;
  }
  return false;
}

export interface PlanArtItem { name?: string; kind?: string; prompt?: string }

export async function generatePlanArt(projectId: number, items: PlanArtItem[], limit = 4): Promise<{ generated: number; ids: number[] }> {
  const project = get('SELECT visual_style FROM project WHERE id = ?', [projectId]);
  const style = String(project?.visual_style ?? 'photoreal') as StyleKey;
  const picked = items.filter((i) => String(i.kind) === 'scene').slice(0, limit);
  const ids: number[] = [];
  for (let i = 0; i < picked.length; i++) {
    const item = picked[i];
    const prompt = String(item.prompt ?? 'variety show stage, cinematic lighting');
    const key = assetKey('projects', projectId, 'plan_art', i + '.png');
    const abs = objectPath('assets', key);
    const ok = await renderOne(prompt + ', no text', style, 20261110 + i, 1280, 720, abs);
    if (!ok) continue;
    const asset = createAsset({ project_id: projectId, asset_type: 'image', source: 'comfy_h3', key, width: 1280, height: 720, meta: { kind: 'plan_art', plan_name: item.name ?? '', style, simulated: false } });
    ids.push(asset.id);
  }
  return { generated: ids.length, ids };
}
