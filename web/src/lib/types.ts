/** 与后端 DTO 对齐的前端类型（字段命名保持 snake_case，避免两套命名漂移） */
export type Engine = 'muse_api' | 'comfy_h3';
export type VisualStyleId = 'photoreal' | 'anime_2d' | 'cgi_3d' | 'comic';
export type Camera = 'wide' | 'medium_shot' | 'medium_close_up' | 'close_up' | 'extreme_close_up' | 'over_shoulder' | 'empty_shot' | 'pov' | 'two_shot';
export type SegmentType = 'opening_flash' | 'talk_round' | 'game_round' | 'skit' | 'transition' | 'ending';
export type ShotStatus = 'empty' | 'queued' | 'rendering' | 'generated' | 'reviewed' | 'locked';
export type TaskType = 'tts' | 'muse_api' | 'comfy_h3' | 'lipsync' | 'compose';
export type TaskStatus = 'pending' | 'assigned' | 'running' | 'success' | 'failed' | 'timeout' | 'canceled' | 'blocked';
export type TimelineTrack = 'video' | 'subtitle' | 'flower' | 'audio_voice' | 'audio_bgm' | 'audio_sfx';

export interface Project {
  id: number;
  name: string;
  variety_type: 'talk_show' | 'standup' | 'challenge' | 'skit';
  aspect_ratio: string;
  fps: number;
  style_prompt: string | null;
  style_negative: string | null;
  privacy_mode: boolean;
  visual_style: VisualStyleId;
  style_ref_asset_id: number | null;
  status: string;
  segment_cap_sec: number;
  created_at: string;
  updated_at: string;
  segment_count?: number;
  shot_count?: number;
  duration_ms?: number;
}

export interface Segment {
  id: number;
  project_id: number;
  seq: number;
  segment_type: SegmentType;
  title: string;
  default_engine: Engine;
  visual_style: VisualStyleId | null;
  duration_ms: number;
}

export interface Overlay { type: 'title_card' | 'name_tag' | 'flower' | 'subtitle'; text: string; in?: number; out?: number }

export interface Candidate {
  id: number;
  shot_id: number;
  kind: 'tts' | 'video' | 'lipsync';
  idx: number;
  asset_id: number | null;
  duration_ms: number | null;
  state: string;
  meta: Record<string, unknown>;
}

export interface Shot {
  id: number;
  project_id: number;
  segment_id: number;
  segment_seq?: number;
  segment_title?: string;
  seq: number;
  shot_code: string;
  speaker_role_id: string | null;
  speaker_name: string | null;
  camera: Camera;
  lines: string[];
  text_clean: string | null;
  emotion: string | null;
  emotion_instruction: string | null;
  performance_tags: Array<{ type: string; tag?: string; value?: unknown; text?: string }>;
  visual_prompt: string | null;
  negative_prompt: string | null;
  overlays: Overlay[];
  render_engine: Engine;
  visual_style: VisualStyleId;
  engine_params: Record<string, unknown>;
  tts_engine: string | null;
  voice_id: string | null;
  tts_speed: number;
  tts_duration_ms: number | null;
  tts_asset_id: number | null;
  lipsync_required: boolean;
  lipsync_asset_id: number | null;
  native_audio: boolean;
  privacy: boolean;
  manual_edited: boolean;
  status: ShotStatus;
  duration_ms: number;
  preview_asset_id: number | null;
  locked: boolean;
  error_code: string | null;
  candidates: Candidate[];
}

export interface Compliance {
  segment_id: number;
  seq: number;
  title: string;
  duration_ms: number;
  duration_sec: number;
  cap_sec: number;
  remaining_sec: number;
  near_cap: boolean;
  exceed: boolean;
  exceed_sec: number;
  shots: number;
  split_suggestion: string | null;
  status: 'ok' | 'near' | 'exceed';
}

