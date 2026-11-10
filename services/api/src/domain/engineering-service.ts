/**
 * 结构化工程文件（平台版 SVML）：生产即模板
 * 依据《玄枢AURUM与Hypit结合方案》v1.2 实现 8 大区块：meta/script/cast/shots/tracks/assets/render/slots
 */
import { all, get, json, nowIso, run } from '../db/index.js';
import { COMPOSE_PRESETS } from '@aurum/core';
import { museConfig, comfyDefaultTemplate, comfyUrl } from './settings-service.js';
import { config } from '../config.js';
import { notFound } from '../http/errors.js';
import { mapCharacter } from './mappers.js';

type Json = Record<string, unknown>;

const SCALE: Record<string, string> = {
  close_up: '特写', medium_close_up: '近景', medium_shot: '中景', wide: '全景', empty_shot: '空镜'
};
const ENGINE: Record<string, string> = { muse_api: 'cloud_muse', comfy_h3: 'local_h3' };
const STYLE: Record<string, string> = { photoreal: 'realistic', anime_2d: '2d', cgi_3d: '3d', comic: 'comic' };

function r2(n: number): number { return Math.round(n * 100) / 100; }

export interface EngineeringBody {
  meta: Json;
  script: Json;
  cast: Json;
  shots: Json;
  tracks: Json;
  assets: Json;
  render: Json;
  slots: Json;
}

