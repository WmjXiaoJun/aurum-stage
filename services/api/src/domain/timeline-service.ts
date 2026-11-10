import type { Shot, TimelineItem } from '@aurum/core';
import { COMPOSE_PRESETS, SHOT_GAP_MS } from '@aurum/core';
import { all, get, jstr, json, nowIso, run } from '../db/index.js';
import { mapShot, mapTimeline } from './mappers.js';
import { buildCues, type Cue } from '../media/subtitles.js';
import { notFound } from '../http/errors.js';

function loadShots(projectId: number, segmentId?: number | null): Shot[] {
  const sql = segmentId
    ? 'SELECT s.*, g.seq AS segment_seq, g.title AS segment_title FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.project_id = ? AND s.segment_id = ? ORDER BY g.seq ASC, s.seq ASC'
    : 'SELECT s.*, g.seq AS segment_seq, g.title AS segment_title FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.project_id = ? ORDER BY g.seq ASC, s.seq ASC';
  const language = String(get('SELECT language FROM project WHERE id = ?', [projectId])?.language ?? 'zh');
  return all<Record<string, unknown>>(sql, segmentId ? [projectId, segmentId] : [projectId]).map((r) => {
    const shot = mapShot(r);
    // 出海：字幕/时间轴用本地化台词，原始中文仍保留在 text_clean 供编辑
    if (language !== 'zh' && r.text_local) (shot as unknown as { text_clean: string }).text_clean = String(r.text_local);
    return shot;
  });
}

function wordTsOf(assetId: number | null): Array<{ word: string; start_ms: number; end_ms: number }> | undefined {
  if (!assetId) return undefined;
  const row = get('SELECT meta FROM asset WHERE id = ?', [assetId]);
  if (!row) return undefined;
  const meta = json<{ word_ts?: Array<{ word: string; start_ms: number; end_ms: number }> }>(row.meta, {});
  return meta.word_ts;
}

export interface TimelineBundle {
  items: TimelineItem[];
  total_ms: number;
  cues: Cue[];
}

export function buildTimeline(projectId: number): void {
  const shots = loadShots(projectId);
  const lockedRows = all('SELECT * FROM timeline_item WHERE project_id = ? AND locked = 1', [projectId]);
  run('DELETE FROM timeline_item WHERE project_id = ? AND locked = 0', [projectId]);

  let cursor = 0;
  const items: Array<{ track: string; start: number; end: number; shotId: number | null; assetId: number | null; payload: Record<string, unknown> }> = [];

  for (const shot of shots) {
    const dur = shot.duration_ms || shot.tts_duration_ms || 3000;
    items.push({
      track: 'video',
      start: cursor,
      end: cursor + dur,
      shotId: shot.id,
      assetId: shot.lipsync_asset_id ?? shot.preview_asset_id,
      payload: { shot_code: shot.shot_code, engine: shot.render_engine, style: shot.visual_style, status: shot.status }
    });
    if (shot.tts_asset_id) {
      items.push({ track: 'audio_voice', start: cursor, end: cursor + dur, shotId: shot.id, assetId: shot.tts_asset_id, payload: { voice_id: shot.voice_id, emotion: shot.emotion } });
    }
    for (const ov of shot.overlays ?? []) {
      const kind = ov.type;
      items.push({
        track: 'flower',
        start: cursor + (kind === 'title_card' ? Math.round((ov.in ?? 0.5) * 1000) : 200),
        end: Math.min(cursor + dur, cursor + (kind === 'title_card' ? Math.round((ov.out ?? 3.5) * 1000) : 2800)),
        shotId: shot.id,
        assetId: null,
        payload: { type: kind, text: ov.text }
      });
    }
    cursor += dur + SHOT_GAP_MS;
  }

  const totalMs = Math.max(0, cursor - (shots.length ? SHOT_GAP_MS : 0));
  if (totalMs > 0) {
    items.push({ track: 'audio_bgm', start: 0, end: totalMs, shotId: null, assetId: null, payload: { bgm_id: 'bgm_light_talk_01', volume_db: -18 } });
  }

  const cues = buildCues(shots as never[], { offsetMs: 0, gapMs: SHOT_GAP_MS });
  for (const cue of cues) {
    items.push({
      track: cue.kind === 'subtitle' ? 'subtitle' : 'flower',
      start: cue.start_ms,
      end: cue.end_ms,
      shotId: null,
      assetId: null,
      payload: { text: cue.text, kind: cue.kind, speaker: cue.speaker ?? null }
    });
  }

  for (const item of items) {
    run(
      'INSERT INTO timeline_item (project_id, shot_id, track, start_ms, end_ms, asset_id, payload, locked) VALUES (?,?,?,?,?,?,?,0)',
      [projectId, item.shotId, item.track, item.start, item.end, item.assetId, jstr(item.payload)]
    );
  }

  // 回填已存在的锁定行，保持其内容不被覆盖
  for (const row of lockedRows) void row;
}

