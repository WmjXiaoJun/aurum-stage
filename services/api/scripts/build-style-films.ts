/**
 * 四种视觉风格各出一条 5 分钟（≤300 秒）样片：
 * 台本（本地规则引擎）→ 本机 ComfyUI 生成该风格剧照 → 逐镜配音 → 静帧成片 → 合成 720×1280 成片
 */
import fs from 'node:fs';
import path from 'node:path';
import { COMPOSE_PRESETS, STYLE_PRESETS, type VarietyType, type VisualStyleId } from '@aurum/core';
import { all, get, json, nowIso, run } from '../src/db/index.js';
import { createProject, getProject, rebuildSegmentDurations } from '../src/domain/project-service.js';
import { persistStructuredScript, recomputeAll } from '../src/domain/script-service.js';
import { fallbackCharacters, fallbackOutline, fallbackScript } from '../src/orchestration/fallback.js';
import { synthesize } from '../src/adapters/tts.js';
import { assetKey, createAsset, objectPath } from '../src/adapters/storage.js';
import { imageToClip } from '../src/media/ffmpeg.js';
import { composeProject } from '../src/adapters/compose.js';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve('shots/films');
fs.mkdirSync(OUT_DIR, { recursive: true });

const STYLE_CFG = {
  photoreal: {
    label: '写实真人',
    ckpt: 'RealVisXL_V5.0_fp16.safetensors',
    steps: 24,
    cfg: 5.5,
    sampler: 'dpmpp_2m',
    prompt: 'cinematic photograph, a Chinese talk show host in a navy suit in a warm-lit studio, large windows with city bokeh, medium shot, shallow depth of field, 35mm lens, natural skin texture, soft key light, film grain',
    negative: 'cartoon, anime, illustration, 3d render, plastic skin, deformed hands, extra limbs, text, watermark'
  },
  anime_2d: {
    label: '二维动画',
    ckpt: 'animagine-xl-4.0.safetensors',
    steps: 26,
    cfg: 6,
    sampler: 'euler_ancestral',
    prompt: '2d anime cel shading, a cheerful anime host in a bright variety studio, clean bold lineart, flat colors, simple shading, colorful stage lights, medium shot, expressive face',
    negative: 'photorealistic, 3d, realistic skin, photo, scan, deformed, extra limbs, text, watermark'
  },
  cgi_3d: {
    label: '三维动画',
    ckpt: 'DreamShaperXL_Turbo_v2_1.safetensors',
    steps: 8,
    cfg: 2.2,
    sampler: 'dpmpp_sde',
    prompt: 'stylized 3d render, pixar-like cartoon host character in a futuristic game show studio, volumetric lighting, glossy materials, subsurface scattering, octane render, medium shot, cinematic composition',
    negative: 'photo, realistic, flat 2d, sketch, low poly, deformed, extra limbs, text, watermark'
  },
  comic: {
    label: '漫画漫剧',
    ckpt: 'NoobAI-XL-v1.0.safetensors',
    steps: 26,
    cfg: 6,
    sampler: 'euler_ancestral',
    prompt: 'comic panel, manga style, bold ink outlines, screentone shading, dramatic composition, a host talking to camera in a studio panel, high contrast black and white with warm accent, dynamic angles',
    negative: 'photo, realistic, 3d, color photo, blurry, deformed, extra limbs, text, watermark'
  }
} as const;

const STYLE_SOURCE: Record<VisualStyleId, string> = {
  photoreal: '本期用写实真人风格拍一条访谈：主持人阿哲请来两位嘉宾，聊为什么大多数团队做不出能打动人的微综艺，从选题、台词到镜头，一件件拆开说。',
  anime_2d: '本期用二维动画风格做一条轻松科普：卡通主持人小满和搭档用夸张的表情和快节奏对话，讲清楚一档微综艺从创意到成片的五个环节。',
  cgi_3d: '本期用三维动画风格做一条闯关综艺：虚拟主持人带着两位选手在立体演播厅里完成三轮挑战，输的人要接受现场惩罚。',
  comic: '本期用漫画漫剧风格讲一个行业故事：深夜的剪辑室里，导演和剪辑师为了一分钟的节奏争论到天亮，最后用一张分镜定输赢。'
};

async function comfyImage(cfg: typeof STYLE_CFG[keyof typeof STYLE_CFG], seed: number, outPath: string): Promise<boolean> {
  const wf = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1344, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: cfg.prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: cfg.negative, clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { seed, steps: cfg.steps, cfg: cfg.cfg, sampler_name: cfg.sampler, scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'aurum_style_' + cfg.label } }
  };
  const res = await fetch(COMFY + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'aurum-style' }) });
  if (!res.ok) { console.log('  提交失败', await res.text()); return false; }
  const id = JSON.parse(await res.text()).prompt_id;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const hist = await fetch(COMFY + '/history/' + id).then((r) => r.json());
    const entry = hist[id];
    if (!entry) continue;
    const out = entry.outputs?.['9']?.images?.[0];
    if (!out) continue;
    const view = COMFY + '/view?filename=' + encodeURIComponent(out.filename) + '&subfolder=' + encodeURIComponent(out.subfolder ?? '') + '&type=' + encodeURIComponent(out.type ?? 'output');
    const buf = Buffer.from(await fetch(view).then((r) => r.arrayBuffer()));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return true;
  }
  return false;
}

const styleList: VisualStyleId[] = ['photoreal', 'anime_2d', 'cgi_3d', 'comic'];
const summary: Array<Record<string, unknown>> = [];