export function buildEngineering(projectId: number, status?: string): EngineeringBody {
  const project = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!project) throw notFound('项目不存在');
  const segments = all('SELECT * FROM segment WHERE project_id = ? ORDER BY seq', [projectId]);
  const shots = all('SELECT s.*, g.seq AS segment_seq FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.project_id = ? ORDER BY g.seq, s.seq', [projectId]);
  const characters = all('SELECT * FROM character_asset WHERE project_id = ? AND is_active = 1 ORDER BY id', [projectId]);
  const preset = COMPOSE_PRESETS[String(project.aspect_ratio ?? '16:9')] ?? COMPOSE_PRESETS['16:9'];
  const totalMs = segments.reduce((n, s) => n + Number(s.duration_ms ?? 0), 0);

  const assetIds = new Set<number>();
  const castList: Json[] = [];
  for (const c of characters) {
    const row = mapCharacter(c);
    const ref = get('SELECT asset_id FROM character_ref_image WHERE character_id = ? ORDER BY id LIMIT 1', [Number(c.id)]);
    const voice = get('SELECT asset_id FROM voice_asset WHERE project_id = ? AND role_id = ?', [projectId, String(c.role_id)]);
    if (ref) assetIds.add(Number(ref.asset_id));
    if (voice) assetIds.add(Number(voice.asset_id));
    castList.push({
      character_id: 'c_' + Number(c.id),
      name: String(c.name),
      role_type: String(c.role_type),
      profile: { persona: String(c.persona ?? ''), prompt_prefix: String(c.prompt_prefix ?? ''), seed: Number(c.seed ?? 0) },
      design_sheet_asset_id: ref ? 'a_' + Number(ref.asset_id) : null,
      voice_asset_id: voice ? 'a_' + Number(voice.asset_id) : null,
      tts_config: { engine: 'edge-tts', model: 'zh-CN', default_emotion: 'friendly_smile', params: { speed: 1 } },
      on_camera: true,
      consistency_refs: []
    });
    void row;
  }

  const scriptSegments: Json[] = [];
  const shotList: Json[] = [];
  const tracks: Json[] = [];
  for (const seg of segments) {
    const segShots = shots.filter((s) => Number(s.segment_id) === Number(seg.id));
    const rounds = segShots.map((s, idx) => {
      const asset = s.tts_asset_id ? get('SELECT * FROM asset WHERE id = ?', [Number(s.tts_asset_id)]) : null;
      const meta = asset ? json<{ word_ts?: Array<{ word: string; start_ms: number; end_ms: number }> }>(asset.meta, {}) : {};
      const words = (meta.word_ts ?? []).map((w, i) => ({
        word: w.word,
        index: i,
        start_sec: r2(Number(w.start_ms) / 1000),
        end_sec: r2(Number(w.end_ms) / 1000),
        confidence: 0.9,
        bound_element_ids: [] as string[]
      }));
      if (asset) assetIds.add(Number(asset.id));
      const lineId = 'l_' + Number(s.id);
      const overlays = json<Array<{ type?: string; text?: string }>>(s.overlays, []);
      for (let oi = 0; oi < overlays.length; oi++) {
        const ov = overlays[oi];
        const trackId = 't_' + Number(s.id) + '_' + oi;
        const kind = ov.type === 'name_tag' ? 'name_card' : ov.type === 'flower' ? 'flower_text' : ov.type === 'title_card' ? 'effect' : 'effect';
        const boundIds: string[] = [];
        if (words.length) boundIds.push(words[0].index + ':0');
        tracks.push({
          track_id: trackId,
          track_kind: kind,
          asset_id: null,
          bind: { line_id: lineId, word_start: 0, word_end: Math.min(3, Math.max(0, words.length - 1)) },
          motion: { type: 'fade', in_ms: 120, out_ms: 160 },
          placement: { x: 0.06, y: 0.86, w: 0.6, h: 0.08 },
          layer_z: kind === 'name_card' ? 20 : 30,
          text_content: String(ov.text ?? ''),
          style_ref: 'st_variety_01'
        });
      }
      return {
        round_id: 'r_' + Number(s.id),
        round_index: idx,
        lines: [{
          line_id: lineId,
          speaker_id: s.speaker_role_id ? 'c_' + String(s.speaker_role_id) : null,
          speaker_name: String(s.speaker_name ?? ''),
          line_type: 'dialogue',
          text: String(s.text_clean ?? ''),
          performance_tags: json<string[]>(s.performance_tags, []),
          word_anchors: words,
          duration_sec: r2(Number(s.tts_duration_ms ?? s.duration_ms ?? 0) / 1000)
        }]
      };
    });

    for (const s of segShots) {
      if (s.preview_asset_id) assetIds.add(Number(s.preview_asset_id));
      shotList.push({
        shot_id: 's_' + Number(s.id),
        segment_id: 'g_' + Number(seg.id),
        line_id: 'l_' + Number(s.id),
        shot_index: Number(s.seq ?? 0),
        scale: SCALE[String(s.camera)] ?? '中景',
        camera_position: String(s.camera ?? 'medium_shot'),
        camera_movement: '固定',
        composition: String(s.visual_prompt ?? '').slice(0, 60),
        lighting: '暖棚光',
        depth: { fg: '', mg: '主持人', bg: '演播厅' },
        prompt: String(s.visual_prompt ?? ''),
        negative_prompt: String(s.negative_prompt ?? ''),
        visual_style: STYLE[String(s.visual_style ?? 'photoreal')] ?? 'realistic',
        render_engine: ENGINE[String(s.render_engine ?? 'muse_api')] ?? 'cloud_muse',
        duration_sec: r2(Number(s.duration_ms ?? 0) / 1000),
        lipsync_required: Number(s.lipsync_required) === 1
      });
    }

    scriptSegments.push({
      segment_id: 'g_' + Number(seg.id),
      segment_index: Number(seg.seq ?? 0),
      title: String(seg.title ?? ''),
      segment_type: String(seg.segment_type ?? ''),
      duration_sec: r2(Number(seg.duration_ms ?? 0) / 1000),
      rounds
    });
  }

  // 背景音乐作为一条轨道
  tracks.push({
    track_id: 't_bgm',
    track_kind: 'effect',
    asset_id: null,
    bind: { line_id: null, word_start: 0, word_end: 0 },
    motion: null,
    placement: { x: 0, y: 0, w: 1, h: 1 },
    layer_z: 0,
    text_content: null,
    style_ref: 'bgm_light_talk_01'
  });

  const assets = [...assetIds].map((id) => {
    const a = get('SELECT * FROM asset WHERE id = ?', [id]);
    return {
      asset_id: 'a_' + id,
      asset_kind: a ? (String(a.asset_type) === 'audio' ? 'audio' : String(a.asset_type) === 'video' ? 'broll' : 'image') : 'image',
      uri: '/api/v1/assets/' + id + '/raw',
      version: '1',
      checksum: null,
      alpha: false,
      source: 'generated'
    };
  });

  const muse = museConfig();
  const body: EngineeringBody = {
    meta: {
      project_id: 'p_' + projectId,
      engineering_id: 'eng_' + projectId,
      version: 1,
      title: String(project.name ?? ''),
      created_at: String(project.created_at ?? nowIso()),
      updated_at: nowIso(),
      lineage: {},
      aspect_ratio: String(project.aspect_ratio ?? '16:9'),
      resolution: { width: preset.width, height: preset.height },
      visual_style: STYLE[String(project.visual_style ?? 'photoreal')] ?? 'realistic',
      total_duration_sec: r2(totalMs / 1000),
      status: status ?? (String(project.status) === 'composed' ? 'renderable' : 'draft'),
      segment_count: segments.length,
      shot_count: shots.length,
      language: String(project.language ?? 'zh')
    },
    script: { segments: scriptSegments },
    cast: { characters: castList },
    shots: { shots: shotList },
    tracks: { tracks },
    assets: { assets },
    render: {
      render_engine_default: 'cloud_muse',
      engine_routes: { close_up_private: 'local_h3', wide: 'cloud_muse', default: 'cloud_muse' },
      cloud: { provider: 'apimart', model: muse.model, secret_ref: 'muse.api_key' },
      local: { workflow: comfyDefaultTemplate(), param_map: {}, gpu_profile: 'rtx-3080ti', vram_limit_gb: 12, concurrency: 1, base_url: comfyUrl() },
      audio: { tts_engine: 'edge-tts', tts_model: 'zh-CN', fallback: 'local-synth', sample_rate: 48000 },
      privacy_mode: Number(project.privacy_mode) === 1,
      output: { format: 'mp4', codec: 'h264', fps: preset.fps, bitrate: '8M' }
    },
    slots: {
      slots: [
        { slot_key: 'host', slot_type: 'media', current_value: castList[0]?.character_id ?? null, constraint: { type: 'character' }, linked_fields: ['cast.characters', 'script.segments[].rounds[].lines[].speaker_id'], required: false, default: null },
        { slot_key: 'language', slot_type: 'enum', current_value: String(project.language ?? 'zh'), constraint: { enum: ['zh', 'en', 'es', 'ja', 'ko', 'pt'] }, linked_fields: ['project.language', 'script.segments[].rounds[].lines[].text'], required: true, default: 'zh' },
        { slot_key: 'visual_style', slot_type: 'enum', current_value: STYLE[String(project.visual_style ?? 'photoreal')], constraint: { enum: ['realistic', '2d', '3d', 'comic'] }, linked_fields: ['shots.shots[].visual_style'], required: true, default: 'realistic' },
        { slot_key: 'product', slot_type: 'text', current_value: '', constraint: { type: 'string' }, linked_fields: ['script.segments[].rounds[].lines[].text'], required: false, default: '' }
      ]
    }
  };
  return body;
}