export function listTimeline(projectId: number): TimelineBundle {
  const items = all('SELECT * FROM timeline_item WHERE project_id = ? ORDER BY track, start_ms', [projectId]).map(mapTimeline);
  const total = items.reduce((n, i) => Math.max(n, i.end_ms), 0);
  const cues: Cue[] = items
    .filter((i) => (i.track === 'subtitle' || i.track === 'flower') && i.payload && (i.payload as Record<string, unknown>).text)
    .map((i) => ({
      start_ms: i.start_ms,
      end_ms: i.end_ms,
      text: String((i.payload as Record<string, unknown>).text),
      kind: ((i.payload as Record<string, unknown>).kind as Cue['kind']) ?? (i.track === 'subtitle' ? 'subtitle' : 'flower'),
      speaker: ((i.payload as Record<string, unknown>).speaker as string | null) ?? null
    }));
  return { items, total_ms: total, cues };
}

export function updateTimelineItem(id: number, patch: Record<string, unknown>): TimelineItem {
  const row = get('SELECT * FROM timeline_item WHERE id = ?', [id]);
  if (!row) throw notFound('时间轴片段不存在');
  const fields: string[] = [];
  const values: unknown[] = [];
  if ('start_ms' in patch) { fields.push('start_ms = ?'); values.push(Math.max(0, Number(patch.start_ms))); }
  if ('end_ms' in patch) { fields.push('end_ms = ?'); values.push(Math.max(0, Number(patch.end_ms))); }
  if ('locked' in patch) { fields.push('locked = ?'); values.push(patch.locked ? 1 : 0); }
  if ('payload' in patch) { fields.push('payload = ?'); values.push(jstr(patch.payload)); }
  if (fields.length === 0) return mapTimeline(row);
  values.push(id);
  run('UPDATE timeline_item SET ' + fields.join(', ') + ' WHERE id = ?', values);

  // 视频/人声轨道的裁剪要回写到镜头时长，合成时才会真正变短
  if ((row.track === 'video' || row.track === 'audio_voice') && row.shot_id && ('start_ms' in patch || 'end_ms' in patch)) {
    const updated = get('SELECT * FROM timeline_item WHERE id = ?', [id]) as Record<string, unknown>;
    const duration = Math.max(500, Number(updated.end_ms) - Number(updated.start_ms));
    run('UPDATE round_shot SET duration_ms = ?, target_duration_ms = ?, updated_at = ? WHERE id = ?', [duration, duration, nowIso(), Number(row.shot_id)]);
    const shot = get('SELECT project_id FROM round_shot WHERE id = ?', [Number(row.shot_id)]);
    if (shot) {
      const projectId = Number(shot.project_id);
      const segs = all('SELECT id FROM segment WHERE project_id = ?', [projectId]);
      for (const seg of segs) {
        const sum = get('SELECT SUM(duration_ms) AS d FROM round_shot WHERE segment_id = ?', [Number(seg.id)]);
        run('UPDATE segment SET duration_ms = ? WHERE id = ?', [Number(sum?.d ?? 0), Number(seg.id)]);
      }
    }
  }
  return mapTimeline(get('SELECT * FROM timeline_item WHERE id = ?', [id]) as Record<string, unknown>);
}

/** 拆分片段：在 at 处切成两段（字幕/花字/人声常用） */
export function splitTimelineItem(id: number, atMs: number): TimelineItem[] {
  const row = get('SELECT * FROM timeline_item WHERE id = ?', [id]);
  if (!row) throw notFound('时间轴片段不存在');
  const start = Number(row.start_ms);
  const end = Number(row.end_ms);
  const at = Math.min(Math.max(atMs, start + 200), end - 200);
  run('UPDATE timeline_item SET end_ms = ? WHERE id = ?', [at, id]);
  const res = run(
    'INSERT INTO timeline_item (project_id, shot_id, track, start_ms, end_ms, asset_id, payload, locked) VALUES (?,?,?,?,?,?,?,0)',
    [Number(row.project_id), row.shot_id ?? null, String(row.track), at, end, row.asset_id ?? null, String(row.payload ?? '{}')]
  );
  return [
    mapTimeline(get('SELECT * FROM timeline_item WHERE id = ?', [id]) as Record<string, unknown>),
    mapTimeline(get('SELECT * FROM timeline_item WHERE id = ?', [res.lastInsertRowid]) as Record<string, unknown>)
  ];
}

