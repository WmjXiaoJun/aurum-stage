/**
 * 玄枢・AURUM · 全局业务常量
 * 所有硬约束集中在此，前后端共用，禁止在组件/路由里硬编码。
 */

/** 单段成片硬上限：5 分钟（v1.4.0 硬约束，不可配置） */
export const SEGMENT_CAP_MS = 300_000;
export const SEGMENT_CAP_SEC = 300;
/** 接近上限预警线（93.3%），UI 进入「接近上限」态 */
export const SEGMENT_NEAR_MS = 280_000;
export const SEGMENT_NEAR_SEC = 280;

/** 单镜头时长警告区间（仅警告，不阻断） */
export const SHOT_DURATION_WARN_MIN_MS = 2_000;
export const SHOT_DURATION_WARN_MAX_MS = 8_000;
/** H3 本地片段时长硬上限 */
export const H3_MAX_DURATION_SEC = 8;
/** TTS 呼吸留白：视频目标时长 = tts 时长 + 0.3s */
export const BREATH_MS = 300;
/** 镜头间呼吸留白（时间轴/段时长计算共用） */
export const SHOT_GAP_MS = 200;

export const VARIETY_TYPES = ['talk_show', 'standup', 'challenge', 'skit'] as const;
export type VarietyType = (typeof VARIETY_TYPES)[number];

export const VARIETY_TYPE_LABEL: Record<VarietyType, string> = {
  talk_show: '访谈类',
  standup: '脱口秀类',
  challenge: '闯关类',
  skit: '情景小剧场'
};

export const RENDER_ENGINES = ['muse_api', 'comfy_h3'] as const;
export type RenderEngine = (typeof RENDER_ENGINES)[number];

export const ENGINE_META: Record<RenderEngine, { label: string; icon: 'cloud' | 'monitor'; tone: 'gold' | 'jade'; channel: string }> = {
  muse_api: { label: '云端 Muse Video', icon: 'cloud', tone: 'gold', channel: 'cloud' },
  comfy_h3: { label: '本地 ComfyUI · H3', icon: 'monitor', tone: 'jade', channel: 'local' }
};

export const CAMERAS = [
  'wide', 'medium_shot', 'medium_close_up', 'close_up', 'extreme_close_up',
  'over_shoulder', 'empty_shot', 'pov', 'two_shot'
] as const;
export type Camera = (typeof CAMERAS)[number];

export const CAMERA_LABEL: Record<Camera, string> = {
  wide: '全景',
  medium_shot: '中景',
  medium_close_up: '中近景',
  close_up: '特写',
  extreme_close_up: '大特写',
  over_shoulder: '过肩',
  empty_shot: '空镜',
  pov: '主观',
  two_shot: '双人'
};

/** 需要口型对齐的机位（7.5 产品策略） */
export const LIPSYNC_CAMERAS: Camera[] = ['close_up', 'extreme_close_up', 'medium_close_up'];

export const SEGMENT_TYPES = [
  'opening_flash', 'talk_round', 'game_round', 'skit', 'transition', 'ending'
] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export const SEGMENT_TYPE_LABEL: Record<SegmentType, string> = {
  opening_flash: '开场片花',
  talk_round: '访谈环节',
  game_round: '闯关环节',
  skit: '情景小剧场',
  transition: '转场',
  ending: '片尾'
};

export const TASK_TYPES = ['tts', 'muse_api', 'comfy_h3', 'lipsync', 'compose'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  tts: '配音',
  muse_api: '云端渲染',
  comfy_h3: '本地渲染',
  lipsync: '口型对齐',
  compose: '成片合成'
};

export const TASK_STATUSES = [
  'pending', 'assigned', 'running', 'success', 'failed', 'timeout', 'canceled', 'blocked'
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const SHOT_STATUSES = [
  'empty', 'queued', 'rendering', 'generated', 'reviewed', 'locked'
] as const;
export type ShotStatus = (typeof SHOT_STATUSES)[number];

export const SHOT_STATUS_LABEL: Record<ShotStatus, string> = {
  empty: '待生成',
  queued: '排队中',
  rendering: '渲染中',
  generated: '已生成',
  reviewed: '已确认',
  locked: '已锁定'
};

export const TIMELINE_TRACKS = [
  'video', 'subtitle', 'flower', 'audio_voice', 'audio_bgm', 'audio_sfx'
] as const;
export type TimelineTrack = (typeof TIMELINE_TRACKS)[number];

export const TIMELINE_TRACK_LABEL: Record<TimelineTrack, string> = {
  video: '视频',
  subtitle: '字幕',
  flower: '花字',
  audio_voice: '人声',
  audio_bgm: 'BGM',
  audio_sfx: '音效'
};

export const TEMPLATE_TYPES = ['muse_api', 'comfy_workflow', 'tts_preset'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const TASK_PRIORITY: Record<TaskType, number> = {
  tts: 1, compose: 3, lipsync: 4, comfy_h3: 5, muse_api: 5
};

/** 产品标识（UI 与 API 元数据同源） */
export const PRODUCT = {
  name: '玄枢・AURUM',
  name_cn: '玄枢',
  name_en: 'AURUM',
  tagline: 'AI 微综艺智造中枢',
  version: '1.1.0',
  design: '午夜黑金导播大厅'
} as const;

export const DEFAULT_ASPECT = '16:9';
export const DEFAULT_FPS = 25;
/** 全站渲染/合成统一 720 档（v1.2：云端与本地都出 720） */
export const COMPOSE_PRESETS: Record<string, { width: number; height: number; fps: number; crf: number }> = {
  '9:16': { width: 720, height: 1280, fps: 25, crf: 22 },
  '16:9': { width: 1280, height: 720, fps: 25, crf: 22 },
  '1:1': { width: 720, height: 720, fps: 25, crf: 22 },
  '4:5': { width: 720, height: 900, fps: 25, crf: 22 }
};

/** 云端视频统一分辨率档位 */
export const CLOUD_RESOLUTION = '720p';

export const DEFAULT_NEGATIVE = '畸形手指, 扭曲人脸, 多余肢体, 双头, 文字水印, 低分辨率, 画面撕裂';