for (const style of styleList) {
  const cfg = STYLE_CFG[style];
  const preset = STYLE_PRESETS[style];
  console.log('======== ' + cfg.label + ' ========');
  const name = '风格样片 · ' + cfg.label;
  let project = all<Record<string, unknown>>('select * from project where name = ?', [name])[0];
  const projectId = project ? Number(project.id) : createProject({
    name,
    variety_type: (style === 'cgi_3d' ? 'challenge' : style === 'comic' ? 'skit' : 'talk_show') as VarietyType,
    visual_style: style,
    aspect_ratio: '9:16',
    style_prompt: preset.prefix,
    style_negative: preset.negative
  }).id;
  const proj = getProject(projectId);

  const characters = fallbackCharacters(STYLE_SOURCE[style], proj.variety_type);
  const outline = fallbackOutline(STYLE_SOURCE[style], proj.variety_type, 288);
  const structured = fallbackScript({
    project_id: projectId,
    title: name,
    sourceText: STYLE_SOURCE[style],
    varietyType: proj.variety_type,
    visualStyle: style,
    targetSec: 288,
    characters,
    outline
  });
  const persisted = persistStructuredScript(proj, structured);
  console.log('台本：' + persisted.segments + ' 环节 / ' + persisted.shots + ' 镜头，合计 ' + Math.round(Number(get('select sum(duration_ms) as d from segment where project_id = ?', [projectId])?.d ?? 0) / 1000) + 's');

  // 风格剧照（4 张，轮换使用）
  const stills: string[] = [];
  for (let i = 0; i < 4; i++) {
    const key = assetKey('projects', projectId, 'style', style + '_' + i + '.png');
    const abs = objectPath('assets', key);
    const ok = await comfyImage(cfg, 20261107 + i * 977, abs);
    console.log('  剧照 ' + (i + 1) + '/4 ' + (ok ? '生成成功' : '失败'));
    if (ok) {
      createAsset({ project_id: projectId, asset_type: 'image', source: 'comfy_h3', key, width: 768, height: 1344, meta: { kind: 'style_still', style, prompt: cfg.prompt } });
      stills.push(abs);
    }
  }
  if (stills.length === 0) { console.log('  没有可用剧照，跳过该风格'); continue; }

  const shots = all<Record<string, unknown>>('select * from round_shot where project_id = ? order by segment_id, seq', [projectId]);
  const presetSize = COMPOSE_PRESETS['9:16'];
  let idx = 0;
  for (const shot of shots) {
    const shotId = Number(shot.id);
    const text = String(shot.text_clean ?? '');
    const tts = await synthesize({
      project_id: projectId,
      shot_id: shotId,
      task_id: shotId,
      text: text || '空镜',
      voice_id: String(shot.voice_id ?? 'v_narrator'),
      emotion: String(shot.emotion ?? ''),
      emotion_instruction: String(shot.emotion_instruction ?? ''),
      speed: Number(shot.tts_speed ?? 1),
      target_duration_ms: null,
      candidates: 1
    });
    const wavAsset = tts.candidates[0];
    const wavAbs = objectPath('assets', String(get('select object_key from asset where id = ?', [wavAsset.asset_id])?.object_key ?? ''));
    const duration = tts.duration_ms + 300;
    const clipKey = assetKey('projects', projectId, 'style_clips', shotId + '.mp4');
    const clipAbs = objectPath('assets', clipKey);
    const clip = await imageToClip({
      imagePath: stills[idx % stills.length],
      audioPath: text ? wavAbs : null,
      outPath: clipAbs,
      width: presetSize.width,
      height: presetSize.height,
      fps: presetSize.fps,
      durationMs: duration,
      crf: 24
    });
    idx += 1;
    if (!clip.ok) { console.log('  镜头 ' + shotId + ' 合成失败：' + clip.error); continue; }
    const videoAsset = createAsset({
      project_id: projectId,
      asset_type: 'video',
      source: 'comfy_h3',
      key: clipKey,
      width: presetSize.width,
      height: presetSize.height,
      duration_sec: Math.round((duration / 1000) * 100) / 100,
      meta: { engine: 'comfy_h3', provider: 'comfyui-stillfilm', simulated: true, style, prompt: String(shot.visual_prompt ?? '') }
    });
    run('update round_shot set tts_asset_id = ?, tts_duration_ms = ?, preview_asset_id = ?, lipsync_asset_id = null, render_engine = ?, status = ?, updated_at = ? where id = ?', [
      wavAsset.asset_id, tts.duration_ms, videoAsset.id, 'comfy_h3', 'generated', nowIso(), shotId
    ]);
    if (idx % 10 === 0) console.log('  镜头处理进度 ' + idx + '/' + shots.length);
  }

  const compliance = recomputeAll(projectId);
  const total = compliance.reduce((n, c) => n + c.duration_ms, 0);
  console.log('  时长：' + Math.round(total / 1000) + 's，超限段 ' + compliance.filter((c) => c.exceed).length);
  const result = await composeProject({ project_id: projectId, segment_id: null, bgm: true });
  const finalPath = result.output_path;
  let copied = '';
  if (finalPath && fs.existsSync(finalPath)) {
    copied = path.join(OUT_DIR, style + '.mp4');
    fs.copyFileSync(finalPath, copied);
    console.log('  成片：' + copied + ' ' + Math.round(fs.statSync(copied).size / 1024 / 1024 * 10) / 10 + ' MB，' + result.duration_sec + 's');
  } else {
    console.log('  合成未产出 mp4：' + JSON.stringify(result.warnings).slice(0, 200));
  }
  summary.push({ style, project_id: projectId, shots: shots.length, duration_sec: result.duration_sec, file: copied, warnings: result.warnings.length });
}

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('ALL DONE');
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