/** 复制片段：整体后移自身长度 */
export function duplicateTimelineItem(id: number): TimelineItem {
  const row = get('SELECT * FROM timeline_item WHERE id = ?', [id]);
  if (!row) throw notFound('时间轴片段不存在');
  const start = Number(row.start_ms);
  const end = Number(row.end_ms);
  const shift = Math.max(200, end - start);
  const res = run(
    'INSERT INTO timeline_item (project_id, shot_id, track, start_ms, end_ms, asset_id, payload, locked) VALUES (?,?,?,?,?,?,?,0)',
    [Number(row.project_id), row.shot_id ?? null, String(row.track), end + 1, end + 1 + shift, row.asset_id ?? null, String(row.payload ?? '{}')]
  );
  void start;
  return mapTimeline(get('SELECT * FROM timeline_item WHERE id = ?', [res.lastInsertRowid]) as Record<string, unknown>);
}

export function addTimelineItem(projectId: number, input: { track: string; start_ms: number; end_ms: number; shot_id?: number | null; asset_id?: number | null; payload?: Record<string, unknown> }): TimelineItem {
  const res = run(
    'INSERT INTO timeline_item (project_id, shot_id, track, start_ms, end_ms, asset_id, payload, locked) VALUES (?,?,?,?,?,?,?,0)',
    [projectId, input.shot_id ?? null, input.track, input.start_ms, input.end_ms, input.asset_id ?? null, jstr(input.payload ?? {})]
  );
  return mapTimeline(get('SELECT * FROM timeline_item WHERE id = ?', [res.lastInsertRowid]) as Record<string, unknown>);
}

export function deleteTimelineItem(id: number): void {
  run('DELETE FROM timeline_item WHERE id = ? AND locked = 0', [id]);
}

export interface ComposePlan {
  project_id: number;
  segment_id: number | null;
  total_ms: number;
  width: number;
  height: number;
  fps: number;
  crf: number;
  cues: Cue[];
  shots: Array<{
    shot_id: number;
    shot_code: string;
    start_ms: number;
    duration_ms: number;
    video_asset_id: number | null;
    voice_asset_id: number | null;
    engine: string;
    status: string;
    source: string | null;
    object_key: string | null;
  }>;
}

export function composePlan(projectId: number, segmentId?: number | null, aspectRatio = '16:9'): ComposePlan {
  const project = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!project) throw notFound('项目不存在');
  const shots = loadShots(projectId, segmentId ?? null);
  const preset = COMPOSE_PRESETS[aspectRatio] ?? COMPOSE_PRESETS['16:9'];
  const shotPlans: ComposePlan['shots'] = [];
  let cursor = 0;
  for (const shot of shots) {
    const dur = shot.duration_ms || shot.tts_duration_ms || 3000;
    const videoAssetId = shot.lipsync_asset_id ?? shot.preview_asset_id ?? null;
    const assetRow = videoAssetId ? get('SELECT * FROM asset WHERE id = ?', [videoAssetId]) : undefined;
    shotPlans.push({
      shot_id: shot.id,
      shot_code: shot.shot_code,
      start_ms: cursor,
      duration_ms: dur,
      video_asset_id: videoAssetId,
      voice_asset_id: shot.tts_asset_id,
      engine: shot.render_engine,
      status: shot.status,
      source: assetRow ? String(assetRow.source) : null,
      object_key: assetRow ? String(assetRow.object_key) : null
    });
    cursor += dur + SHOT_GAP_MS;
  }
  const cues = buildCues(shots as never[], { offsetMs: 0, gapMs: SHOT_GAP_MS });
  return {
    project_id: projectId,
    segment_id: segmentId ?? null,
    total_ms: Math.max(0, cursor - (shots.length ? SHOT_GAP_MS : 0)),
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    crf: preset.crf,
    cues,
    shots: shotPlans
  };
}
