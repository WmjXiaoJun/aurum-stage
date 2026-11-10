import type {
  Asset, CharacterAsset, CharacterRefImage, RenderTask, ScriptDoc, Segment, Shot, ShotCandidate,
  TimelineItem, VoiceAsset, VoiceRefAudio, WorkflowTemplate, Project
} from '@aurum/core';
import { bool, json } from '../db/index.js';

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

export function mapProject(row: Row): Project {
  return {
    id: num(row.id),
    name: str(row.name),
    variety_type: str(row.variety_type) as Project['variety_type'],
    aspect_ratio: str(row.aspect_ratio),
    fps: num(row.fps),
    style_prompt: strOrNull(row.style_prompt),
    style_negative: strOrNull(row.style_negative),
    privacy_mode: bool(row.privacy_mode),
    visual_style: str(row.visual_style) as Project['visual_style'],
    style_ref_asset_id: numOrNull(row.style_ref_asset_id),
    global_config: json<Record<string, unknown>>(row.global_config, {}),
    owner_user_id: num(row.owner_user_id),
    status: str(row.status) as Project['status'],
    segment_cap_sec: num(row.segment_cap_sec) || 300,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at)
  };
}

export function mapScript(row: Row): ScriptDoc {
  return {
    id: num(row.id),
    project_id: num(row.project_id),
    raw_md: str(row.raw_md),
    structured_json: json<ScriptDoc['structured_json']>(row.structured_json, {} as ScriptDoc['structured_json']),
    parse_status: str(row.parse_status) as ScriptDoc['parse_status'],
    parse_report: json<ScriptDoc['parse_report']>(row.parse_report, null),
    version: num(row.version),
    created_at: str(row.created_at)
  };
}

export function mapSegment(row: Row): Segment {
  return {
    id: num(row.id),
    project_id: num(row.project_id),
    seq: num(row.seq),
    segment_type: str(row.segment_type) as Segment['segment_type'],
    title: str(row.title),
    default_engine: str(row.default_engine) as Segment['default_engine'],
    visual_style: strOrNull(row.visual_style) as Segment['visual_style'],
    duration_ms: num(row.duration_ms),
    created_at: str(row.created_at)
  };
}

export function mapShot(row: Row, candidates: ShotCandidate[] = []): Shot {
  const segmentSeq = row.segment_seq;
  return {
    id: num(row.id),
    project_id: num(row.project_id),
    segment_id: num(row.segment_id),
    segment_seq: segmentSeq == null ? undefined : num(segmentSeq),
    segment_title: row.segment_title == null ? undefined : str(row.segment_title),
    seq: num(row.seq),
    shot_code: str(row.shot_code),
    speaker_role_id: strOrNull(row.speaker_role_id),
    speaker_name: strOrNull(row.speaker_name),
    camera: str(row.camera) as Shot['camera'],
    lines: json<string[]>(row.lines, []),
    text_clean: strOrNull(row.text_clean),
    emotion: strOrNull(row.emotion),
    emotion_instruction: strOrNull(row.emotion_instruction),
    performance_tags: json<Shot['performance_tags']>(row.performance_tags, []),
    visual_prompt: strOrNull(row.visual_prompt),
    negative_prompt: strOrNull(row.negative_prompt),
    overlays: json<Shot['overlays']>(row.overlays, []),
    render_engine: str(row.render_engine) as Shot['render_engine'],
    visual_style: str(row.visual_style) as Shot['visual_style'],
    engine_params: json<Record<string, unknown>>(row.engine_params, {}),
    template_id: strOrNull(row.template_id),
    tts_engine: strOrNull(row.tts_engine),
    voice_id: strOrNull(row.voice_id),
    tts_speed: row.tts_speed == null ? 1 : Number(row.tts_speed),
    tts_duration_ms: numOrNull(row.tts_duration_ms),
    tts_asset_id: numOrNull(row.tts_asset_id),
    lipsync_required: bool(row.lipsync_required),
    lipsync_asset_id: numOrNull(row.lipsync_asset_id),
    native_audio: bool(row.native_audio),
    privacy: bool(row.privacy),
    manual_edited: bool(row.manual_edited),
    status: str(row.status) as Shot['status'],
    duration_ms: num(row.duration_ms),
    preview_asset_id: numOrNull(row.preview_asset_id),
    locked: bool(row.locked),
    error_code: strOrNull(row.error_code),
    candidates,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at)
  };
}

export function mapCandidate(row: Row): ShotCandidate {
  return {
    id: num(row.id),
    shot_id: num(row.shot_id),
    kind: str(row.kind) as ShotCandidate['kind'],
    idx: num(row.idx),
    asset_id: numOrNull(row.asset_id),
    duration_ms: numOrNull(row.duration_ms),
    state: str(row.state) as ShotCandidate['state'],
    meta: json<Record<string, unknown>>(row.meta, {})
  };
}

