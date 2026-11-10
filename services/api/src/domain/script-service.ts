import {
  CAMERA_LABEL,
  LIPSYNC_CAMERAS,
  buildEmotionInstruction,
  composePrompt,
  emotionSpeed,
  parseLine,
  stylePreset,
  type Camera,
  type Project,
  type RenderEngine,
  type ScriptDoc,
  type Segment,
  type Shot,
  type StructuredScript
} from '@aurum/core';
import { all, get, jstr, json, nowIso, run, tx } from '../db/index.js';
import { ApiError, notFound } from '../http/errors.js';
import { sha256 } from '../util.js';
import { mapCandidate, mapScript, mapSegment, mapShot } from './mappers.js';
import { parseScript, type ParseOptions, type ParseResult } from '../engine/script-parser.js';
import { evaluateSegment, type SegmentCompliance } from '../engine/compliance.js';
import { listShotRows, rebuildSegmentDurations, shotsOfSegment, touchProject } from './project-service.js';
import { buildTimeline } from './timeline-service.js';

export function getLatestScript(projectId: number): ScriptDoc | null {
  const row = get('SELECT * FROM script WHERE project_id = ? ORDER BY version DESC LIMIT 1', [projectId]);
  return row ? mapScript(row) : null;
}

export function getScript(scriptId: number): ScriptDoc {
  const row = get('SELECT * FROM script WHERE id = ?', [scriptId]);
  if (!row) throw notFound('台本不存在');
  return mapScript(row);
}

export function saveScript(projectId: number, rawMd: string): ScriptDoc {
  const latest = get('SELECT MAX(version) AS v FROM script WHERE project_id = ?', [projectId]);
  const version = Number(latest?.v ?? 0) + 1;
  const res = run('INSERT INTO script (project_id, raw_md, structured_json, parse_status, version, created_at) VALUES (?,?,?,?,?,?)', [
    projectId, rawMd, '{}', 'pending', version, nowIso()
  ]);
  return getScript(res.lastInsertRowid);
}

export function characterBindings(projectId: number): Array<{ role_id: string; name: string }> {
  return all<{ role_id: string; name: string }>('SELECT role_id, name FROM character_asset WHERE project_id = ? AND is_active = 1', [projectId]);
}

export function parseOptionsFor(project: Project): ParseOptions {
  return {
    projectId: project.id,
    varietyType: project.variety_type,
    visualStyle: project.visual_style,
    title: project.name,
    stylePrompt: project.style_prompt ?? stylePreset(project.visual_style).prefix,
    styleNegative: project.style_negative ?? stylePreset(project.visual_style).negative,
    privacyMode: project.privacy_mode,
    characters: characterBindings(project.id),
    aspectRatio: project.aspect_ratio,
    fps: project.fps
  };
}

export interface ParseOutcome {
  script: ScriptDoc;
  report: ParseResult['report'];
  compliance: SegmentCompliance[];
  created_characters: string[];
}

export function parseScriptDoc(project: Project, scriptId: number, opts?: { useLlm?: boolean; llmResult?: ParseResult }): ParseOutcome {
  const script = getScript(scriptId);
  const result = opts?.llmResult ?? parseScript(script.raw_md, parseOptionsFor(project));
  const createdCharacters = tx(() => {
    const created = persistStructured(project, result.structured);
    run(
      'UPDATE script SET structured_json = ?, parse_status = ?, parse_report = ? WHERE id = ?',
      [jstr(result.structured), result.report.errors.length ? 'failed' : 'parsed', jstr(result.report), scriptId]
    );
    run('UPDATE project SET status = ?, updated_at = ? WHERE id = ?', ['parsing', nowIso(), project.id]);
    return created;
  });
  const compliance = recomputeAll(project.id);
  return {
    script: getScript(scriptId),
    report: result.report,
    compliance,
    created_characters: createdCharacters
  };
}