export function saveEngineering(projectId: number, status: string, lineage: Json = {}): { id: number; version: number; engineering_id: string } {
  const body = buildEngineering(projectId, status);
  const last = get('SELECT engineering_id, MAX(version) AS v FROM engineering_file WHERE project_id = ?', [projectId]);
  const engineeringId = last && last.engineering_id ? String(last.engineering_id) : 'eng_' + projectId + '_' + Date.now();
  const version = Number(last?.v ?? 0) + 1;
  (body.meta as Json).version = version;
  (body.meta as Json).engineering_id = engineeringId;
  (body.meta as Json).lineage = lineage;
  const res = run('INSERT INTO engineering_file (project_id, engineering_id, version, status, body, lineage, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [
    projectId, engineeringId, version, status, JSON.stringify(body), JSON.stringify(lineage), nowIso(), nowIso()
  ]);
  return { id: res.lastInsertRowid, version, engineering_id: engineeringId };
}

export function latestEngineering(projectId: number): { id: number; version: number; body: EngineeringBody; status: string } | null {
  const row = get('SELECT * FROM engineering_file WHERE project_id = ? ORDER BY version DESC LIMIT 1', [projectId]);
  if (!row) return null;
  return { id: Number(row.id), version: Number(row.version), body: json<EngineeringBody>(row.body, {} as EngineeringBody), status: String(row.status) };
}

export interface CloneInput {
  project_id: number;
  name?: string;
  slots?: Record<string, string | null>;
  edits?: { line_text_map?: Record<string, string> };
}

