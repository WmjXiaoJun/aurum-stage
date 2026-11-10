/** 界面中文化：所有对外可见的标识、引擎、模型、事件都只展示中文，不暴露内部代码/英文标识 */
export const ENGINE_LABEL: Record<string, string> = {
  muse_api: '云端生成',
  comfy_h3: '本地生成',
  muse: '云端生成',
  comfy: '本地生成',
  tts: '配音',
  lipsync: '口型对齐',
  compose: '合成',
  'rule/fallback': '本地规则引擎',
  'rule/voice-map': '本地音色映射',
  'rule/storyboard': '本地分镜规则',
  'rule/qa': '本地质检规则',
  'rule/script': '本地剧本规则'
};

export function engineLabel(engine: string | null | undefined): string {
  if (!engine) return '—';
  const key = String(engine);
  if (ENGINE_LABEL[key]) return ENGINE_LABEL[key];
  if (key.startsWith('deepseek')) return '深度求索 · 通用对话';
  if (key.includes('deepseek-reasoner')) return '深度求索 · 深度推理';
  if (key.startsWith('rule/')) return '本地规则引擎';
  if (key.includes('muse-video')) return '云端视频模型';
  return '模型产出';
}

/** 镜头对外只显示「第 N 段 · 第 M 镜」，不显示内部编号 */
export function shotLabel(segmentSeq: number | undefined | null, seq: number | undefined | null): string {
  const seg = segmentSeq && segmentSeq > 0 ? '第' + segmentSeq + '段' : '未分段';
  const shot = seq && seq > 0 ? '第' + seq + '镜' : '—';
  return seg + ' · ' + shot;
}

export const TASK_TYPE_LABEL: Record<string, string> = {
  tts: '配音',
  muse_api: '云端生成',
  comfy_h3: '本地生成',
  lipsync: '口型对齐',
  compose: '成片合成'
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '排队',
  assigned: '已派发',
  running: '执行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  canceled: '已取消',
  blocked: '已阻断'
};

export function taskTypeLabel(type: string | null | undefined): string {
  return TASK_TYPE_LABEL[String(type ?? '')] ?? '任务';
}

export function taskStatusLabel(status: string | null | undefined): string {
  return TASK_STATUS_LABEL[String(status ?? '')] ?? '未知';
}

export function healthLabel(health: string | null | undefined): string {
  const map: Record<string, string> = { ok: '正常', down: '不可用', degraded: '受限', unknown: '未检测' };
  return map[String(health ?? '')] ?? '未检测';
}

export const TEMPLATE_TYPE_LABEL: Record<string, string> = {
  variety_show: '综艺形态',
  engineering_template: '工程模板',
  comfy_workflow: '本地工作流',
  muse_api: '云端参数',
  tts_preset: '配音预设'
};

export const PROVIDER_LABEL: Record<string, string> = {
  deepseek: '深度求索',
  'local-ollama': '本地离线模型',
  'openai-compat': '兼容网关'
};

export const MODEL_LABEL: Record<string, string> = {
  'deepseek-chat': '通用对话模型',
  'deepseek-reasoner': '深度推理模型',
  'muse-video-ext': '云端视频 · 标准版',
  'MiniMax-H3-Max': '云端视频 · 极速版',
  'MiniMax-H3': '云端视频 · 高清版',
  'seedance-1-5-pro': '云端视频 · 动画版',
  'seedance-2.0': '云端视频 · 三维版',
  VEO3: '云端视频 · 长片版',
  'qwen2.5:14b': '本地通用对话',
  'llava:13b': '本地视觉理解',
  'gpt-4o-mini': '兼容网关通用模型'
};

export function modelLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return MODEL_LABEL[id] ?? '模型 · ' + id.replace(/[a-z\-_.]/gi, '').slice(0, 4) + '号';
}

export const EVENT_LABEL: Record<string, string> = {
  'run.started': '流水线启动',
  'stage.started': '阶段开始',
  'stage.done': '阶段完成',
  'stage.failed': '阶段失败',
  'stage.confirm': '阶段确认',
  'run.applied': '落入项目',
  'task.created': '任务创建',
  'task.progress': '任务进度',
  'task.preview': '产物预览',
  'task.success': '任务成功',
  'task.failed': '任务失败',
  'task.retry': '任务重试',
  'task.assigned': '任务派发',
  'task.canceled': '任务取消',
  'node.offline': '节点离线',
  'compose.progress': '合成进度',
  'compose.success': '合成完成',
  'agent.event': '智能体事件'
};

export function eventLabel(type: string | null | undefined): string {
  if (!type) return '事件';
  return EVENT_LABEL[type] ?? '事件';
}

export function engineName(provider: string | null | undefined): string {
  const map: Record<string, string> = {
    indextts2: '本地主力配音引擎',
    cosyvoice3: '本地备用配音引擎',
    fishspeech: '标签化配音引擎',
    drama3: '云端配音引擎'
  };
  return map[String(provider ?? '')] ?? '本地配音引擎';
}

export function nodeName(key: string): string {
  const map: Record<string, string> = { 'gpu-a': '节点甲', 'gpu-tts': '配音节点', 'gpu-local': '本地渲染节点' };
  return map[key] ?? '本地节点';
}

export function tagName(tag: string): string {
  const map: Record<string, string> = { h3: '本地生成', lipsync: '口型对齐', tts: '配音', ipadapter: '角色锚定', comfy: '本地渲染' };
  return map[tag] ?? '本地能力';
}

export const REF_TYPE_LABEL: Record<string, string> = {
  normal: '常规语气',
  emotional_peak: '情绪峰值',
  angry: '生气',
  laugh: '笑声'
};