export function structuredToMarkdown(structured: StructuredScript): string {
  const lines: string[] = ['# ' + structured.global.title, ''];
  for (const seg of structured.segments) {
    lines.push('## ' + seg.title, '');
    for (const round of seg.rounds) {
      const speaker = round.speaker_name ? '【' + round.speaker_name + '】' : '【空镜】';
      const text = (round.lines ?? []).join(' ');
      if (text) lines.push(speaker + text);
      else lines.push(speaker + (round.visual_prompt ?? '').slice(0, 60));
      lines.push('');
    }
  }
  return lines.join('\n');
}

export interface PersistedScript {
  script_id: number;
  created_characters: string[];
  segments: number;
  shots: number;
  compliance: SegmentCompliance[];
}

/** 智能体产物落地：与人工台本走同一套持久化、校验与时长复算 */
export function persistStructuredScript(project: Project, structured: StructuredScript): PersistedScript {
  const latest = get('SELECT MAX(version) AS v FROM script WHERE project_id = ?', [project.id]);
  const version = Number(latest?.v ?? 0) + 1;
  const md = structuredToMarkdown(structured);
  const inserted = run(
    'INSERT INTO script (project_id, raw_md, structured_json, parse_status, parse_report, version, created_at) VALUES (?,?,?,?,?,?,?)',
    [project.id, md, jstr(structured), 'parsed', jstr({ source: 'agent', warnings: [], errors: [] }), version, nowIso()]
  );
  const createdCharacters = persistStructured(project, structured);
  const shotCount = structured.segments.reduce((n, s) => n + (s.rounds?.length ?? 0), 0);
  const compliance = recomputeAll(project.id);
  return {
    script_id: inserted.lastInsertRowid,
    created_characters: createdCharacters,
    segments: structured.segments.length,
    shots: shotCount,
    compliance
  };
}

