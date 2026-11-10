/** 首次启动的数据播种：一份可跑通的样例项目 + 三类模板 + GPU 节点 + 云端账号池。 */
import fs from 'node:fs';
import path from 'node:path';
import { STYLE_PRESETS, VISUAL_STYLES } from '@aurum/core';
import { config } from '../config.js';
import { all, get, json, jstr, nowIso, run } from './index.js';
import { logger } from '../logger.js';
import { createProject } from '../domain/project-service.js';
import { parseScriptDoc, saveScript } from '../domain/script-service.js';
import { assetKey, createAsset, objectPath } from '../adapters/storage.js';

const DEMO_SCRIPT = `# AI 圆桌派 第 1 期：AI 到底能不能替你做综艺

## 开场片花
【空镜】赛博霓虹城市夜景推镜，字幕光斑扫过，节奏由慢到快
【花字】这一期，我们聊点真话

## 第一轮 · AI 到底省了什么
【主持人·阿哲】欢迎来到 AI 圆桌派，今天我们只聊一件事：AI 到底能不能替你做综艺。
【嘉宾·林小满】我先说结论，能替掉的是体力活，替不掉的是判断。
【主持人·阿哲】（笑）这句话可以作为本期标题了。
【嘉宾·徐不器】（唱反调）我不同意，我觉得连判断都能替，只是你现在还没用对。
【主持人·阿哲】那你给我一个具体的例子，别讲方法论。

## 第二轮 · 追问：具体到一次翻车
【嘉宾·徐不器】上周我们把一整期的分镜交给模型，出来的东西工整，但一个笑点都没有。
【主持人·阿哲】（停顿半秒）这个我信，工整恰恰是最不像综艺的地方。
【嘉宾·林小满】对，综艺的笑点是靠人跟人之间的意外，不是靠排列组合。
【主持人·阿哲】（压低声音）所以真正的门槛，是谁能定义"意外"。
（笑）这句话有点绕，但确实是这样。

## 第三轮 · 现场挑战
【主持人·阿哲】好，现场挑战：给三个关键词，三十秒内出一个包袱。
【嘉宾·林小满】（加快）AI、加班、血压。
【嘉宾·徐不器】（大笑）这个不用想，AI 加班，我的血压。
【主持人·阿哲】（笑着说）过，这条能上。

## 收尾
【主持人·阿哲】总结一句话：AI 负责把活干完，人负责决定什么值得干。
【嘉宾·林小满】下期我们聊怎么用三百秒讲完一个故事。
【花字】下期见
`;

const JUNK_SCRIPT = `# 小剧场 · 深夜的第四次重录

## 情景开场
【空镜】凌晨两点的剪辑室，屏幕蓝光打在脸上
【主持人·阿哲】第四次重录，我们已经不知道该改哪了。

## 对话
【嘉宾·林小满】要不我们别改了，先看一遍。
【主持人·阿哲】（叹气）也行，反正天快亮了。
`;