export function mapCharacter(row: Row): CharacterAsset {
  return {
    id: num(row.id),
    project_id: num(row.project_id),
    role_id: str(row.role_id),
    version: num(row.version),
    name: str(row.name),
    role_type: str(row.role_type) as CharacterAsset['role_type'],
    persona: strOrNull(row.persona),
    prompt_prefix: strOrNull(row.prompt_prefix),
    negative_extra: strOrNull(row.negative_extra),
    lock_seed: bool(row.lock_seed),
    seed: numOrNull(row.seed),
    is_active: bool(row.is_active),
    authorization_file_hash: strOrNull(row.authorization_file_hash),
    authorized_until: strOrNull(row.authorized_until),
    created_at: str(row.created_at)
  };
}

export function mapRefImage(row: Row): CharacterRefImage {
  return {
    id: num(row.id),
    character_id: num(row.character_id),
    asset_id: num(row.asset_id),
    angle: str(row.angle) as CharacterRefImage['angle'],
    weight: row.weight == null ? 1 : Number(row.weight),
    url: '/api/v1/assets/' + num(row.asset_id) + '/raw'
  };
}

export function mapVoice(row: Row): VoiceAsset {
  return {
    id: num(row.id),
    project_id: num(row.project_id),
    voice_id: str(row.voice_id),
    role_id: strOrNull(row.role_id),
    provider: str(row.provider),
    base_speed: row.base_speed == null ? 1 : Number(row.base_speed),
    available_emotions: json<string[]>(row.available_emotions, []),
    forbidden: strOrNull(row.forbidden),
    is_active: bool(row.is_active),
    authorization_file_hash: strOrNull(row.authorization_file_hash),
    authorized_until: strOrNull(row.authorized_until),
    char_name: strOrNull(row.char_name),
    created_at: str(row.created_at)
  };
}

export function mapVoiceRef(row: Row): VoiceRefAudio {
  return {
    id: num(row.id),
    voice_id: num(row.voice_id),
    asset_id: num(row.asset_id),
    ref_type: str(row.ref_type) as VoiceRefAudio['ref_type'],
    duration_sec: row.duration_sec == null ? null : Number(row.duration_sec),
    note: strOrNull(row.note),
    url: '/api/v1/assets/' + num(row.asset_id) + '/raw'
  };
}

export function mapTemplate(row: Row): WorkflowTemplate {
  return {
    id: num(row.id),
    template_key: str(row.template_key),
    template_type: str(row.template_type) as WorkflowTemplate['template_type'],
    display_name: str(row.display_name),
    template_body: json<Record<string, unknown>>(row.template_body, {}),
    param_map: json<Record<string, unknown>>(row.param_map, {}),
    params_schema: json<Record<string, unknown>>(row.params_schema, {}),
    constraints: json<Record<string, unknown>>(row.constraints, {}),
    enabled: bool(row.enabled),
    visual_style: strOrNull(row.visual_style) as WorkflowTemplate['visual_style'],
    created_at: str(row.created_at)
  };
}

export function mapTask(row: Row): RenderTask {
  return {
    id: num(row.id),
    project_id: num(row.project_id),
    shot_id: numOrNull(row.shot_id),
    segment_id: numOrNull(row.segment_id),
    task_type: str(row.task_type) as RenderTask['task_type'],
    engine: str(row.engine),
    engine_params: json<Record<string, unknown>>(row.engine_params, {}),
    idempotency_key: str(row.idempotency_key),
    status: str(row.status) as RenderTask['status'],
    priority: num(row.priority),
    node_id: numOrNull(row.node_id),
    external_task_id: strOrNull(row.external_task_id),
    attempt: num(row.attempt),
    max_attempt: num(row.max_attempt),
    depends_on: json<number[]>(row.depends_on, []),
    progress: num(row.progress),
    error_code: strOrNull(row.error_code),
    error_msg: strOrNull(row.error_msg),
    result_asset_id: numOrNull(row.result_asset_id),
    meta: json<Record<string, unknown>>(row.meta, {}),
    started_at: strOrNull(row.started_at),
    finished_at: strOrNull(row.finished_at),
    created_at: str(row.created_at)
  };
}

export function mapAsset(row: Row): Asset {
  return {
    id: num(row.id),
    project_id: num(row.project_id),
    asset_type: str(row.asset_type) as Asset['asset_type'],
    source: str(row.source) as Asset['source'],
    bucket: str(row.bucket),
    object_key: str(row.object_key),
    nfs_path: strOrNull(row.nfs_path),
    thumb_key: strOrNull(row.thumb_key),
    width: numOrNull(row.width),
    height: numOrNull(row.height),
    duration_sec: row.duration_sec == null ? null : Number(row.duration_sec),
    meta: json<Record<string, unknown>>(row.meta, {}),
    created_at: str(row.created_at),
    url: '/api/v1/assets/' + num(row.id) + '/raw'
  };
}

export function mapTimeline(row: Row): TimelineItem {
  return {
    id: num(row.id),
    project_id: num(row.project_id),
    shot_id: numOrNull(row.shot_id),
    track: str(row.track) as TimelineItem['track'],
    start_ms: num(row.start_ms),
    end_ms: num(row.end_ms),
    asset_id: numOrNull(row.asset_id),
    payload: json<Record<string, unknown>>(row.payload, {}),
    locked: bool(row.locked)
  };
}