export const ROLE_TYPE_LABEL: Record<string, string> = {
  host: '主持人',
  guest: '嘉宾',
  narrator: '旁白',
  virtual: '虚拟人',
  judge: '评委'
};

export const ANGLE_LABEL: Record<string, string> = {
  front: '正脸',
  smile: '微笑',
  profile: '侧脸',
  full: '全身',
  expression: '表情'
};

export function aspectLabel(ratio: string | null | undefined, fps: number | null | undefined): string {
  const name: Record<string, string> = { '9:16': '竖屏', '16:9': '横屏', '1:1': '方形', '4:5': '社媒竖版' };
  return (name[ratio ?? ''] ?? '画幅') + ' ' + (ratio ?? '') + (fps ? ' · ' + fps + ' 帧' : '');
}

export const ERROR_LABEL: Record<string, string> = {
  PARAM_INVALID: '参数不完整',
  REF_MISSING: '参考素材缺失',
  IDEMPOTENT_REPLAY: '重复提交（已复用任务）',
  NOT_FOUND: '对象不存在',
  PRIVACY_BLOCK: '涉敏镜头需本地生成',
  QUOTA_EXHAUSTED: '云端额度不足',
  RATE_LIMITED: '云端限流排队中',
  CLOUD_TIMEOUT: '云端超时',
  OOM: '显存不足',
  NODE_ERROR: '本地节点报错',
  MODEL_MISSING: '模型文件缺失',
  NODE_OFFLINE: '节点离线',
  TTS_TEXT_INVALID: '台词无法发音',
  TTS_REF_POOR: '参考音频质量不足',
  TTS_VOICE_CLONE_FAIL: '音色克隆失败',
  LIPSYNC_NO_FACE: '未检测到人脸',
  LIPSYNC_BAD_QUALITY: '口型对齐质量不足',
  COMPOSE_CONCAT_FAIL: '片段拼接失败',
  COMPOSE_SUBTITLE_FAIL: '字幕生成失败',
  COMPOSE_NO_FFMPEG: '缺少合成引擎',
  SEGMENT_DURATION_EXCEED: '本段超过 5 分钟上限',
  SEGMENT_CAP_NEAR: '接近 5 分钟上限',
  SEGMENT_EMPTY: '本段没有可渲染镜头',
  SCRIPT_PARSE_FAIL: '台本解析失败',
  LLM_UNAVAILABLE: '文本模型不可用',
  LLM_SCHEMA_FAIL: '结构化输出校验失败',
  AGENT_STAGE_LOCKED: '阶段未确认',
  FORBIDDEN: '权限不足',
  INTERNAL: '内部错误'
};

export function errorLabel(code: string | null | undefined): string {
  if (!code) return '';
  return ERROR_LABEL[code] ?? '处理失败';
}

/** 内部编号一律转成中文短标签（用于模板/配置回显） */
export function styleName(id: string | null | undefined): string {
  const map: Record<string, string> = { photoreal: '写实真人', anime_2d: '二维动画', cgi_3d: '三维动画', comic: '漫画漫剧' };
  return map[String(id ?? '')] ?? '默认风格';
}

export function retryLabel(policy: string | null | undefined): string {
  const map: Record<string, string> = {
    none: '不自动重试',
    reassign: '换通道重试',
    cooling: '冷却后重试',
    'cloud-retry': '自动重试',
    'degrade-once': '降级重试一次',
    recover: '回收重排队'
  };
  return map[String(policy ?? '')] ?? '按策略处理';
}

export function describeConstraints(constraints: Record<string, unknown> | null | undefined): string {
  const c = (constraints ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (c.max_duration_sec) parts.push('单段不超过 ' + String(c.max_duration_sec) + ' 秒');
  if (c.fps) parts.push('每秒 ' + String(c.fps) + ' 帧');
  if (c.steps) parts.push(String(c.steps) + ' 步采样');
  if (c.size) parts.push('输出尺寸 ' + String(c.size));
  if (c.model) parts.push('使用本机模型');
  return parts.length ? parts.join(' · ') : '无额外约束';
}

/** 后端文案里的技术名词统一换成中文（用于警告与错误摘要） */
export function humanizeTech(text: string): string {
  return String(text)
    .replace(/FFmpeg/g, '合成引擎')
    .replace(/ASS/g, '花字字幕')
    .replace(/SRT/g, '字幕')
    .replace(/MP4/g, '视频')
    .replace(/WebSocket/g, '实时通道')
    .replace(/ComfyUI/g, '本地渲染服务')
    .replace(/APIMart/g, '云端视频服务')
    .replace(/IndexTTS-2/g, '本地配音引擎')
    .replace(/GPU/g, '显卡')
    .replace(/BGM/g, '配乐');
}

export function templateLabel(key: string | null | undefined, displayName?: string | null): string {
  if (displayName) return displayName;
  if (!key) return '—';
  const map: Record<string, string> = {
    h3_local_native: '本地原生音视频工作流',
    comfy_local_image: '本地通用静帧工作流',
    comfy_local_video: '本地首帧驱动视频工作流',
    h3_talk_closeup: '访谈近景工作流',
    sd_anime_2d: '二维动画工作流',
    cgi_3d_render: '三维渲染工作流',
    comic_panel_lineart: '漫画线稿工作流',
    tts_talk_variety: '访谈配音预设',
    tts_standup_punch: '脱口秀配音预设',
    tts_emotional: '情感落点配音预设'
  };
  if (map[key]) return map[key];
  if (key.startsWith('muse_')) return '云端参数模板 · ' + key.replace('muse_', '');
  return '工作流模板';
}
