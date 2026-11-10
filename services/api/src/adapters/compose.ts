/** 合成导出（M5）：归一化 → 拼接 → 混音 → ASS 字幕花字压制。无 FFmpeg 时退化为清单导出。 */
import fs from 'node:fs';
import path from 'node:path';
import type { Asset } from '@aurum/core';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { all, get, jstr, nowIso, run } from '../db/index.js';
import { assetKey, createAsset, findAsset, objectPath } from './storage.js';
import { ffmpegPath, burnAss, concatClips, mixAudio, normalizeClip, renderCardClip, overlayHuazi } from '../media/ffmpeg.js';
import { pickHuazi, renderHuazi } from '../media/huazi.js';
import { toAss, toSrt } from '../media/subtitles.js';
import { composePlan, type ComposePlan } from '../domain/timeline-service.js';
import { encodeWav, synthBgmPad } from '../media/wav.js';
import { ApiError, notFound } from '../http/errors.js';

export interface ComposeResult {
  mode: 'mp4' | 'manifest';
  video_asset_id: number | null;
  subtitle_asset_id: number;
  ass_asset_id: number;
  total_ms: number;
  duration_sec: number;
  warnings: string[];
  output_path: string | null;
  manifest: Record<string, unknown>;
}

function assetPath(assetId: number | null): string | null {
  if (!assetId) return null;
  const asset: Asset | null = findAsset(assetId);
  if (!asset) return null;
  const p = objectPath(asset.bucket, asset.object_key);
  return fs.existsSync(p) ? p : null;
}

function projectRow(projectId: number): Record<string, unknown> {
  const row = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!row) throw notFound('项目不存在');
  return row;
}

