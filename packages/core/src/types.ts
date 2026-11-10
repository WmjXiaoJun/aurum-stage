import type {
  Camera, RenderEngine, SegmentType, ShotStatus, TaskStatus, TaskType, TimelineTrack,
  VarietyType
} from './constants.js';
import type { VisualStyleId } from './styles.js';

export interface Project {
  id: number;
  name: string;
  variety_type: VarietyType;
  aspect_ratio: string;
  fps: number;
  style_prompt: string | null;
  style_negative: string | null;
  privacy_mode: boolean;
  visual_style: VisualStyleId;
  style_ref_asset_id: number | null;
  global_config: Record<string, unknown>;
  owner_user_id: number;
  status: 'draft' | 'parsing' | 'producing' | 'composed' | 'archived';
  segment_cap_sec: number;
  created_at: string;
  updated_at: string;
}

export interface ParseWarningItem {
  level: 'warn' | 'error';
  code: string;
  message: string;
  line?: number;
  segment?: string;
}

export interface ParseReport {
  segments: number;
  shots: number;
  estimate_ms: number;
  used_llm: boolean;
  source: 'markdown' | 'embedded_json' | 'llm';
  warnings: ParseWarningItem[];
  errors: ParseWarningItem[];
}

export interface ScriptDoc {
  id: number;
  project_id: number;
  raw_md: string;
  structured_json: StructuredScript | Record<string, never>;
  parse_status: 'pending' | 'parsing' | 'parsed' | 'failed';
  parse_report: ParseReport | null;
  version: number;
  created_at: string;
}

export interface StructuredScript {
  project_id: number;
  variety_type: VarietyType;
  visual_style: VisualStyleId;
  global: {
    title: string;
    aspect_ratio: string;
    fps: number;
    style_prompt: string;
    style_negative: string;
    subtitle_style_id: string;
    bgm_id: string;
  };
  segments: ScriptSegment[];
}

export interface ScriptSegment {
  segment_id: string;
  segment_type: SegmentType;
  title: string;
  default_engine: RenderEngine;
  visual_style?: VisualStyleId;
  rounds: ScriptRound[];
}

export interface ScriptRound {
  round_id: string;
  speaker_role_id: string | null;
  speaker_name?: string | null;
  camera: Camera;
  lines: string[];
  emotion: string | null;
  emotion_instruction?: string | null;
  performance_tags?: PerformanceTag[];
  visual_style?: VisualStyleId;
  visual_prompt: string;
  overlays: Overlay[];
  engine_params: Record<string, unknown>;
  tts?: TTSSpecLite | null;
  lipsync_required?: boolean;
  privacy?: boolean;
  target_duration_ms?: number | null;
}

export interface Overlay {
  type: 'title_card' | 'name_tag' | 'flower' | 'subtitle';
  text: string;
  in?: number;
  out?: number;
  style?: string;
  position?: string;
}

export interface TTSSpecLite {
  engine?: string;
  voice_id?: string;
  speed?: number;
}

export interface PerformanceTag {
  type: 'tag' | 'text' | 'emotion_extra';
  tag?: string;
  value?: string | number | boolean;
  text?: string;
}

export interface ParsedLine {
  text_raw: string;
  segments: PerformanceTag[];
  clean_text: string;
  emotion_instruction_extra: string;
  tags: PerformanceTag[];
  warnings: string[];
}

export interface Segment {
  id: number;
  project_id: number;
  seq: number;
  segment_type: SegmentType;
  title: string;
  default_engine: RenderEngine;
  visual_style: VisualStyleId | null;
  duration_ms: number;
  created_at: string;
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
  performance_tags: PerformanceTag[];
  visual_prompt: string | null;
  negative_prompt: string | null;
  overlays: Overlay[];
  render_engine: RenderEngine;
  visual_style: VisualStyleId;
  engine_params: Record<string, unknown>;
  template_id: string | null;
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
  candidates: ShotCandidate[];
  created_at: string;
  updated_at: string;
}

export interface ShotCandidate {
  id: number;
  shot_id: number;
  kind: 'tts' | 'video' | 'lipsync';
  idx: number;
  asset_id: number | null;
  duration_ms: number | null;
  state: 'pending' | 'ready' | 'failed' | 'selected';
  meta: Record<string, unknown>;
}

export interface CharacterAsset {
  id: number;
  project_id: number;
  role_id: string;
  version: number;
  name: string;
  role_type: 'host' | 'guest' | 'narrator' | 'virtual' | 'judge';
  persona: string | null;
  prompt_prefix: string | null;
  negative_extra: string | null;
  lock_seed: boolean;
  seed: number | null;
  is_active: boolean;
  authorization_file_hash: string | null;
  authorized_until: string | null;
  voice?: VoiceAsset | null;
  ref_images?: CharacterRefImage[];
  created_at: string;
}

export interface CharacterRefImage {
  id: number;
  character_id: number;
  asset_id: number;
  angle: 'front' | 'smile' | 'profile' | 'full' | 'expression';
  weight: number;
  url?: string | null;
}

export interface VoiceAsset {
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
  ref_audios?: VoiceRefAudio[];
  char_name?: string | null;
  created_at: string;
}

export interface VoiceRefAudio {
  id: number;
  voice_id: number;
  asset_id: number;
  ref_type: 'normal' | 'emotional_peak' | 'angry' | 'laugh';
  duration_sec: number | null;
  note: string | null;
  url?: string | null;
}

export interface WorkflowTemplate {
  id: number;
  template_key: string;
  template_type: 'muse_api' | 'comfy_workflow' | 'tts_preset';
  display_name: string;
  template_body: Record<string, unknown>;
  param_map: Record<string, unknown>;
  params_schema: Record<string, unknown>;
  constraints: Record<string, unknown>;
  enabled: boolean;
  visual_style: VisualStyleId | null;
  created_at: string;
}

export interface RenderTask {
  id: number;
  project_id: number;
  shot_id: number | null;
  segment_id: number | null;
  task_type: TaskType;
  engine: string;
  engine_params: Record<string, unknown>;
  idempotency_key: string;
  status: TaskStatus;
  priority: number;
  node_id: number | null;
  external_task_id: string | null;
  attempt: number;
  max_attempt: number;
  depends_on: number[];
  progress: number;
  error_code: string | null;
  error_msg: string | null;
  result_asset_id: number | null;
  meta: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface Asset {
  id: number;
  project_id: number;
  asset_type: 'image' | 'video' | 'audio' | 'subtitle' | 'text';
  source: 'muse' | 'comfy_h3' | 'tts' | 'lipsync' | 'upload' | 'compose' | 'system';
  bucket: string;
  object_key: string;
  nfs_path: string | null;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  meta: Record<string, unknown>;
  created_at: string;
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
