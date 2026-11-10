/** 给所有模板补齐封面（缺图才生成） */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const db = new DatabaseSync(DATA + '/aurum.db');
const COMFY = 'http://127.0.0.1:8188';
const DIR = DATA + '/storage/assets/templates';
const STYLE = {
  photoreal: { ckpt: 'RealVisXL_V5.0_fp16.safetensors', steps: 18, cfg: 5.5, sampler: 'dpmpp_2m', neg: 'cartoon, anime, text, watermark, logo' },
  anime_2d: { ckpt: 'animagine-xl-4.0.safetensors', steps: 20, cfg: 6, sampler: 'euler_ancestral', neg: 'photo, realistic, text, watermark' },
  cgi_3d: { ckpt: 'DreamShaperXL_Turbo_v2_1.safetensors', steps: 8, cfg: 2.2, sampler: 'dpmpp_sde', neg: 'photo, flat 2d, text, watermark' },
  comic: { ckpt: 'NoobAI-XL-v1.0.safetensors', steps: 20, cfg: 6, sampler: 'euler_ancestral', neg: 'photo, realistic, 3d, text, watermark' }
};
async function gen(prompt, style, seed, out) {
  const cfg = STYLE[style] ?? STYLE.photoreal;
  const wf = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 640, height: 360, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: cfg.neg, clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { seed, steps: cfg.steps, cfg: cfg.cfg, sampler_name: cfg.sampler, scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'aurum_tplcover' } }
  };
  const res = await fetch(COMFY + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'aurum-tplcover' }) });
  if (!res.ok) return false;
  const id = JSON.parse(await res.text()).prompt_id;
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const hist = await fetch(COMFY + '/history/' + id).then((r) => r.json());
    const img = hist[id]?.outputs?.['9']?.images?.[0];
    if (!img) continue;
    const view = COMFY + '/view?filename=' + encodeURIComponent(img.filename) + '&subfolder=' + encodeURIComponent(img.subfolder ?? '') + '&type=' + encodeURIComponent(img.type ?? 'output');
    const ab = await fetch(view).then((r) => r.arrayBuffer());
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(out, Buffer.from(ab));
    return true;
  }
  return false;
}
const rows = db.prepare('select template_key, display_name, template_type, visual_style, constraints from workflow_template order by id').all();
let made = 0;
for (const r of rows) {
  const out = path.join(DIR, r.template_key + '.png');
  if (fs.existsSync(out)) continue;
  const style = String(r.visual_style ?? 'photoreal');
  const kind = String(r.template_type);
  const base = kind === 'tts_preset'
    ? 'audio recording studio, microphone, waveform, dark gold lighting, cinematic'
    : kind === 'engineering_template'
      ? 'editorial stage blueprint with light beams and timeline strips, cinematic, no text'
      : 'variety show stage, cinematic lighting, wide establishing shot, no text';
  const prompt = base + ', ' + String(r.display_name ?? '') + ' themed';
  const ok = await gen(prompt, style, 20261111 + made, out);
  console.log(r.template_key, ok ? 'ok' : 'fail');
  if (ok) made += 1;
}
console.log('generated', made);
process.exit(0);