export function persistStructured(project: Project, structured: StructuredScript): string[] {
  const projectId = project.id;
  const createdCharacters: string[] = [];
  const existingSegments = all('SELECT * FROM segment WHERE project_id = ? ORDER BY seq', [projectId]);
  const keepSegmentIds = new Set<number>();

  structured.segments.forEach((seg, sIdx) => {
    const seq = sIdx + 1;
    let segRow = existingSegments.find((s) => Number(s.seq) === seq);
    if (!segRow) {
      const res = run('INSERT INTO segment (project_id, seq, segment_type, title, default_engine, visual_style, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?)', [
        projectId, seq, seg.segment_type, seg.title, seg.default_engine, seg.visual_style ?? null, 0, nowIso()
      ]);
      segRow = { id: res.lastInsertRowid };
    } else {
      run('UPDATE segment SET segment_type = ?, title = ?, default_engine = ?, visual_style = ? WHERE id = ?', [
        seg.segment_type, seg.title, seg.default_engine, seg.visual_style ?? null, Number(segRow.id)
      ]);
    }
    const segmentId = Number(segRow.id);
    keepSegmentIds.add(segmentId);

    const existingShots = all('SELECT * FROM round_shot WHERE segment_id = ? ORDER BY seq', [segmentId]);
    const keepShotIds = new Set<number>();

    seg.rounds.forEach((round, rIdx) => {
      const shotSeq = rIdx + 1;
      const shotCode = 'S' + String(seq).padStart(2, '0') + '-SH' + String(shotSeq).padStart(2, '0');
      const existing = existingShots.find((s) => Number(s.seq) === shotSeq);
      if (existing && Number(existing.manual_edited) === 1) {
        keepShotIds.add(Number(existing.id));
        run('UPDATE round_shot SET shot_code = ? WHERE id = ?', [shotCode, Number(existing.id)]);
        return;
      }

      // 角色/音色自动补建
      if (round.speaker_name && round.speaker_role_id) {
        const has = get('SELECT id FROM character_asset WHERE project_id = ? AND role_id = ? AND version = 1', [projectId, round.speaker_role_id]);
        if (!has) {
          const seed = parseInt(sha256(round.speaker_name).slice(0, 8), 16) % 1000000;
          run(
            'INSERT INTO character_asset (project_id, role_id, version, name, role_type, persona, prompt_prefix, negative_extra, lock_seed, seed, is_active, anchor_prompt, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [projectId, round.speaker_role_id, 1, round.speaker_name, 'guest', '由台本解析自动创建的待补全人设', '', '', 1, seed, 1, '', nowIso()]
          );
          createdCharacters.push(round.speaker_name);
        }
        const voiceId = round.tts?.voice_id ?? 'v_' + sha256(round.speaker_name).slice(0, 6);
        const hasVoice = get('SELECT id FROM voice_asset WHERE project_id = ? AND voice_id = ?', [projectId, voiceId]);
        if (!hasVoice) {
          run(
            'INSERT INTO voice_asset (project_id, voice_id, role_id, provider, base_speed, available_emotions, forbidden, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            [projectId, voiceId, round.speaker_role_id, 'indextts2', 1.0, jstr(['friendly_smile', 'thoughtful', 'surprised', 'serious']), '沙哑, 哭腔, 过于激动', 1, nowIso()]
          );
        }
      }

      const lines = round.lines ?? [];
      const parsed = lines.length ? parseLine(lines.join(' ')) : null;
      const text = parsed ? parsed.clean_text : '';
      const speed = Number(round.tts?.speed ?? 1) || 1;
      const pauseMs = round.performance_tags ? round.performance_tags.filter((t) => t.tag === 'pause').reduce((n, t) => n + Number(t.value ?? 1) * 1000, 0) : 0;
      const estimate = lines.length > 0
        ? estimateMs(text, speed, pauseMs)
        : Math.max(2000, Number(round.target_duration_ms ?? 3000));
      const engine = (round.engine_params?.engine as RenderEngine) ?? seg.default_engine;
      const voice = round.tts?.voice_id ?? (round.speaker_name ? 'v_' + sha256(round.speaker_name).slice(0, 6) : 'v_narrator');

      if (existing) {
        run(
          'UPDATE round_shot SET shot_code = ?, speaker_role_id = ?, speaker_name = ?, camera = ?, lines = ?, text_clean = ?, emotion = ?, emotion_instruction = ?, performance_tags = ?, visual_prompt = ?, overlays = ?, render_engine = ?, visual_style = ?, engine_params = ?, voice_id = ?, tts_speed = ?, lipsync_required = ?, privacy = ?, duration_ms = ?, target_duration_ms = ?, updated_at = ? WHERE id = ?',
          [
            shotCode, round.speaker_role_id ?? null, round.speaker_name ?? null, round.camera, jstr(lines), text,
            round.emotion ?? null, round.emotion_instruction ?? null, jstr(round.performance_tags ?? []),
            round.visual_prompt ?? '', jstr(round.overlays ?? []), engine, round.visual_style ?? project.visual_style,
            jstr(round.engine_params ?? {}), voice, speed, round.lipsync_required ? 1 : 0, round.privacy ? 1 : 0, estimate, estimate, nowIso(),
            Number(existing.id)
          ]
        );
        keepShotIds.add(Number(existing.id));
      } else {
        const res = run(
          'INSERT INTO round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, emotion_instruction, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            projectId, segmentId, shotSeq, shotCode, round.speaker_role_id ?? null, round.speaker_name ?? null, round.camera,
            jstr(lines), text, round.emotion ?? null, round.emotion_instruction ?? null, jstr(round.performance_tags ?? []),
            round.visual_prompt ?? '', project.style_negative ?? '', jstr(round.overlays ?? []), engine,
            round.visual_style ?? project.visual_style, jstr(round.engine_params ?? {}), round.tts?.engine ?? 'indextts2', voice,
            speed, round.lipsync_required ? 1 : 0, 0, round.privacy ? 1 : 0, 0, 'empty', estimate, estimate, nowIso(), nowIso()
          ]
        );
        keepShotIds.add(res.lastInsertRowid);
      }
    });

    for (const shot of existingShots) {
      const id = Number(shot.id);
      if (!keepShotIds.has(id) && Number(shot.locked) === 0) run('DELETE FROM round_shot WHERE id = ?', [id]);
    }
  });

  for (const seg of existingSegments) {
    const id = Number(seg.id);
    if (!keepSegmentIds.has(id)) {
      const remaining = all('SELECT id FROM round_shot WHERE segment_id = ? AND locked = 1', [id]);
      if (remaining.length === 0) run('DELETE FROM segment WHERE id = ?', [id]);
    }
  }

  return createdCharacters;
}

