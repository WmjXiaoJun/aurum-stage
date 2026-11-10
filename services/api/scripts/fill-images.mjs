/** 补图：角色立绘 + 项目封面（缺失才生成） */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const API = 'http://127.0.0.1:8787/api/v1';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const COMFY = 'http://127.0.0.1:8188';
const db = new DatabaseSync(DATA + '/aurum.db');
const STYLE = {
  photoreal: { ckpt: 'RealVisXL_V5.0_fp16.safetensors', steps: 20, cfg: 5.5, sampler: 'dpmpp_2m', neg: 'cartoon, anime, text, watermark' },
  anime_2d: { ckpt: 'animagine-xl-4.0.safetensors', steps: 24, cfg: 6, sampler: 'euler_ancestral', neg: 'photo, realistic, text, watermark' },
  cgi_3d: { ckpt: 'DreamShaperXL_Turbo_v2_1.safetensors', steps: 8, cfg: 2.2, sampler: 'dpmpp_sde', neg: 'photo, flat 2d, text, watermark' },
  comic: { ckpt: 'NoobAI-XL-v1.0.safetensors', steps: 24, cfg: 6, sampler: 'euler_ancestral', neg: 'photo, realistic, text, watermark' }
};
async function gen(prompt, style, seed, outAbs, width = 1280, height = 720) {
  const cfg = STYLE[style] ?? STYLE.photoreal;
  const wf = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: cfg.neg, clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { seed, steps: cfg.steps, cfg: cfg.cfg, sampler_name: cfg.sampler, scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'aurum_fill' } }
  };
  const res = await fetch(COMFY + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'aurum-fill' }) });
  if (!res.ok) return false;
  const id = JSON.parse(await res.text()).prompt_id;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const hist = await fetch(COMFY + '/history/' + id).then((r) => r.json());
    const out = hist[id]?.outputs?.['9']?.images?.[0];
    if (!out) continue;
    const view = COMFY + '/view?filename=' + encodeURIComponent(out.filename) + '&subfolder=' + encodeURIComponent(out.subfolder ?? '') + '&type=' + encodeURIComponent(out.type ?? 'output');
    const buf = Buffer.from(await fetch(view).then((r) => r.arrayBuffer()));
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, buf);
    return true;
  }
  return false;
}

// 1) 角色补立绘
const chars = await fetch(API + '/characters').then((r) => r.json());
let art = 0;
for (const c of chars) {
  if (c.cover_url) continue;
  const res = await fetch(API + '/characters/' + c.id + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modes: ['portrait'], count: 1, style: c.project_style || 'photoreal' }) });
  const data = await res.json();
  if ((data.assets || []).length) art += 1;
  console.log('char', c.id, c.name, (data.assets || []).length);
}

// 2) 项目补封面（无图片资产的项目）
const projects = await fetch(API + '/projects').then((r) => r.json());
let covers = 0;
for (const p of projects) {
  const has = db.prepare("select id from asset where project_id = ? and asset_type='image' limit 1").get(p.id);
  if (has) continue;
  const row = db.prepare('select style_prompt, visual_style, name from project where id = ?').get(p.id);
  const style = String(row.visual_style ?? 'photoreal');
  const base = String(row.style_prompt ?? '').slice(0, 400);
  const prompt = [base, 'variety show stage, wide establishing shot, cinematic lighting, high detail, no text'].filter(Boolean).join(', ');
  const key = 'projects/' + p.id + '/cover/cover.png';
  const abs = path.join(DATA, 'storage/assets', key);
  const ok = await gen(prompt, style, 20261109 + p.id, abs);
  if (ok) {
    db.prepare("insert into asset (project_id, asset_type, source, bucket, object_key, width, height, meta, created_at) values (?,?,?,?,?,?,?,?,?)").run(p.id, 'image', 'comfy_h3', 'assets', key, 1280, 720, JSON.stringify({ kind: 'project_cover', style }), new Date().toISOString());
    covers += 1;
  }
  console.log('cover', p.id, p.name, ok);
}
console.log(JSON.stringify({ art, covers }));
process.exit(0);
