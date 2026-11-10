/** 本地 H3 真跑：用你机器上的 MiniMax-H3 4step 工作流出片（720 归一化由中台合成阶段负责） */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
const requireCjs = createRequire(import.meta.url);
const ffmpeg = requireCjs('ffmpeg-static');
const { spawnSync } = requireCjs('node:child_process');

const COMFY = 'http://127.0.0.1:8188';
const STORAGE = 'services/api/.data/storage/assets';
const FIRST_FRAME = path.resolve('web/public/scenes/scene-interview.jpg');
const OUT_KEY = 'projects/1/local/4/h3_native.mp4';

async function uploadImage(filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/jpeg' }), 'aurum_first_frame.jpg');
  form.append('overwrite', 'true');
  const res = await fetch(COMFY + '/upload/image', { method: 'POST', body: form });
  const text = await res.text();
  if (!res.ok) throw new Error('upload failed ' + res.status + ' ' + text.slice(0, 200));
  const json = JSON.parse(text);
  return json.name ?? json.data?.name;
}

function workflow(imageName, prompt, width, height, length, seed, prefix) {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors', strength_model: 1 } },
    '3': { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['2', 0], shift_video: 6, shift_audio: 3 } },
    '4': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', type: 'minimax', device: 'default' } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' } },
    '18': { class_type: 'LoadImage', inputs: { image: imageName } },
    '7': { class_type: 'MiniMaxH3ImageToVideo', inputs: { clip: ['4', 0], vae: ['5', 0], prompt, width, height, length, first_frame: ['18', 0] } },
    '8': { class_type: 'BasicGuider', inputs: { model: ['3', 0], conditioning: ['7', 0] } },
    '9': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '10': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '11': { class_type: 'BasicScheduler', inputs: { model: ['3', 0], scheduler: 'simple', steps: 4, denoise: 1 } },
    '12': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['9', 0], guider: ['8', 0], sampler: ['10', 0], sigmas: ['11', 0], latent_image: ['7', 1] } },
    '13': { class_type: 'VAEDecodeTiled', inputs: { samples: ['12', 0], vae: ['5', 0], tile_size: 256, overlap: 64, temporal_size: 24, temporal_overlap: 8 } },
    '14': { class_type: 'VAEDecodeAudio', inputs: { samples: ['12', 1], vae: ['6', 0] } },
    '15': { class_type: 'CreateVideo', inputs: { images: ['13', 0], fps: 24, audio: ['14', 0], bit_depth: 8, color_space: 'sRGB', codec: 'none' } },
    '16': { class_type: 'SaveVideo', inputs: { video: ['15', 0], filename_prefix: prefix, format: 'mp4', codec: 'h264' } }
  };
}

const PROMPT = [
  'integrated_multimodal_description: [Shot 1] Live-action cinematic shot: a male talk-show host in his 40s wearing a navy suit sits in a warm-lit studio, medium close-up. Subtle push-in, natural blinking and breathing, hands gesturing slightly. Preserve the identity and composition of the first frame.',
  'overall_soundscape: Quiet studio room tone.',
  'non_diegetic_music: N/A'
].join('\n\n');

async function submit(wf) {
  const res = await fetch(COMFY + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'aurum-h3' }) });
  const text = await res.text();
  if (!res.ok) throw new Error('prompt rejected ' + res.status + ' ' + text.slice(0, 400));
  return JSON.parse(text).prompt_id;
}

async function waitDone(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const hist = await fetch(COMFY + '/history/' + id).then((r) => r.json());
    const entry = hist[id];
    if (entry) {
      if (entry.status && entry.status.status_str === 'error') throw new Error('execution error');
      const outputs = entry.outputs ?? {};
      for (const [node, out] of Object.entries(outputs)) {
        const files = out.images ?? out.gifs ?? out.videos ?? [];
        if (files.length) return { files, node };
      }
    }
    if (Date.now() - lastLog > 30000) {
      lastLog = Date.now();
      const q = await fetch(COMFY + '/queue').then((r) => r.json()).catch(() => ({}));
      console.log('  ...waiting queue running=' + (q.queue_running?.length ?? '?') + ' pending=' + (q.queue_pending?.length ?? '?'));
    }
  }
  throw new Error('timeout');
}

const imageName = await uploadImage(FIRST_FRAME);
console.log('uploaded first frame as', imageName);