function estimateMs(text: string, speed: number, pauseMs: number): number {
  const chars = Array.from((text ?? '').replace(/\s/g, '')).length;
  const base = (chars / 4.8) * 1000 / (speed || 1) + pauseMs;
  return Math.max(1200, Math.round(base));
}

export function recomputeAll(projectId: number): SegmentCompliance[] {
  tx(() => {
    rebuildSegmentDurations(projectId);
    buildTimeline(projectId);
    touchProject(projectId);
  });
  return complianceOfProject(projectId);
}

export function complianceOfProject(projectId: number): SegmentCompliance[] {
  const segRows = all('SELECT * FROM segment WHERE project_id = ? ORDER BY seq', [projectId]);
  const out: SegmentCompliance[] = [];
  for (const row of segRows) {
    const segment = mapSegment(row);
    const shots = all<Record<string, unknown>>('SELECT * FROM round_shot WHERE segment_id = ? ORDER BY seq', [segment.id]);
    out.push(
      evaluateSegment({
        segment_id: segment.id,
        seq: segment.seq,
        title: segment.title,
        shots: shots.map((s) => ({
          id: Number(s.id),
          segment_id: segment.id,
          seq: Number(s.seq),
          camera: String(s.camera),
          tts_duration_ms: s.tts_duration_ms == null ? null : Number(s.tts_duration_ms),
          duration_ms: Number(s.duration_ms ?? 0)
        }))
      })
    );
  }
  return out;
}

export function assertSegmentCompliance(projectId: number, segmentId?: number | null): SegmentCompliance[] {
  const allCompliance = complianceOfProject(projectId);
  const hit = segmentId ? allCompliance.filter((c) => c.segment_id === segmentId) : allCompliance;
  for (const item of hit) {
    if (item.exceed) {
      throw new ApiError(
        'SEGMENT_DURATION_EXCEED',
        '本段《' + item.title + '》已达 ' + item.duration_sec + ' 秒，超出上限 ' + item.exceed_sec + ' 秒，请删减镜头或拆分段落',
        {
          segment_id: item.segment_id,
          title: item.title,
          duration_sec: item.duration_sec,
          exceed_sec: item.exceed_sec,
          split_hint: item.split_suggestion
        }
      );
    }
  }
  return hit;
}

export function listShots(projectId: number, filter: { segment_id?: number; status?: string; engine?: string; search?: string; limit?: number; offset?: number } = {}): Shot[] {
  const rows = listShotRows(projectId, filter as never);
  const ids = rows.map((r) => Number(r.id));
  const candMap = new Map<number, ReturnType<typeof mapCandidate>[]>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const cands = all('SELECT * FROM shot_candidate WHERE shot_id IN (' + placeholders + ') ORDER BY idx', ids);
    for (const c of cands) {
      const mapped = mapCandidate(c);
      const arr = candMap.get(mapped.shot_id) ?? [];
      arr.push(mapped);
      candMap.set(mapped.shot_id, arr);
    }
  }
  return rows.map((r) => mapShot(r, candMap.get(Number(r.id)) ?? []));
}