function seedTemplates(): void {
  const existing = get('SELECT COUNT(*) AS n FROM workflow_template');
  if (Number(existing?.n ?? 0) > 0) return;

  for (const styleId of VISUAL_STYLES) {
    const preset = STYLE_PRESETS[styleId];
    run(
      'INSERT OR REPLACE INTO workflow_template (template_key, template_type, display_name, template_body, param_map, params_schema, constraints, enabled, visual_style, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
      [
        preset.comfy_template_key,
        'comfy_workflow',
        preset.label + ' · 镜头工作流',
        jstr({
          '3': { class_type: 'KSampler', inputs: { seed: 20261107, steps: 28, cfg: 6.5, sampler_name: 'euler', scheduler: 'normal', model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
          '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl_base.safetensors' } },
          '5': { class_type: 'EmptyLatentImage', inputs: { width: 1080, height: 1920, batch_size: 1 } },
          '6': { class_type: 'CLIPTextEncode', inputs: { text: 'PASTE_PROMPT', clip: ['4', 1] } },
          '7': { class_type: 'CLIPTextEncode', inputs: { text: 'PASTE_NEGATIVE', clip: ['4', 1] } },
          '10': { class_type: 'LoadImage', inputs: { image: 'PASTE_REF_FILENAME' } },
          '11': { class_type: 'IPAdapterApply', inputs: { ipadapter: ['12', 0], image: ['10', 0], model: ['4', 0], weight: 0.75, weight_type: 'linear' } },
          '12': { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: 'ip-adapter_sdxl.safetensors' } },
          '18': { class_type: 'MinimaxH3Video', inputs: { image: ['3', 0], prompt: 'PASTE_PROMPT', motion_bucket_id: 42, fps: 25, video_length: 120, seed: 20261107 } },
          '19': { class_type: 'SaveVideo', inputs: { video: ['18', 0], filename_prefix: 'h3_shot' } }
        }),
        jstr({
          prompt: { node: '6', field: 'inputs.text' },
          negative_prompt: { node: '7', field: 'inputs.text' },
          seed: { node: '3', field: 'inputs.seed' },
          fps: { node: '18', field: 'inputs.fps' },
          ref_image: { node: '10', field: 'inputs.image' },
          motion_bucket_id: { node: '18', field: 'inputs.motion_bucket_id' }
        }),
        jstr({ prompt: { type: 'string', required: true }, seed: { type: 'int' } }),
        jstr({ max_duration_sec: 8, concurrency_per_node: 1 }),
        styleId,
        nowIso()
      ]
    );

    run(
      'INSERT OR REPLACE INTO workflow_template (template_key, template_type, display_name, template_body, param_map, params_schema, constraints, enabled, visual_style, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
      [
        'muse_' + styleId,
        'muse_api',
        preset.label + ' · 云端参数模板',
        jstr({ model: preset.muse_model, ...(preset.engine_params.muse_api ?? {}), watermark: false, duration_ms: 5000 }),
        jstr({ prompt: { field: 'prompt' }, duration_ms: { field: 'duration_ms' }, seed: { field: 'seed' }, model: { field: 'model' } }),
        jstr({ prompt: { type: 'string' }, duration_ms: { type: 'int', max: 8000 } }),
        jstr({ max_duration_sec: 8, qps: 2, requires_account_pool: true }),
        styleId,
        nowIso()
      ]
    );
  }

  const ttsPresets = [
    { key: 'tts_talk_variety', name: '访谈综艺 · 标准情绪组', emotions: ['friendly_smile', 'thoughtful', 'surprised', 'serious'], speed: 1.0, forbidden: '沙哑, 哭腔' },
    { key: 'tts_standup_punch', name: '脱口秀 · 包袱加强', emotions: ['teasing', 'laugh_out_loud', 'deadpan', 'surprised'], speed: 1.08, forbidden: '拖沓, 播音腔' },
    { key: 'tts_emotional', name: '情感落点 · 低速低音', emotions: ['moved', 'warm_gentle', 'thoughtful'], speed: 0.9, forbidden: '高音, 快语速' }
  ];
  for (const p of ttsPresets) {
    run(
      'INSERT OR REPLACE INTO workflow_template (template_key, template_type, display_name, template_body, param_map, params_schema, constraints, enabled, visual_style, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
      [
        p.key,
        'tts_preset',
        p.name,
        jstr({ engine: 'indextts2', emotions: p.emotions, base_speed: p.speed, forbidden: p.forbidden, max_candidates: 3 }),
        jstr({ emotions: { field: 'emotions' }, speed: { field: 'base_speed' } }),
        jstr({ base_speed: { type: 'number', min: 0.6, max: 1.6 } }),
        jstr({ target_duration_ms: { min: 800 } }),
        null,
        nowIso()
      ]
    );
  }
}

function seedNodes(): void {
  const existing = get('SELECT COUNT(*) AS n FROM agent_node');
  if (Number(existing?.n ?? 0) > 0) return;
  run('INSERT INTO agent_node (node_key, base_url, engine_tags, vram_total_gb, vram_free_gb, queue_len, status, models_loaded, last_heartbeat, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
    'gpu-a', 'http://192.168.1.21:8188', jstr(['h3', 'lipsync']), 24, 17.5, 0, 'online',
    jstr(['minimax_h3', 'ipadapter_sdxl', 'musetalk']), nowIso(), nowIso()
  ]);
  run('INSERT INTO agent_node (node_key, base_url, engine_tags, vram_total_gb, vram_free_gb, queue_len, status, models_loaded, last_heartbeat, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
    'gpu-tts', 'http://192.168.1.22:9001', jstr(['tts']), 16, 12.0, 0, 'online',
    jstr(['indextts2', 'cosyvoice3']), nowIso(), nowIso()
  ]);
}

