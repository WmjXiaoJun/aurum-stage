/**
 * 本地 ComfyUI 探测与模板自动生成（"用我本地的 ComfyUI 跑一个模板"）
 *   GET /object_info → 读你机器上真实安装的 checkpoint / sampler / 视频节点
 *   然后生成与该机器匹配的 workflow JSON，注册为模板 + 登记 GPU 节点
 */
import { get, jstr, json, nowIso, run } from '../db/index.js';
import { logger } from '../logger.js';
import { ApiError } from '../http/errors.js';
import { comfyUrl, setSetting, SETTING_KEYS } from '../domain/settings-service.js';

export interface ComfyProbeReport {
  reachable: boolean;
  base_url: string;
  checkpoints: string[];
  samplers: string[];
  vaes: string[];
  ipadapter_files: string[];
  features: {
    ipadapter: boolean;
    svd: boolean;
    wan: boolean;
    hunyuan: boolean;
    video_combine: boolean;
  };
  registered: { image_template: string | null; video_template: string | null; node_key: string | null };
  notes: string[];
}

function firstList(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) return [];
  const head = input[0];
  return Array.isArray(head) ? head.filter((x): x is string => typeof x === 'string') : [];
}

async function getObjectInfo(baseUrl: string): Promise<Record<string, { input?: { required?: Record<string, unknown> } }>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(baseUrl + '/object_info', { signal: ctrl.signal });
    if (!res.ok) throw new ApiError('NODE_ERROR', 'ComfyUI /object_info 返回 HTTP ' + res.status);
    return (await res.json()) as Record<string, { input?: { required?: Record<string, unknown> } }>;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('NODE_OFFLINE', '连接不到本地 ComfyUI：' + String((err as Error).message).slice(0, 160) + '（确认已启动，默认端口 8188）');
  } finally {
    clearTimeout(timer);
  }
}

function buildImageWorkflow(ckpt: string, hasIpAdapter: boolean, ipFile: string | null, width = 1280, height = 720): Record<string, unknown> {
  const wf: Record<string, unknown> = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'PASTE_PROMPT', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'PASTE_NEGATIVE', clip: ['4', 1] } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: 20261107, steps: 28, cfg: 6.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
        model: hasIpAdapter && ipFile ? ['12', 0] : ['4', 0],
        positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0]
      }
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'aurum_shot' } }
  };
  if (hasIpAdapter && ipFile) {
    wf['10'] = { class_type: 'LoadImage', inputs: { image: 'PASTE_REF_FILENAME' } };
    wf['11'] = { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: ipFile } };
    wf['12'] = { class_type: 'IPAdapterApply', inputs: { ipadapter: ['11', 0], image: ['10', 0], model: ['4', 0], weight: 0.7, weight_type: 'linear', start_at: 0, end_at: 1, unfold_batch: false } };
  }
  return wf;
}

function buildSvdWorkflow(ckpt: string, svdCkpt: string, width = 1280, height = 720, frames = 25): Record<string, unknown> {
  return {
    '1': { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: svdCkpt } },
    '2': { class_type: 'LoadImage', inputs: { image: 'PASTE_FIRST_FRAME' } },
    '3': {
      class_type: 'SVD_img2vid_Conditioning',
      inputs: { clip_vision: ['1', 1], init_image: ['2', 0], vae: ['1', 2], width, height, video_frames: frames, motion_bucket_id: 42, fps: 25, augmentation_level: 0.0 }
    },
    '4': { class_type: 'VideoLinearCFGGuidance', inputs: { model: ['1', 0], min_cfg: 1.0 } },
    '5': {
      class_type: 'KSampler',
      inputs: { seed: 20261107, steps: 20, cfg: 2.5, sampler_name: 'euler', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['3', 0], negative: ['3', 1], latent_image: ['3', 2] }
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveAnimatedWEBP', inputs: { images: ['6', 0], filename_prefix: 'aurum_svd', fps: 25, lossless: false, quality: 85, method: 'default' } },
    '_meta': { note: '首帧图驱动（SVD），checkpoint 需为 ' + ckpt + ' 同族；若你的机器用 Wan/Hunyuan 视频节点，请在模板页手工替换节点组' }
  };
}

