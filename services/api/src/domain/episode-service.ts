/** 多期：一季多期，每期可独立模板/风格/语言，段落挂到 episode 下 */
import { all, get, nowIso, run } from '../db/index.js';
import { notFound } from '../http/errors.js';

export interface EpisodeRow {
  id: number; project_id: number; seq: number; title: string; brief: string | null;
  template_key: string | null; visual_style: string; language: string; status: string; created_at: string;
}

export function listEpisodes(projectId: number): EpisodeRow[] {
  return all('SELECT * FROM season_episode WHERE project_id = ? ORDER BY seq', [projectId]) as unknown as EpisodeRow[];
}

export function getEpisode(id: number): EpisodeRow {
  const row = get('SELECT * FROM season_episode WHERE id = ?', [id]);
  if (!row) throw notFound('期不存在');
  return row as unknown as EpisodeRow;
}

export function createEpisode(projectId: number, input: { title?: string; brief?: string; template_key?: string; visual_style?: string; language?: string }): EpisodeRow {
  const last = get('SELECT MAX(seq) AS s FROM season_episode WHERE project_id = ?', [projectId]);
  const seq = Number(last?.s ?? 0) + 1;
  const res = run('INSERT INTO season_episode (project_id, seq, title, brief, template_key, visual_style, language, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
    projectId, seq, input.title ?? ('第 ' + seq + ' 期'), input.brief ?? '', input.template_key ?? null,
    input.visual_style ?? 'photoreal', input.language ?? 'zh', 'draft', nowIso()
  ]);
  return getEpisode(Number(res.lastInsertRowid));
}

export function updateEpisode(id: number, patch: Record<string, unknown>): EpisodeRow {
  const row = getEpisode(id);
  const allowed = ['title', 'brief', 'template_key', 'visual_style', 'language', 'status'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) { sets.push(key + ' = ?'); vals.push(patch[key]); }
  }
  if (sets.length) run('UPDATE season_episode SET ' + sets.join(', ') + ' WHERE id = ?', [...vals, id]);
  void row;
  return getEpisode(id);
}

/** 复刻一期：段与镜头整体复制，可换风格/语言 */
export function cloneEpisode(id: number, opts: { visual_style?: string; language?: string; title?: string } = {}): EpisodeRow {
  const src = getEpisode(id);
  const copy = createEpisode(Number(src.project_id), {
    title: opts.title ?? (src.title + ' · 复刻'),
    brief: src.brief ?? '',
    template_key: src.template_key ?? undefined,
    visual_style: opts.visual_style ?? src.visual_style,
    language: opts.language ?? src.language
  });
  const segments = all('SELECT * FROM segment WHERE project_id = ? AND episode_id = ? ORDER BY seq', [src.project_id, id]);
  for (const seg of segments) {
    const segRes = run('INSERT INTO segment (project_id, episode_id, seq, segment_type, title, default_engine, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?)', [
      src.project_id, copy.id, Number(seg.seq), String(seg.segment_type), String(seg.title), String(seg.default_engine), Number(seg.duration_ms), nowIso()
    ]);
    const shots = all('SELECT * FROM round_shot WHERE segment_id = ? ORDER BY seq', [Number(seg.id)]);
    for (const sh of shots) {
      run('INSERT INTO round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, lang, text_local, emotion, emotion_instruction, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        src.project_id, segRes.lastInsertRowid, Number(sh.seq), String(sh.shot_code), sh.speaker_role_id ?? null, sh.speaker_name ?? null, String(sh.camera ?? 'medium_shot'),
        String(sh.lines ?? '[]'), String(sh.text_clean ?? ''), sh.lang ?? null, sh.text_local ?? null, sh.emotion ?? null, sh.emotion_instruction ?? null, String(sh.performance_tags ?? '[]'),
        String(sh.visual_prompt ?? ''), String(sh.negative_prompt ?? ''), String(sh.overlays ?? '[]'), String(sh.render_engine ?? 'muse_api'),
        opts.visual_style ?? String(sh.visual_style ?? src.visual_style), String(sh.engine_params ?? '{}'), String(sh.tts_engine ?? 'edge-tts'), sh.voice_id ?? null,
        Number(sh.tts_speed ?? 1), Number(sh.lipsync_required ?? 0), Number(sh.native_audio ?? 0), Number(sh.privacy ?? 0), 1, 'empty',
        Number(sh.duration_ms ?? 3000), Number(sh.target_duration_ms ?? 3000), nowIso(), nowIso()
      ]);
    }
  }
  return copy;
}