/** 老库升级：保证 DeepSeek 为唯一默认供应商、按有没有 Key 决定是否启用；保证 APIMart 账号存在 */
function ensureProviderDefaults(): void {
  const ds = get('SELECT * FROM llm_provider WHERE provider_key = ?', ['deepseek']);
  if (!ds) return;
  const keys = json<string[]>(ds.api_keys, []);
  run('UPDATE llm_provider SET enabled = ?, is_default = 1 WHERE id = ?', [keys.length > 0 ? 1 : 0, Number(ds.id)]);
  run("UPDATE llm_provider SET is_default = 0 WHERE provider_key <> 'deepseek'");
  const local = get('SELECT * FROM llm_provider WHERE provider_key = ?', ['local-ollama']);
  if (local && json<string[]>(local.api_keys, []).length === 0) {
    run('UPDATE llm_provider SET enabled = 0 WHERE id = ?', [Number(local.id)]);
  }
  const apimart = get('SELECT id FROM render_account WHERE account_name = ?', ['apimart-primary']);
  if (!apimart) {
    run('INSERT INTO render_account (provider, account_name, secret_ref, quota_used, quota_limit, enabled, created_at) VALUES (?,?,?,?,?,?,?)', [
      'muse', 'apimart-primary', config.muse.apiKey ? 'env:MUSE_API_KEY' : 'unset', 0, 5000, 1, nowIso()
    ]);
  }
}

function seedAccounts(): void {
  const existing = get('SELECT COUNT(*) AS n FROM render_account WHERE provider = ?', ['muse']);
  if (Number(existing?.n ?? 0) > 0) return;
  // APIMart 云端视频账号：Key 存中台设置/环境变量，这里只登记账号与额度
  run('INSERT INTO render_account (provider, account_name, secret_ref, quota_used, quota_limit, enabled, created_at) VALUES (?,?,?,?,?,?,?)', [
    'muse', 'apimart-primary', config.muse.apiKey ? 'env:MUSE_API_KEY' : 'unset', 0, 5000, 1, nowIso()
  ]);
  run('INSERT INTO render_account (provider, account_name, secret_ref, quota_used, quota_limit, enabled, created_at) VALUES (?,?,?,?,?,?,?)', ['drama3', 'drama3-cn-01', 'vault://drama3/cn/01', 0, 1000, 1, nowIso()]);
}

interface ProviderSeed {
  key: string;
  name: string;
  protocol: string;
  base: string;
  keys: string[];
  enabled: number;
  isDefault: number;
  note: string;
  models: Array<{ id: string; name: string; caps: string[] }>;
}

function upsertProvider(seed: ProviderSeed): void {
  const existing = get('SELECT * FROM llm_provider WHERE provider_key = ?', [seed.key]);
  if (existing) {
    if (seed.keys.length > 0) {
      run('UPDATE llm_provider SET api_keys = ?, enabled = 1, base_url = ? WHERE id = ?', [jstr(seed.keys), seed.base, Number(existing.id)]);
    }
    return;
  }
  run(
    'INSERT INTO llm_provider (provider_key, display_name, protocol, base_url, api_keys, enabled, is_default, health, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [seed.key, seed.name, seed.protocol, seed.base, jstr(seed.keys), seed.enabled, seed.isDefault, 'unknown', jstr({ note: seed.note }), nowIso()]
  );
  const id = Number(get('SELECT id FROM llm_provider WHERE provider_key = ?', [seed.key])?.id ?? 0);
  if (!id) return;
  for (const model of seed.models) {
    run('INSERT OR IGNORE INTO llm_model (provider_id, model_id, display_name, capabilities, enabled, discovered) VALUES (?,?,?,?,1,1)', [id, model.id, model.name, jstr(model.caps)]);
  }
}