export interface Task {
  id: number;
  project_id: number;
  shot_id: number | null;
  segment_id: number | null;
  task_type: TaskType;
  engine: string;
  status: TaskStatus;
  priority: number;
  progress: number;
  attempt: number;
  max_attempt: number;
  depends_on: number[];
  error_code: string | null;
  error_msg: string | null;
  result_asset_id: number | null;
  meta: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Asset {
  id: number;
  project_id: number;
  asset_type: 'image' | 'video' | 'audio' | 'subtitle' | 'text';
  source: string;
  object_key: string;
  duration_sec: number | null;
  meta: Record<string, unknown>;
  url?: string;
}

export interface TimelineItem {
  id: number;
  project_id: number;
  shot_id: number | null;
  track: TimelineTrack;
  start_ms: number;
  end_ms: number;
  asset_id: number | null;
  payload: Record<string, unknown>;
  locked: boolean;
}

export interface Character {
  id: number;
  project_id: number;
  role_id: string;
  version: number;
  name: string;
  role_type: 'host' | 'guest' | 'narrator' | 'virtual' | 'judge';
  persona: string | null;
  prompt_prefix: string | null;
  lock_seed: boolean;
  seed: number | null;
  is_active: boolean;
  anchor_prompt?: string | null;
  authorization_file_hash: string | null;
  authorized_until: string | null;
  ref_images: Array<{ id: number; asset_id: number; angle: string; weight: number; url?: string }>;
  voice: Voice | null;
}

export interface Voice {
  id: number;
  project_id: number;
  voice_id: string;
  role_id: string | null;
  provider: string;
  base_speed: number;
  available_emotions: string[];
  forbidden: string | null;
  is_active: boolean;
  authorization_file_hash: string | null;
  authorized_until: string | null;
  ref_audios: Array<{ id: number; asset_id: number; ref_type: string; duration_sec: number | null; note: string | null; url?: string }>;
}

export interface Template {
  id: number;
  template_key: string;
  template_type: 'muse_api' | 'comfy_workflow' | 'tts_preset' | 'variety_show' | 'engineering_template';
  display_name: string;
  template_body: Record<string, unknown>;
  param_map: Record<string, unknown>;
  params_schema: Record<string, unknown>;
  constraints: Record<string, unknown>;
  enabled: boolean;
  visual_style: VisualStyleId | null;
}

export interface Issue {
  id: number;
  project_id: number;
  run_id: number | null;
  shot_id: number | null;
  level: 'warn' | 'error';
  code: string;
  message: string;
  suggestion: string | null;
  resolved: number;
  created_at: string;
}

export interface AgentStage {
  id: number;
  run_id: number;
  stage: string;
  agent: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  summary: string | null;
  payload: Record<string, unknown>;
}

export interface AgentRun {
  id: number;
  project_id: number;
  goal: string;
  source_kind: string;
  source_text: string;
  variety_type: string;
  visual_style: VisualStyleId;
  target_sec: number;
  stage: string;
  status: string;
  outputs: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  stages: AgentStage[];
  created_at: string;
}

export interface Overview {
  project: Project;
  segments: Segment[];
  shots: Shot[];
  compliance: Compliance[];
  stats: {
    segments: number;
    shots: number;
    duration_ms: number;
    near_cap: number;
    exceed: number;
    locked: number;
    generated: number;
    tasks: Record<string, unknown>;
  };
  issues: Issue[];
  exports: Array<Record<string, unknown>>;
  script: { id: number; version: number; parse_status: string } | null;
  runtime: { ffmpeg: boolean; segment_cap_sec: number };
}

export interface Meta {
  product: { name: string; name_cn: string; tagline: string; version: string; design: string };
  constants: {
    segment_cap_sec: number;
    segment_near_sec: number;
    variety_types: Array<{ id: string; label: string }>;
    engines: Array<{ id: Engine; label: string; icon: 'cloud' | 'monitor'; tone: 'gold' | 'jade'; channel: string }>;
    cameras: Array<{ id: Camera; label: string }>;
    segment_types: Array<{ id: SegmentType; label: string }>;
    shot_statuses: Array<{ id: ShotStatus; label: string }>;
    task_types: Array<{ id: TaskType; label: string }>;
    timeline_tracks: Array<{ id: TimelineTrack; label: string }>;
    visual_styles: string[];
  };
  styles: Array<{
    id: VisualStyleId;
    label: string;
    short: string;
    description: string;
    prefix: string;
    negative: string;
    muse_model: string;
    comfy_template_key: string;
    supports_panels: boolean;
    accent: string;
    fit: string[];
    ref_analysis_prompt: string;
  }>;
  emotions: Array<{ id: string; label: string; hint: string; instruction: string; speed: number; tone: string; refType: string }>;
  error_codes: Array<{ code: string; name: string; retry: string; maxAttempt: number; httpStatus: number; blocking: boolean; uiHint: string }>;
  tag_cheatsheet: Array<{ write: string; alias: string; result: string }>;
  abstract_to_performable: Array<{ bad: string; good: string }>;
  runtime: Record<string, unknown>;
  accounts: Record<string, unknown>;
  providers?: {
    muse: { base_url: string; model: string; resolution: string; api_key_set: boolean; api_key_masked: string; submit_path: string; task_path: string };
    comfy: { base_url: string };
    text: Array<{ key: string; name: string; enabled: boolean; is_default: boolean; models: string[] }>;
  };
}

export interface MuseProviderInfo {
  base_url: string;
  submit_path: string;
  task_path: string;
  model: string;
  resolution: string;
  api_key_set: boolean;
  api_key_masked: string;
  simulate_fallback: boolean;
  models: string[];
  accounts: Array<{ id: number; name: string; quota_used: number; quota_limit: number | null; enabled: boolean; cooldown_until: string | null }>;
}

export interface ComfyProbeReport {
  reachable: boolean;
  base_url: string;
  checkpoints: string[];
  samplers: string[];
  vaes: string[];
  ipadapter_files: string[];
  features: { ipadapter: boolean; svd: boolean; wan: boolean; hunyuan: boolean; video_combine: boolean };
  registered: { image_template: string | null; video_template: string | null; node_key: string | null };
  notes: string[];
}

export interface LlmProvider {
  id: number;
  provider_key: string;
  display_name: string;
  protocol: string;
  base_url: string;
  api_keys: string[];
  enabled: boolean;
  is_default: boolean;
  health: string;
  last_check: string | null;
  meta: Record<string, unknown>;
  models: Array<{ model_id: string; display_name: string; capabilities: string[]; context_len?: number }>;
}