export async function composeProject(input: {
  project_id: number;
  segment_id?: number | null;
  task_id?: number | null;
  bgm?: boolean;
}): Promise<ComposeResult> {
  const project = projectRow(input.project_id);
  const plan = composePlan(input.project_id, input.segment_id ?? null, String(project.aspect_ratio ?? '16:9'));
  const warnings: string[] = [];

  if (plan.shots.length === 0) {
    throw new ApiError('SEGMENT_EMPTY', '该范围内没有可合成的镜头');
  }

  const srt = toSrt(plan.cues);
  const ass = toAss(plan.cues, { width: plan.width, height: plan.height, styleId: String(project.visual_style ?? 'photoreal') });
  const baseKey = assetKey('projects', input.project_id, 'export', input.task_id ?? ('seg' + (input.segment_id ?? 'all')));
  const srtKey = baseKey + '/subs.srt';
  const assKey = baseKey + '/subs_variety.ass';
  fs.mkdirSync(path.dirname(objectPath('assets', srtKey)), { recursive: true });
  fs.writeFileSync(objectPath('assets', srtKey), srt, 'utf8');
  fs.writeFileSync(objectPath('assets', assKey), ass, 'utf8');
  const srtAsset = createAsset({ project_id: input.project_id, asset_type: 'subtitle', source: 'compose', key: srtKey, meta: { kind: 'srt', cues: plan.cues.length } });
  const assAsset = createAsset({ project_id: input.project_id, asset_type: 'subtitle', source: 'compose', key: assKey, meta: { kind: 'ass', cues: plan.cues.length } });

  const manifest: Record<string, unknown> = {
    project_id: input.project_id,
    segment_id: input.segment_id ?? null,
    total_ms: plan.total_ms,
    width: plan.width,
    height: plan.height,
    fps: plan.fps,
    shots: plan.shots,
    cues: plan.cues,
    generated_at: nowIso()
  };

  if (!ffmpegPath()) {
    const manifestKey = baseKey + '/compose-manifest.json';
    fs.writeFileSync(objectPath('assets', manifestKey), JSON.stringify(manifest, null, 2), 'utf8');
    createAsset({ project_id: input.project_id, asset_type: 'text', source: 'compose', key: manifestKey, meta: { kind: 'manifest' } });
    warnings.push('未检测到 FFmpeg：已输出 SRT/ASS 与合成清单，安装 FFmpeg 后可一键出片');
    return {
      mode: 'manifest',
      video_asset_id: null,
      subtitle_asset_id: srtAsset.id,
      ass_asset_id: assAsset.id,
      total_ms: plan.total_ms,
      duration_sec: Math.round(plan.total_ms / 100) / 10,
      warnings,
      output_path: null,
      manifest
    };
  }

  // 1) 逐镜头得到可拼接片段（真实产物优先，否则生成导播代理卡）
  const clipPaths: string[] = [];
  for (const shot of plan.shots) {
    const sourcePath = assetPath(shot.video_asset_id);
    if (sourcePath && /\.(mp4|mov|webm|mkv)$/i.test(sourcePath)) {
      // 云端 muse-video-ext 固定约 10s、本地片段规格也可能不同：统一归一化并裁到镜头时长
      // 注意：shot_code 可能重复（同一批次全用同一编号），必须带 shot_id 区分，否则会互相覆盖
      const normKey = baseKey + '/norm/' + shot.shot_id + '_' + shot.shot_code + '.mp4';
      const normAbs = objectPath('assets', normKey);
      const norm = await normalizeClip({
        src: sourcePath,
        out: normAbs,
        width: plan.width,
        height: plan.height,
        fps: plan.fps,
        durationMs: shot.duration_ms,
        crf: plan.crf
      });
      if (norm.ok) clipPaths.push(normAbs);
      else {
        warnings.push('镜头 ' + shot.shot_code + ' 归一化失败，按原片拼接：' + (norm.error ?? ''));
        clipPaths.push(sourcePath);
      }
      continue;
    }
    const voicePath = assetPath(shot.voice_asset_id);
    const clipKey = baseKey + '/clips/' + shot.shot_id + '_' + shot.shot_code + '.mp4';
    const clipAbs = objectPath('assets', clipKey);
    const shotRow = get('SELECT * FROM round_shot WHERE id = ?', [shot.shot_id]);
    const res = await renderCardClip({
      outPath: clipAbs,
      width: plan.width,
      height: plan.height,
      durationMs: shot.duration_ms,
      audioPath: voicePath,
      title: shot.shot_code + '  ·  ' + String(shotRow?.speaker_name ?? ''),
      subtitle: String(shotRow?.text_clean ?? shotRow?.visual_prompt ?? '').slice(0, 80),
      accent: shot.engine === 'muse_api' ? '#E8D6A8' : '#7FD3CE',
      fps: plan.fps
    });
    if (res.ok && fs.existsSync(clipAbs)) {
      clipPaths.push(clipAbs);
    } else {
      warnings.push('镜头 ' + shot.shot_code + ' 片段生成失败：' + (res.error ?? '未知错误'));
    }
  }

  if (clipPaths.length === 0) {
    throw new ApiError('COMPOSE_CONCAT_FAIL', '没有可拼接的片段', { warnings });
  }

  const concatPath = objectPath('assets', baseKey + '/concat.mp4');
  const concatRes = await concatClips(clipPaths, concatPath);
  if (!concatRes.ok) throw new ApiError('COMPOSE_CONCAT_FAIL', '片段拼接失败：' + (concatRes.error ?? ''), { warnings });

  // 2) BGM 混音
  let mixedPath = concatPath;
  if (input.bgm !== false) {
    const bgmKey = baseKey + '/bgm.wav';
    const bgmAbs = objectPath('assets', bgmKey);
    const wav = encodeWav(synthBgmPad(plan.total_ms + 800));
    fs.writeFileSync(bgmAbs, wav);
    const mixedAbs = objectPath('assets', baseKey + '/mixed.mp4');
    await mixAudio(concatPath, bgmAbs, mixedAbs, config.compose.bgmVolumeDb);
    if (fs.existsSync(mixedAbs)) mixedPath = mixedAbs;
  }

  // 3) 字幕花字压制
  const finalAbs = objectPath('assets', baseKey + '/final.mp4');
  const burn = await burnAss(mixedPath, objectPath('assets', assKey), finalAbs);
  let huaziCount = 0;
  let outWithHuazi: string | null = null;
  try {
    const items = pickHuazi(plan.cues, 6);
    if (items.length && burn.ok) {
      const rendered: Array<{ path: string; start_ms: number; end_ms: number }> = [];
      for (let i = 0; i < items.length; i++) {
        const hzPath = objectPath('assets', baseKey + '/huazi/' + i + '.png');
        const ok = await renderHuazi(items[i].text, items[i].style, hzPath);
        if (ok) rendered.push({ path: hzPath, start_ms: items[i].start_ms, end_ms: items[i].end_ms });
      }
      if (rendered.length) {
        const huaziOut = objectPath('assets', baseKey + '/final_huazi.mp4');
        const r = await overlayHuazi(finalAbs, rendered, huaziOut, plan.width, plan.height);
        if (r.ok && fs.existsSync(huaziOut)) { outWithHuazi = huaziOut; huaziCount = rendered.length; }
      }
    }
  } catch { /* 花字失败不影响字幕成片 */ }
  if (!burn.ok) warnings.push('ASS 字幕压制失败，已保留无字幕版：' + (burn.error ?? ''));
  const outAbs = outWithHuazi ?? (burn.ok && fs.existsSync(finalAbs) ? finalAbs : mixedPath);

  // 成片归档：按「项目名-vN」命名一份到 exports 目录，方便直接取片
  let deliverable: string | null = null;
  try {
    const projectRow = get('SELECT name FROM project WHERE id = ?', [input.project_id]);
    const prev = get('SELECT COUNT(*) AS n FROM compose_export WHERE project_id = ?', [input.project_id]);
    const version = Number(prev?.n ?? 0) + 1;
    const slug = String(projectRow?.name ?? ('project-' + input.project_id)).replace(/[\/:*?"<>|s]+/g, '-').slice(0, 40);
    fs.mkdirSync(config.exportDir, { recursive: true });
    deliverable = path.join(config.exportDir, slug + '-v' + version + '.mp4');
    fs.copyFileSync(outAbs, deliverable);
  } catch { deliverable = null; }

  (manifest as Record<string, unknown>).huazi = huaziCount;
  const finalKey = outAbs.split(path.sep).slice(outAbs.split(path.sep).indexOf('assets') + 1).join('/');
  (manifest as Record<string, unknown>).deliverable = deliverable;
  const videoAsset = createAsset({
    project_id: input.project_id,
    asset_type: 'video',
    source: 'compose',
    key: finalKey,
    width: plan.width,
    height: plan.height,
    duration_sec: Math.round(plan.total_ms / 100) / 10,
    meta: { kind: 'final', cues: plan.cues.length, subtitles: true, huazi: huaziCount, bgm: input.bgm !== false, shots: plan.shots.length, deliverable }
  });
  const manifestKey = baseKey + '/compose-manifest.json';
  fs.writeFileSync(objectPath('assets', manifestKey), JSON.stringify(manifest, null, 2), 'utf8');
  createAsset({ project_id: input.project_id, asset_type: 'text', source: 'compose', key: manifestKey, meta: { kind: 'manifest' } });

  run('UPDATE project SET status = ?, updated_at = ? WHERE id = ?', ['composed', nowIso(), input.project_id]);
  logger.info('成片合成完成', { service: 'compose', project_id: input.project_id, duration_sec: Math.round(plan.total_ms / 100) / 10 });

  return {
    mode: 'mp4',
    video_asset_id: videoAsset.id,
    subtitle_asset_id: srtAsset.id,
    ass_asset_id: assAsset.id,
    total_ms: plan.total_ms,
    duration_sec: Math.round(plan.total_ms / 100) / 10,
    warnings,
    output_path: outAbs,
    manifest
  };
}

export function listExports(projectId: number): Array<Record<string, unknown>> {
  return all('SELECT * FROM compose_export WHERE project_id = ? ORDER BY id DESC', [projectId]);
}

export function recordExport(input: {
  project_id: number;
  segment_id?: number | null;
  task_id?: number | null;
  status: string;
  duration_ms: number;
  video_asset_id: number | null;
  subtitle_asset_id: number | null;
  ass_asset_id: number | null;
  manifest: Record<string, unknown>;
  error_code?: string | null;
  error_msg?: string | null;
}): number {
  const res = run(
    'INSERT INTO compose_export (project_id, segment_id, task_id, status, duration_ms, video_asset_id, subtitle_asset_id, ass_asset_id, manifest, error_code, error_msg, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [input.project_id, input.segment_id ?? null, input.task_id ?? null, input.status, input.duration_ms, input.video_asset_id, input.subtitle_asset_id, input.ass_asset_id, jstr(input.manifest), input.error_code ?? null, input.error_msg ?? null, nowIso()]
  );
  return res.lastInsertRowid;
}