export async function probeComfy(input?: { base_url?: string; register?: boolean }): Promise<ComfyProbeReport> {
  const baseUrl = (input?.base_url ?? comfyUrl()).replace(/\/$/, '');
  if (input?.base_url) setSetting(SETTING_KEYS.comfyUrl, baseUrl);
  const info = await getObjectInfo(baseUrl);
  const notes: string[] = [];

  const checkpoints = firstList(info.CheckpointLoaderSimple?.input?.required?.ckpt_name);
  const samplers = firstList(info.KSampler?.input?.required?.sampler_name);
  const vaes = firstList(info.VAELoader?.input?.required?.vae_name);
  const ipFiles = firstList(info.IPAdapterModelLoader?.input?.required?.ipadapter_file);
  const svdCkpts = firstList(info.ImageOnlyCheckpointLoader?.input?.required?.ckpt_name);
  const features = {
    ipadapter: Boolean(info.IPAdapterApply && info.IPAdapterModelLoader),
    svd: Boolean(info.SVD_img2vid_Conditioning && info.ImageOnlyCheckpointLoader),
    wan: Boolean(info.WanImageToVideo),
    hunyuan: Boolean(info.EmptyHunyuanLatentVideo),
    video_combine: Boolean(info.VHS_VideoCombine)
  };

  if (checkpoints.length === 0) notes.push('未发现 checkpoint（CheckpointLoaderSimple 为空），请先把模型放进 ComfyUI/models/checkpoints');
  const ckpt = checkpoints[0] ?? 'sd_xl_base_1.0.safetensors';
  if (!checkpoints.includes(ckpt)) notes.push('使用占位 checkpoint 名称，请在模板里改成你实际的文件名');
  if (!features.ipadapter) notes.push('未检测到 IPAdapter 节点：角色锚定（on-model）将退化为纯提示词约束');
  if (!features.svd && !features.wan && !features.hunyuan) notes.push('未检测到视频节点（SVD / Wan / Hunyuan）：本地链路只能出静帧，动图需安装对应节点组');
  if (features.video_combine) notes.push('检测到 VHS_VideoCombine：可用它输出 mp4 片段，替换 SaveAnimatedWEBP 即可');

  const imageWf = buildImageWorkflow(ckpt, features.ipadapter, ipFiles[0] ?? null);
  const imageParamMap = {
    prompt: { node: '6', field: 'inputs.text' },
    negative_prompt: { node: '7', field: 'inputs.text' },
    seed: { node: '3', field: 'inputs.seed' },
    width: { node: '5', field: 'inputs.width' },
    height: { node: '5', field: 'inputs.height' },
    checkpoint: { node: '4', field: 'inputs.ckpt_name' },
    ...(features.ipadapter ? { ref_image: { node: '10', field: 'inputs.image' } } : {})
  };

  const imageKey = 'comfy_local_image';
  run(
    'INSERT OR REPLACE INTO workflow_template (template_key, template_type, display_name, template_body, param_map, params_schema, constraints, enabled, visual_style, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
    [imageKey, 'comfy_workflow', '本地 ComfyUI · 通用静帧（自动适配）', jstr(imageWf), jstr(imageParamMap),
      jstr({ prompt: { type: 'string', required: true }, seed: { type: 'int' } }),
      jstr({ source: baseUrl, checkpoint: ckpt, features, probed_at: nowIso() }), null, nowIso()]
  );

  let videoKey: string | null = null;
  if (features.svd) {
    videoKey = 'comfy_local_video';
    const svdCkpt = svdCkpts[0] ?? 'svd_xt.safetensors';
    run(
      'INSERT OR REPLACE INTO workflow_template (template_key, template_type, display_name, template_body, param_map, params_schema, constraints, enabled, visual_style, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
      [videoKey, 'comfy_workflow', '本地 ComfyUI · SVD 首帧驱动视频（自动适配）', jstr(buildSvdWorkflow(ckpt, svdCkpt)), jstr({
        seed: { node: '5', field: 'inputs.seed' },
        first_frame_image: { node: '2', field: 'inputs.image' },
        video_frames: { node: '3', field: 'inputs.video_frames' },
        motion_bucket_id: { node: '3', field: 'inputs.motion_bucket_id' }
      }), jstr({ first_frame_image: { type: 'string', required: true } }),
      jstr({ source: baseUrl, svd_checkpoint: svdCkpt, max_frames: 25, probed_at: nowIso() }), null, nowIso()]
    );
  }

  // 探测成功说明 ComfyUI 可用：自动切到真实直连模式（不再出代理片）
  setSetting(SETTING_KEYS.comfySimulate, 'false');

  if (videoKey) {
    // 只有探测到视频节点才把它设为默认：否则整条 comfy_h3 链路会产出静帧
    setSetting(SETTING_KEYS.comfyTemplate, videoKey);
  }

  let nodeKey: string | null = null;
  if (input?.register !== false) {
    nodeKey = 'gpu-local';
    const existing = get('SELECT * FROM agent_node WHERE node_key = ?', [nodeKey]);
    const tags = ['h3', ...(features.ipadapter ? ['ipadapter'] : []), ...(features.svd ? ['lipsync'] : [])];
    if (existing) {
      run('UPDATE agent_node SET base_url = ?, engine_tags = ?, status = ?, last_heartbeat = ? WHERE node_key = ?', [
        baseUrl, jstr(tags), 'online', nowIso(), nodeKey
      ]);
    } else {
      run('INSERT INTO agent_node (node_key, base_url, engine_tags, vram_total_gb, vram_free_gb, queue_len, status, models_loaded, last_heartbeat, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
        nodeKey, baseUrl, jstr(tags), 24, 20, 0, 'online', jstr(checkpoints.slice(0, 5)), nowIso(), nowIso()
      ]);
    }
  }

  logger.info('ComfyUI 探测完成', { service: 'comfy', base_url: baseUrl, checkpoints: checkpoints.length, ipadapter: features.ipadapter, svd: features.svd });
  return {
    reachable: true,
    base_url: baseUrl,
    checkpoints,
    samplers,
    vaes,
    ipadapter_files: ipFiles,
    features,
    registered: { image_template: imageKey, video_template: videoKey, node_key: nodeKey },
    notes
  };
}

/** 直接向本地 ComfyUI 提交一次轻量试跑，返回 prompt_id（不经过任务队列，用于验证模板可用） */
export async function comfyTestRun(baseUrl: string, workflow: Record<string, unknown>): Promise<{ prompt_id: string }> {
  const res = await fetch(baseUrl.replace(/\/$/, '') + '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: 'aurum-probe' })
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError('NODE_ERROR', 'ComfyUI 拒绝执行：HTTP ' + res.status + ' ' + text.slice(0, 300));
  const parsed = JSON.parse(text) as { prompt_id?: string };
  if (!parsed.prompt_id) throw new ApiError('NODE_ERROR', 'ComfyUI 未返回 prompt_id');
  return { prompt_id: parsed.prompt_id };
}

export function comfyTemplate(key: string): { body: Record<string, unknown>; param_map: Record<string, unknown> } | null {
  const row = get('SELECT * FROM workflow_template WHERE template_key = ?', [key]);
  if (!row) return null;
  return { body: json<Record<string, unknown>>(row.template_body, {}), param_map: json<Record<string, unknown>>(row.param_map, {}) };
}