const ladder = [
  { w: 448, h: 768, label: '448x768' },
  { w: 384, h: 640, label: '384x640' },
  { w: 256, h: 448, label: '256x448' }
];
let result = null;
for (const size of ladder) {
  console.log('--- 尝试 ' + size.label + ' length=97 ---');
  const wf = workflow(imageName, PROMPT, size.w, size.h, 97, 20261107, 'video/aurum_h3_' + size.label.replace('x', '_'));
  let id;
  try { id = await submit(wf); } catch (e) { console.log('提交失败：' + e.message); continue; }
  console.log('prompt_id', id);
  try {
    const done = await waitDone(id, 25 * 60 * 1000);
    result = { ...size, done, id };
    console.log('完成：', JSON.stringify(done));
    break;
  } catch (e) {
    console.log('失败：' + e.message);
  }
}
if (!result) { console.log('全部尺寸失败'); process.exit(1); }

const file = result.done.files[0];
const view = COMFY + '/view?filename=' + encodeURIComponent(file.filename) + '&subfolder=' + encodeURIComponent(file.subfolder ?? '') + '&type=' + encodeURIComponent(file.type ?? 'output');
const buf = Buffer.from(await fetch(view).then((r) => r.arrayBuffer()));
const abs = path.join(STORAGE, OUT_KEY);
fs.mkdirSync(path.dirname(abs), { recursive: true });
fs.writeFileSync(abs, buf);
console.log('saved', abs, buf.length, 'bytes');

// 归一化到 720×1280（含原生音频）
const norm = 'services/api/.data/storage/assets/projects/1/local/4/h3_native_720.mp4';
const r = spawnSync(ffmpeg, ['-y', '-i', abs, '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,fps=25,setsar=1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', norm], { stdio: 'ignore' });
console.log('normalize', r.status === 0 ? 'ok' : 'fail');

// 写库：模板 + 资产 + 镜头
const db = new DatabaseSync('services/api/.data/aurum.db');
const wf = workflow(imageName, PROMPT, result.w, result.h, 97, 20261107, 'video/aurum_h3');
const now = new Date().toISOString();
db.prepare("insert or replace into workflow_template (template_key, template_type, display_name, template_body, param_map, params_schema, constraints, enabled, visual_style, created_at) values (?,?,?,?,?,?,?,1,?,?)").run(
  'h3_local_native',
  'comfy_workflow',
  '本地 H3 · 原生音视频（4 步 Turbo）',
  JSON.stringify(wf),
  JSON.stringify({ prompt: { node: '7', field: 'inputs.prompt' }, seed: { node: '9', field: 'inputs.noise_seed' }, first_frame: { node: '18', field: 'inputs.image' }, width: { node: '7', field: 'inputs.width' }, height: { node: '7', field: 'inputs.height' }, length: { node: '7', field: 'inputs.length' } }),
  JSON.stringify({ prompt: { type: 'string', required: true }, first_frame: { type: 'string' } }),
  JSON.stringify({ model: 'minimax_h3_fl2va_pruned_int8_convrot', steps: 4, fps: 24, size: result.label, tested_at: now }),
  null,
  now
);
const durationSec = 97 / 24;
const ins = db.prepare("insert into asset (project_id, asset_type, source, bucket, object_key, nfs_path, thumb_key, width, height, duration_sec, meta, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)");
ins.run(1, 'video', 'comfy_h3', 'assets', 'projects/1/local/4/h3_native_720.mp4', null, null, 720, 1280, durationSec,
  JSON.stringify({ engine: 'comfy_h3', provider: 'comfyui-h3-native', template: 'h3_local_native', prompt_id: result.id, simulated: false, proxy: false, native_audio: true, raw_size: result.label, prompt: PROMPT.slice(0, 120) }), now);
const assetId = db.prepare('select last_insert_rowid() as id').get().id;
db.prepare('update round_shot set preview_asset_id = ?, lipsync_asset_id = null, render_engine = ?, status = ?, updated_at = ? where id = 4').run(assetId, 'comfy_h3', 'generated', now);
db.prepare("insert or replace into app_setting (key, value) values ('comfy.template_key', 'h3_local_native')").run();
db.prepare("insert or replace into app_setting (key, value) values ('comfy.simulate', 'false')").run();
db.prepare("insert or replace into app_setting (key, value) values ('comfy.base_url', 'http://127.0.0.1:8188')").run();
db.prepare("insert or replace into agent_node (id, node_key, base_url, engine_tags, vram_total_gb, vram_free_gb, queue_len, status, models_loaded, last_heartbeat, created_at) values (9,'gpu-local','http://127.0.0.1:8188','[\"h3\",\"ipadapter\",\"lipsync\"]',12,10,0,'online','[\"minimax_h3_fl2va_pruned_int8_convrot\",\"qwen3vl_32b_minimax_h3\"]',?,?)").run(now, now);
console.log('asset_id', assetId, 'duration', durationSec.toFixed(2) + 's');
console.log('done');