function seedLlm(): void {
  // DeepSeek 作为默认文本后端（Key 从 DEEPSEEK_API_KEY 注入，或在前端「模型设置」里填）
  upsertProvider({
    key: 'deepseek',
    name: 'DeepSeek 深度求索',
    protocol: 'openai',
    base: config.llm.deepseekBase,
    keys: config.llm.deepseekKey ? [config.llm.deepseekKey] : [],
    enabled: 1,
    isDefault: 1,
    note: 'OpenAI 兼容；deepseek-chat 用于台本/分镜结构化，deepseek-reasoner 用于质检与规划',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3 通用对话', caps: ['chat', 'structured', 'tools'] },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1 推理', caps: ['chat', 'structured'] }
    ]
  });
  upsertProvider({
    key: 'local-ollama',
    name: '本地 Ollama（私有化）',
    protocol: 'ollama',
    base: 'http://127.0.0.1:11434/v1',
    keys: [],
    enabled: 0,
    isDefault: 0,
    note: '内网模型不计费；未启动时自动回退规则引擎',
    models: [
      { id: 'qwen2.5:14b', name: 'Qwen2.5 14B（本地）', caps: ['chat', 'structured', 'tools'] },
      { id: 'llava:13b', name: 'LLaVA 13B（本地视觉）', caps: ['chat', 'vision'] }
    ]
  });
  upsertProvider({
    key: 'openai-compat',
    name: 'OpenAI 兼容网关',
    protocol: 'openai',
    base: 'https://api.openai.com/v1',
    keys: [],
    enabled: 0,
    isDefault: 0,
    note: '填入 Key 后启用；支持任何 OpenAI 兼容端点',
    models: [{ id: 'gpt-4o-mini', name: 'GPT-4o mini', caps: ['chat', 'structured', 'vision'] }]
  });
}

function seedStyleRefs(projectId: number): void {
  const existing = get('SELECT style_ref_asset_id FROM project WHERE id = ?', [projectId]);
  if (existing?.style_ref_asset_id) return;
  const sceneMap: Record<string, string> = {
    talk: 'scene-interview.jpg',
    standup: 'scene-standup.jpg',
    game: 'scene-game.jpg',
    skit: 'scene-skit.jpg'
  };
  const webScenes = path.resolve(process.cwd(), '..', '..', 'web', 'public', 'scenes');
  for (const [idx, [key, filename]] of Object.entries(sceneMap).entries()) {
    const src = path.join(webScenes, filename);
    if (!fs.existsSync(src)) continue;
    const content = fs.readFileSync(src);
    const assetKeyStr = assetKey('projects', projectId, 'refs', 'scene', key + '.jpg');
    fs.mkdirSync(path.dirname(objectPath('assets', assetKeyStr)), { recursive: true });
    fs.writeFileSync(objectPath('assets', assetKeyStr), content);
    const asset = createAsset({
      project_id: projectId,
      asset_type: 'image',
      source: 'upload',
      key: assetKeyStr,
      meta: { kind: 'scene_reference', scene: key, index: idx, original_name: filename }
    });
    if (key === 'talk') {
      run('UPDATE project SET style_ref_asset_id = ? WHERE id = ?', [asset.id, projectId]);
    }
  }
}

export async function runSeed(): Promise<void> {
  seedTemplates();
  seedNodes();
  seedAccounts();
  seedLlm();
  ensureProviderDefaults();
  const projectCount = get('SELECT COUNT(*) AS n FROM project');
  if (Number(projectCount?.n ?? 0) > 0) return;

  logger.info('播种样例项目（首次启动）', { service: 'api' });

  const demo = createProject({
    name: 'AI 圆桌派 第 1 期',
    variety_type: 'talk_show',
    visual_style: 'photoreal',
    aspect_ratio: '16:9',
    style_prompt: STYLE_PRESETS.photoreal.prefix,
    style_negative: STYLE_PRESETS.photoreal.negative
  });
  const script = saveScript(demo.id, DEMO_SCRIPT);
  try {
    parseScriptDoc(demo, script.id);
  } catch (err) {
    logger.warn('样例台本解析失败：' + String(err), { service: 'api' });
  }
  run('UPDATE project SET status = ? WHERE id = ?', ['producing', demo.id]);

  const skit = createProject({
    name: '深夜剪辑室 · 小剧场试拍',
    variety_type: 'skit',
    visual_style: 'comic',
    aspect_ratio: '16:9'
  });
  const script2 = saveScript(skit.id, JUNK_SCRIPT);
  try {
    parseScriptDoc(skit, script2.id);
  } catch (err) {
    logger.warn('小剧场台本解析失败：' + String(err), { service: 'api' });
  }

  seedStyleRefs(demo.id);
  seedStyleRefs(skit.id);
  logger.info('样例数据就绪：2 个项目', { service: 'api' });
}