export function patchedShot(shotId: number, patch: Record<string, unknown>): Shot {
  const row = get('SELECT * FROM round_shot WHERE id = ?', [shotId]);
  if (!row) throw notFound('镜头不存在');
  const allowed = [
    'speaker_role_id', 'speaker_name', 'camera', 'lines', 'emotion', 'emotion_instruction', 'visual_prompt',
    'negative_prompt', 'render_engine', 'visual_style', 'engine_params', 'voice_id', 'tts_speed',
    'lipsync_required', 'native_audio', 'privacy', 'locked', 'status', 'template_id', 'tts_engine', 'overlays'
  ];
  const fields: string[] = [];
  const values: unknown[] = [];
  const changes: string[] = [];

  for (const key of allowed) {
    if (!(key in patch)) continue;
    const v = patch[key];
    fields.push(key + ' = ?');
    if (key === 'lines') values.push(jstr(Array.isArray(v) ? v : [String(v)]));
    else if (['engine_params', 'overlays'].includes(key)) values.push(jstr(v));
    else if (['lipsync_required', 'native_audio', 'privacy', 'locked'].includes(key)) values.push(v ? 1 : 0);
    else if (key === 'tts_speed') values.push(Number(v));
    else values.push(v);
    changes.push(key);
  }

  if ('lines' in patch || 'tts_speed' in patch) {
    const lines = 'lines' in patch ? (Array.isArray(patch.lines) ? (patch.lines as string[]) : [String(patch.lines)]) : json<string[]>(row.lines, []);
    const parsed = parseLine(lines.join(' '));
    const speed = Number('tts_speed' in patch ? patch.tts_speed : row.tts_speed) || 1;
    const pauseMs = parsed.tags.filter((t) => t.tag === 'pause').reduce((n, t) => n + Number(t.value ?? 1) * 1000, 0);
    const est = estimateMs(parsed.clean_text, speed, pauseMs);
    fields.push('text_clean = ?', 'duration_ms = ?');
    values.push(parsed.clean_text, est);
  }

  if ('emotion' in patch && !('emotion_instruction' in patch)) {
    const extra = json<{ emotion_instruction?: string }>({ emotion_instruction: String(row.emotion_instruction ?? '') }, {}).emotion_instruction;
    const instr = buildEmotionInstruction(String(patch.emotion), extractExtra(row));
    fields.push('emotion_instruction = ?');
    values.push(instr);
    changes.push('emotion_instruction');
    if (!('tts_speed' in patch)) {
      fields.push('tts_speed = ?');
      values.push(emotionSpeed(String(patch.emotion), Number(row.tts_speed) || 1));
    }
    void extra;
  }

  if ('camera' in patch) {
    const cam = String(patch.camera) as Camera;
    const shouldLipsync = LIPSYNC_CAMERAS.includes(cam) && !!row.speaker_role_id;
    if (!('lipsync_required' in patch)) {
      fields.push('lipsync_required = ?');
      values.push(shouldLipsync ? 1 : 0);
    }
  }

  if ('render_engine' in patch && !('engine_params' in patch)) {
    const styleParams = stylePreset(String(row.visual_style)).engine_params[String(patch.render_engine)] ?? {};
    fields.push('engine_params = ?');
    values.push(jstr({ engine: patch.render_engine, ...styleParams }));
  }

  if (fields.length > 0) {
    fields.push('manual_edited = 1', 'updated_at = ?');
    values.push(nowIso());
    values.push(shotId);
    run('UPDATE round_shot SET ' + fields.join(', ') + ' WHERE id = ?', values);
  }

  const projectId = Number(row.project_id);
  recomputeAll(projectId);
  const fresh = get('SELECT s.*, g.seq AS segment_seq, g.title AS segment_title FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.id = ?', [shotId]);
  return mapShot(fresh as Record<string, unknown>);
}

function extractExtra(row: Record<string, unknown>): string {
  const instr = String(row.emotion_instruction ?? '');
  const idx = instr.indexOf('，');
  if (idx >= 0 && instr.length > idx + 1) return instr.slice(idx + 1);
  return '';
}

