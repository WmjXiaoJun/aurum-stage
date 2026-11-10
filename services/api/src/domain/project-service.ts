import type { Project, Segment, Shot, ShotStatus } from '@aurum/core';
import { DEFAULT_NEGATIVE, STYLE_PRESETS, type VisualStyleId, type VarietyType } from '@aurum/core';
import { all, get, jstr, nowIso, run, tx } from '../db/index.js';
import { mapProject, mapSegment, mapShot } from './mappers.js';
import { notFound } from '../http/errors.js';
import { buildTimeline } from './timeline-service.js';

export interface CreateProjectInput {
  name: string;
  variety_type?: VarietyType;
  aspect_ratio?: string;
  fps?: number;
  visual_style?: VisualStyleId;
  style_prompt?: string;
  style_negative?: string;
  privacy_mode?: boolean;
  owner_user_id?: number;
  global_config?: Record<string, unknown>;
}

export function createProject(input: CreateProjectInput): Project {
  const now = nowIso();
  const style: VisualStyleId = input.visual_style ?? 'photoreal';
  const preset = STYLE_PRESETS[style];
  const res = run(
    'INSERT INTO project (name, variety_type, aspect_ratio, fps, style_prompt, style_negative, privacy_mode, visual_style, global_config, owner_user_id, status, segment_cap_sec, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      input.name,
      input.variety_type ?? 'talk_show',
      input.aspect_ratio ?? '16:9',
      input.fps ?? 25,
      input.style_prompt ?? preset.prefix,
      input.style_negative ?? DEFAULT_NEGATIVE,
      input.privacy_mode ? 1 : 0,
      style,
      jstr(input.global_config ?? { bgm_id: 'bgm_light_talk_01', subtitle_style_id: 'st_variety_01' }),
      input.owner_user_id ?? 1,
      'draft',
      300,
      now,
      now
    ]
  );
  const row = get('SELECT * FROM project WHERE id = ?', [res.lastInsertRowid]);
  return mapProject(row as Record<string, unknown>);
}

export function getProject(id: number): Project {
  const row = get('SELECT * FROM project WHERE id = ?', [id]);
  if (!row) throw notFound('项目不存在：' + id);
  return mapProject(row);
}

export function listProjects(): Project[] {
  return all('SELECT * FROM project ORDER BY updated_at DESC').map(mapProject);
}

export function updateProject(id: number, patch: Record<string, unknown>): Project {
  const existing = getProject(id);
  const fields: string[] = [];
  const values: unknown[] = [];
  const allow = ['name', 'variety_type', 'aspect_ratio', 'fps', 'style_prompt', 'style_negative', 'privacy_mode', 'visual_style', 'global_config', 'status', 'style_ref_asset_id', 'language', 'auto_compose'];
  for (const key of allow) {
    if (!(key in patch)) continue;
    fields.push(key + ' = ?');
    const v = patch[key];
    values.push(key === 'privacy_mode' || key === 'auto_compose' ? (v ? 1 : 0) : key === 'global_config' ? jstr(v) : v);
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  values.push(nowIso());
  values.push(id);
  run('UPDATE project SET ' + fields.join(', ') + ' WHERE id = ?', values);
  return getProject(id);
}

export function deleteProject(id: number): void {
  run('DELETE FROM project WHERE id = ?', [id]);
}

export function listSegments(projectId: number): Segment[] {
  return all('SELECT * FROM segment WHERE project_id = ? ORDER BY seq ASC', [projectId]).map(mapSegment);
}

export interface ShotFilter {
  segment_id?: number;
  status?: ShotStatus;
  engine?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

const SHOT_SELECT = 'SELECT s.*, g.seq AS segment_seq, g.title AS segment_title FROM round_shot s JOIN segment g ON g.id = s.segment_id';

export function listShotRows(projectId: number, filter: ShotFilter = {}): Array<Record<string, unknown>> {
  const where: string[] = ['s.project_id = ?'];
  const params: unknown[] = [projectId];
  if (filter.segment_id) { where.push('s.segment_id = ?'); params.push(filter.segment_id); }
  if (filter.status) { where.push('s.status = ?'); params.push(filter.status); }
  if (filter.engine) { where.push('s.render_engine = ?'); params.push(filter.engine); }
  if (filter.search) { where.push('(s.lines LIKE ? OR s.text_clean LIKE ?)'); params.push('%' + filter.search + '%', '%' + filter.search + '%'); }
  let sql = SHOT_SELECT + ' WHERE ' + where.join(' AND ') + ' ORDER BY g.seq ASC, s.seq ASC';
  if (filter.limit) sql += ' LIMIT ' + Number(filter.limit) + ' OFFSET ' + Number(filter.offset ?? 0);
  return all(sql, params);
}

export function getShotRow(shotId: number): Record<string, unknown> {
  const row = get(SHOT_SELECT + ' WHERE s.id = ?', [shotId]);
  if (!row) throw notFound('镜头不存在：' + shotId);
  return row;
}

export function shotsOfSegment(segmentId: number): Shot[] {
  return all(SHOT_SELECT + ' WHERE s.segment_id = ? ORDER BY s.seq ASC', [segmentId]).map((r) => mapShot(r));
}

export function shotCodes(projectId: number): string[] {
  return all<{ shot_code: string }>('SELECT shot_code FROM round_shot WHERE project_id = ?', [projectId]).map((r) => String(r.shot_code));
}

export function touchProject(projectId: number): void {
  run('UPDATE project SET updated_at = ? WHERE id = ?', [nowIso(), projectId]);
}

export function rebuildProjectDerived(projectId: number): void {
  tx(() => {
    rebuildSegmentDurations(projectId);
    buildTimeline(projectId);
    touchProject(projectId);
  });
}

export function rebuildSegmentDurations(projectId: number): void {
  const segRows = all('SELECT * FROM segment WHERE project_id = ?', [projectId]);
  for (const seg of segRows) {
    const shots = all('SELECT * FROM round_shot WHERE segment_id = ? ORDER BY seq ASC', [Number(seg.id)]);
    let total = 0;
    shots.forEach((shot, i) => {
      const tts = shot.tts_duration_ms == null ? null : Number(shot.tts_duration_ms);
      const dur = tts && tts > 0 ? tts + 300 : Number(shot.duration_ms ?? 0) || 3000;
      if (Number(shot.duration_ms) !== dur) {
        run('UPDATE round_shot SET duration_ms = ? WHERE id = ?', [dur, Number(shot.id)]);
      }
      total += dur + (i > 0 ? 200 : 0);
    });
    run('UPDATE segment SET duration_ms = ? WHERE id = ?', [total, Number(seg.id)]);
  }
}
