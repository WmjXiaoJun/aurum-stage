/**
 * 角色工坊（参考 AiJue 角色契约）：本机 SDXL + IP-Adapter 生成
 * portrait（概念立绘）/ three_view（正/侧/四分之三全身）/ expressions（四种表情头像）
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { all, get, nowIso, run } from '../db/index.js';
import { assetKey, createAsset, objectPath } from './storage.js';
import { mapCharacter } from '../domain/mappers.js';
import { ApiError } from '../http/errors.js';

type ArtKind = 'portrait' | 'three_view' | 'expressions';

const STYLE_CFG: Record<string, { ckpt: string; steps: number; cfg: number; sampler: string; negative: string }> = {
  photoreal: { ckpt: 'RealVisXL_V5.0_fp16.safetensors', steps: 24, cfg: 5.5, sampler: 'dpmpp_2m', negative: 'cartoon, anime, 3d, extra fingers, deformed, text, watermark, logo, ui, screen, badge, sticker, two different people' },
  anime_2d: { ckpt: 'animagine-xl-4.0.safetensors', steps: 26, cfg: 6, sampler: 'euler_ancestral', negative: 'photorealistic, 3d, realistic skin, text, watermark, logo, extra limbs, two different people' },
  cgi_3d: { ckpt: 'DreamShaperXL_Turbo_v2_1.safetensors', steps: 8, cfg: 2.2, sampler: 'dpmpp_sde', negative: 'photo, realistic, flat 2d, sketch, text, watermark, logo, ui, screen, badge, sticker, deformed, two different people' },
  comic: { ckpt: 'NoobAI-XL-v1.0.safetensors', steps: 26, cfg: 6, sampler: 'euler_ancestral', negative: 'photo, realistic, 3d, text, watermark, logo, extra limbs, two different people' }
};

const STYLE_PROMPT: Record<string, string> = {
  photoreal: 'realistic portrait photograph, natural skin texture, soft key light, 85mm lens',
  anime_2d: '2d anime character, cel shading, clean lineart, flat colors, anime key visual',
  cgi_3d: 'stylized 3d cartoon character, pixar style animation, smooth stylized skin, big expressive eyes, non-photorealistic, 3d render',
  comic: 'comic book character, bold ink outlines, halftone shading, graphic novel style'
};

interface ViewSpec { angle: string; label: string; prompt: string; width: number; height: number; ipWeight: number; neg: string }

const VIEWS: Record<ArtKind, ViewSpec[]> = {
  portrait: [
    { angle: 'front', label: '概念立绘', prompt: 'character concept art, upper body portrait, front view, looking at camera, clean plain background, soft studio lighting, highly detailed face, solo, same character, no text, no logo, no badge', width: 768, height: 1024, ipWeight: 0.7, neg: 'full body, multiple people, collage, text, logo, badge, ui, screen' }
  ],
  three_view: [
    { angle: 'front', label: '正面全身', prompt: 'full body shot from head to toe, whole figure visible, feet on the floor, standing straight facing camera, arms relaxed, plain white studio background, fashion reference photograph, solo, same character, consistent face and outfit', width: 640, height: 1024, ipWeight: 0.32, neg: 'portrait, headshot, close-up, upper body, waist up, cropped body, face only, multiple people, collage, split screen' },
    { angle: 'profile', label: '侧面全身', prompt: 'full body shot from head to toe, whole figure visible, side profile view, standing straight, feet on the floor, plain white studio background, fashion reference photograph, solo, same character, consistent face and outfit', width: 640, height: 1024, ipWeight: 0.32, neg: 'portrait, headshot, close-up, upper body, waist up, cropped body, face only, multiple people, collage, split screen' },
    { angle: 'full', label: '四分之三全身', prompt: 'full body shot from head to toe, whole figure visible, three-quarter angle view, standing natural pose, feet on the floor, plain white studio background, fashion reference photograph, solo, same character, consistent face and outfit', width: 640, height: 1024, ipWeight: 0.32, neg: 'portrait, headshot, close-up, upper body, waist up, cropped body, face only, multiple people, collage, split screen' }
  ],
  expressions: [
    { angle: 'front', label: '平静', prompt: 'headshot portrait, neutral calm expression, looking at camera, plain background, solo, same character', width: 768, height: 768, ipWeight: 0.55, neg: 'full body, two different people, collage' },
    { angle: 'smile', label: '微笑', prompt: 'headshot portrait, warm happy smile, looking at camera, plain background, solo, same character', width: 768, height: 768, ipWeight: 0.55, neg: 'full body, two different people, collage' },
    { angle: 'expression', label: '惊讶', prompt: 'headshot portrait, surprised expression, wide eyes, slightly open mouth, plain background, solo, same character', width: 768, height: 768, ipWeight: 0.55, neg: 'full body, two different people, collage' },
    { angle: 'expression', label: '思考', prompt: 'headshot portrait, thoughtful expression, looking slightly away, hand near chin, plain background, solo, same character', width: 768, height: 768, ipWeight: 0.55, neg: 'full body, two different people, collage' }
  ]
};

async function comfy(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(config.comfy.baseUrl.replace(/\/$/, '') + pathname, init);
}

async function uploadReference(absPath: string): Promise<string | null> {
  if (!fs.existsSync(absPath)) return null;
  const buf = fs.readFileSync(absPath);
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/png' }), 'aurum_char_ref_' + Date.now() + '.png');
  form.append('overwrite', 'true');
  const res = await comfy('/upload/image', { method: 'POST', body: form });
  if (!res.ok) return null;
  const data = (await res.json()) as { name?: string };
  return data.name ?? null;
}

async function waitHistory(promptId: string, timeoutMs: number): Promise<Array<{ filename: string; subfolder: string; type: string }> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const hist = (await comfy('/history/' + promptId).then((r) => r.json())) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>;
    const entry = hist[promptId];
    if (!entry) continue;
    for (const out of Object.values(entry.outputs ?? {})) {
      if (out.images?.length) return out.images.map((i) => ({ filename: i.filename, subfolder: i.subfolder ?? '', type: i.type ?? 'output' }));
    }
  }
  return null;
}

async function downloadImage(file: { filename: string; subfolder: string; type: string }, outPath: string): Promise<boolean> {
  const url = '/view?filename=' + encodeURIComponent(file.filename) + '&subfolder=' + encodeURIComponent(file.subfolder) + '&type=' + encodeURIComponent(file.type);
  const res = await comfy(url);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return true;
}

export interface GenerateArtInput {
  character_id: number;
  modes?: ArtKind[];
  count?: number;
  style?: string;
  extra_prompt?: string;
}

export async function generateCharacterArt(input: GenerateArtInput): Promise<{ assets: Array<{ id: number; url: string; kind: ArtKind; angle: string; label: string }>; prompt_ids: string[] }> {
  const row = get('SELECT * FROM character_asset WHERE id = ?', [input.character_id]);
  if (!row) throw new ApiError('NOT_FOUND', '角色不存在');
  const character = mapCharacter(row);
  const project = get('SELECT visual_style FROM project WHERE id = ?', [character.project_id]);
  const style = input.style ?? String(project?.visual_style ?? 'photoreal');
  const cfg = STYLE_CFG[style] ?? STYLE_CFG.photoreal;
  const modes = (input.modes && input.modes.length ? input.modes : ['portrait']) as ArtKind[];
  const count = Math.max(1, Math.min(2, input.count ?? 1));

  const anchorRow = get('SELECT * FROM character_ref_image WHERE character_id = ? ORDER BY id LIMIT 1', [character.id]);
  const anchorAsset = anchorRow ? get('SELECT * FROM asset WHERE id = ?', [Number(anchorRow.asset_id)]) : null;
  const anchorPath = anchorAsset ? objectPath(String(anchorAsset.bucket), String(anchorAsset.object_key)) : null;
  const uploadedRef = anchorPath ? await uploadReference(anchorPath) : null;

  const results: Array<{ id: number; url: string; kind: ArtKind; angle: string; label: string }> = [];
  const promptIds: string[] = [];

  for (const kind of modes) {
    const views = VIEWS[kind] ?? VIEWS.portrait;
    const repeats = kind === 'portrait' ? count : 1;
    for (const view of views) {
      for (let r = 0; r < repeats; r++) {
        const seed = Number(character.seed ?? 1) + r * 13;
        const anchorPrompt = String((row as Record<string, unknown>).anchor_prompt ?? '');
        const prompt = [STYLE_PROMPT[style] ?? '', character.prompt_prefix, character.persona, anchorPrompt, view.prompt, 'no text, no logo, no badge, clean plain background', input.extra_prompt ?? ''].filter(Boolean).join(', ');
        const positive = { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } };
        const negative = { class_type: 'CLIPTextEncode', inputs: { text: [cfg.negative, character.negative_extra, view.neg].filter(Boolean).join(', '), clip: ['4', 1] } };
        const workflow: Record<string, unknown> = {
          '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.ckpt } },
          '5': { class_type: 'EmptyLatentImage', inputs: { width: view.width, height: view.height, batch_size: 1 } },
          '6': positive,
          '7': negative,
          '3': { class_type: 'KSampler', inputs: { seed, steps: cfg.steps, cfg: cfg.cfg, sampler_name: cfg.sampler, scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
          '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
          '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'aurum_char_' + kind } }
        };
        if (uploadedRef) {
          workflow['10'] = { class_type: 'IPAdapterUnifiedLoader', inputs: { model: ['4', 0], preset: 'PLUS (high strength)' } };
          workflow['18'] = { class_type: 'LoadImage', inputs: { image: uploadedRef } };
          workflow['11'] = { class_type: 'IPAdapterAdvanced', inputs: { model: ['10', 0], ipadapter: ['10', 1], image: ['18', 0], weight: view.ipWeight, weight_type: 'linear', combine_embeds: 'concat', start_at: 0, end_at: 1, embeds_scaling: 'V only' } };
          (workflow['3'] as { inputs: Record<string, unknown> }).inputs.model = ['11', 0];
        }
        const submit = await comfy('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'aurum-character' }) });
        if (!submit.ok) {
          logger.warn('角色概念图提交失败：' + (await submit.text()).slice(0, 200), { service: 'character' });
          continue;
        }
        const { prompt_id: promptId } = (await submit.json()) as { prompt_id: string };
        promptIds.push(promptId);
        const files = await waitHistory(promptId, 6 * 60 * 1000);
        if (!files?.length) continue;
        const key = assetKey('projects', character.project_id, 'characters', String(character.id), kind + '_' + view.angle + '_' + seed + '.png');
        const abs = objectPath('assets', key);
        if (!(await downloadImage(files[0], abs))) continue;
        const asset = createAsset({
          project_id: character.project_id,
          asset_type: 'image',
          source: 'comfy_h3',
          key,
          width: view.width,
          height: view.height,
          meta: { kind: 'character_art', art_kind: kind, angle: view.angle, style, seed, prompt, provider: 'comfyui', simulated: false, ipadapter: Boolean(uploadedRef) }
        });
        run('INSERT INTO character_ref_image (character_id, asset_id, angle, weight) VALUES (?,?,?,?)', [character.id, asset.id, kind, 1]);
        run('UPDATE character_asset SET anchor_prompt = COALESCE(NULLIF(anchor_prompt, \'\'), ?) WHERE id = ?', [prompt.slice(0, 400), character.id]);
        results.push({ id: asset.id, url: '/api/v1/assets/' + asset.id + '/raw', kind, angle: view.angle, label: view.label });
      }
    }
  }
  return { assets: results, prompt_ids: promptIds };
}

export function characterFiles(characterId: number): Record<string, Array<{ id: number; url: string; kind: string }>> {
  const rows = all('SELECT * FROM character_ref_image WHERE character_id = ? ORDER BY id', [characterId]);
  const grouped: Record<string, Array<{ id: number; url: string; kind: string }>> = { portrait: [], three_view: [], expressions: [] };
  for (const r of rows) {
    const angle = String(r.angle ?? 'portrait');
    const bucket = angle in grouped ? angle : 'portrait';
    grouped[bucket].push({ id: Number(r.asset_id), url: '/api/v1/assets/' + Number(r.asset_id) + '/raw', kind: angle });
  }
  return grouped;
}

void nowIso;