export function createShot(projectId: number, segmentId: number, input: Record<string, unknown>): Shot {
  const segment = get('SELECT * FROM segment WHERE id = ? AND project_id = ?', [segmentId, projectId]);
  if (!segment) throw notFound('环节不存在');
  const maxSeq = get('SELECT MAX(seq) AS m FROM round_shot WHERE segment_id = ?', [segmentId]);
  const seq = Number(maxSeq?.m ?? 0) + 1;
  const project = get('SELECT * FROM project WHERE id = ?', [projectId]) as Record<string, unknown>;
  const lines = Array.isArray(input.lines) ? (input.lines as string[]) : [String(input.lines ?? '')];
  const camera = String(input.camera ?? 'medium_shot');
  const engine = String(input.render_engine ?? segment.default_engine);
  const now = nowIso();
  const res = run(
    'INSERT INTO round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, emotion_instruction, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      projectId, segmentId, seq, 'S' + String(segment.seq).padStart(2, '0') + '-SH' + String(seq).padStart(2, '0'),
      input.speaker_role_id ?? null, input.speaker_name ?? null, camera, jstr(lines), '',
      input.emotion ?? null, buildEmotionInstruction(String(input.emotion ?? ''), null),
      '[]', input.visual_prompt ?? composePrompt({ styleId: String(project.visual_style), content: String(input.visual_prompt ?? '') }),
      String(project.style_negative ?? ''), '[]', engine, String(project.visual_style ?? 'photoreal'),
      jstr({ engine }), 'indextts2', input.voice_id ?? null, Number(input.tts_speed ?? 1),
      LIPSYNC_CAMERAS.includes(camera as Camera) && input.speaker_role_id ? 1 : 0, 0, input.privacy ? 1 : 0, 1, 'empty',
      estimateMs(lines.join(' '), Number(input.tts_speed ?? 1), 0), now, now
    ]
  );
  const shotId = res.lastInsertRowid;
  patchedShot(shotId, { lines });
  recomputeAll(projectId);
  const fresh = get('SELECT s.*, g.seq AS segment_seq, g.title AS segment_title FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.id = ?', [shotId]);
  return mapShot(fresh as Record<string, unknown>);
}

export function deleteShot(shotId: number): void {
  const row = get('SELECT * FROM round_shot WHERE id = ?', [shotId]);
  if (!row) throw notFound('镜头不存在');
  const segmentId = Number(row.segment_id);
  run('DELETE FROM round_shot WHERE id = ?', [shotId]);
  const rest = all<{ id: number }>('SELECT id FROM round_shot WHERE segment_id = ? ORDER BY seq', [segmentId]);
  rest.forEach((r, i) => run('UPDATE round_shot SET seq = ? WHERE id = ?', [i + 1, r.id]));
  recomputeAll(Number(row.project_id));
}

export function reorderShots(segmentId: number, orderedIds: number[]): void {
  const segment = get('SELECT * FROM segment WHERE id = ?', [segmentId]);
  if (!segment) throw notFound('环节不存在');
  orderedIds.forEach((id, i) => run('UPDATE round_shot SET seq = ? WHERE id = ? AND segment_id = ?', [i + 1, id, segmentId]));
  recomputeAll(Number(segment.project_id));
}

export function shotDetail(shotId: number): { shot: Shot; segment: Segment | null; project: Project | null } {
  const row = get('SELECT s.*, g.seq AS segment_seq, g.title AS segment_title FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.id = ?', [shotId]);
  if (!row) throw notFound('镜头不存在');
  const segRow = get('SELECT * FROM segment WHERE id = ?', [Number(row.segment_id)]);
  const projRow = get('SELECT * FROM project WHERE id = ?', [Number(row.project_id)]);
  return {
    shot: mapShot(row, all('SELECT * FROM shot_candidate WHERE shot_id = ? ORDER BY idx', [shotId]).map(mapCandidate)),
    segment: segRow ? mapSegment(segRow) : null,
    project: projRow ? (projRow as unknown as Project) : null
  };
}

export function segmentShots(segmentId: number): Shot[] {
  return shotsOfSegment(segmentId).map((s) => mapShot(s as unknown as Record<string, unknown>, all('SELECT * FROM shot_candidate WHERE shot_id = ? ORDER BY idx', [s.id]).map(mapCandidate)));
}

export function cameraLabel(cam: string): string {
  return CAMERA_LABEL[cam as Camera] ?? cam;
}