export function cloneEngineering(input: CloneInput): { project_id: number; engineering: EngineeringBody } {
  const src = get('SELECT * FROM project WHERE id = ?', [input.project_id]);
  if (!src) throw notFound('源项目不存在');
  const slots = input.slots ?? {};
  const styleMap: Record<string, string> = { realistic: 'photoreal', photoreal: 'photoreal', '2d': 'anime_2d', anime_2d: 'anime_2d', '3d': 'cgi_3d', cgi_3d: 'cgi_3d', comic: 'comic' };
  const visual = slots.visual_style ? (styleMap[String(slots.visual_style)] ?? String(src.visual_style)) : String(src.visual_style);
  const language = slots.language ? String(slots.language) : String(src.language ?? 'zh');
  const name = input.name ?? (String(src.name) + ' · 复刻');
  const res = run(
    'INSERT INTO project (name, variety_type, aspect_ratio, fps, style_prompt, style_negative, privacy_mode, visual_style, global_config, owner_user_id, status, segment_cap_sec, language, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [name, String(src.variety_type), String(src.aspect_ratio), Number(src.fps ?? 25), src.style_prompt ?? null, src.style_negative ?? null, Number(src.privacy_mode ?? 0), visual, String(src.global_config ?? '{}'), Number(src.owner_user_id ?? 1), 'draft', Number(src.segment_cap_sec ?? 300), language, nowIso(), nowIso()]
  );
  const projectId = res.lastInsertRowid;
  run('UPDATE project SET auto_compose = 1 WHERE id = ?', [projectId]);
  const segs = all('SELECT * FROM segment WHERE project_id = ? ORDER BY seq', [input.project_id]);
  for (const seg of segs) {
    const segRes = run('INSERT INTO segment (project_id, seq, segment_type, title, default_engine, visual_style, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?)', [
      projectId, Number(seg.seq), String(seg.segment_type), String(seg.title), String(seg.default_engine ?? 'muse_api'), seg.visual_style ?? null, Number(seg.duration_ms ?? 0), nowIso()
    ]);
    const shots = all('SELECT * FROM round_shot WHERE segment_id = ? ORDER BY seq', [Number(seg.id)]);
    for (const s of shots) {
      const text = input.edits?.line_text_map?.[String(s.id)] ?? String(s.text_clean ?? '');
      run('INSERT INTO round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, emotion_instruction, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        projectId, segRes.lastInsertRowid, Number(s.seq), String(s.shot_code ?? ''), s.speaker_role_id ?? null, s.speaker_name ?? null, String(s.camera ?? 'medium_shot'),
        JSON.stringify([text]), text, s.emotion ?? null, s.emotion_instruction ?? null, String(s.performance_tags ?? '[]'),
        String(s.visual_prompt ?? ''), String(s.negative_prompt ?? ''), String(s.overlays ?? '[]'),
        String(s.render_engine ?? 'muse_api'), visual, String(s.engine_params ?? '{}'), 'edge-tts', s.voice_id ?? null,
        Number(s.tts_speed ?? 1), Number(s.lipsync_required ?? 0), Number(s.native_audio ?? 0), Number(s.privacy ?? 0), 1,
        'empty', Number(s.duration_ms ?? 3000), Number(s.target_duration_ms ?? s.duration_ms ?? 3000), nowIso(), nowIso()
      ]);
    }
  }
  // 角色卡也复制一份
  const chars = all('SELECT * FROM character_asset WHERE project_id = ? AND is_active = 1', [input.project_id]);
  for (const c of chars) {
    run('INSERT INTO character_asset (project_id, role_id, version, name, role_type, persona, prompt_prefix, negative_extra, lock_seed, seed, is_active, anchor_prompt, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)', [
      projectId, String(c.role_id), 1, String(c.name), String(c.role_type), String(c.persona ?? ''), String(c.prompt_prefix ?? ''), String(c.negative_extra ?? ''), Number(c.lock_seed ?? 1), Number(c.seed ?? 0), String(c.anchor_prompt ?? ''), nowIso()
    ]);
  }
  const lineage = { source_engineering_id: 'eng_' + input.project_id, source_template_id: null, clone_batch_id: 'clone_' + Date.now() };
  saveEngineering(projectId, 'draft', lineage);
  const stored = latestEngineering(projectId);
  return { project_id: projectId, engineering: (stored?.body ?? buildEngineering(projectId, 'draft')) as unknown as EngineeringBody };
}

export function abstractToTemplate(projectId: number): { template_key: string } {
  const project = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!project) throw notFound('项目不存在');
  const body = buildEngineering(projectId, 'archived');
  // 清空实例值，保留结构与槽位
  const template = JSON.parse(JSON.stringify(body)) as EngineeringBody;
  template.meta.title = String(project.name ?? '') + ' · 模板';
  template.meta.status = 'draft';
  template.meta.lineage = { source_engineering_id: 'eng_' + projectId, source_template_id: null, clone_batch_id: null };
  for (const seg of (template.script.segments as Json[])) {
    for (const round of (seg.rounds as Json[])) {
      for (const line of (round.lines as Json[])) line.text = '【示例台词，复刻时替换】';
    }
  }
  template.assets = { assets: [] };
  template.cast = { characters: [] };
  (template.slots.slots as Json[]).forEach((slot) => { slot.current_value = null; });
  const key = 'eng_tpl_' + Date.now();
  run('INSERT INTO workflow_template (template_key, template_type, display_name, template_body, param_map, params_schema, constraints, enabled, visual_style, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)', [
    key, 'engineering_template', String(project.name ?? '') + ' · 工程模板', JSON.stringify(template), '{}', '{}', JSON.stringify({ aspect: project.aspect_ratio, slots: (body.slots.slots as Json[]).map((s) => s.slot_key) }), String(project.visual_style ?? 'photoreal'), nowIso()
  ]);
  return { template_key: key };
}
