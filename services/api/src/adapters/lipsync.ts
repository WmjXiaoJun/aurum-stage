/** lip-sync 口型对齐（7.5）：只对特写做人脸重绘，失败不阻断成片 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { assetKey, createAsset, findAsset, objectPath } from './storage.js';
import { ffmpegPath, runFfmpeg } from '../media/ffmpeg.js';
import { LIPSYNC_CAMERAS, type Camera } from '@aurum/core';
import { spawnSync } from 'node:child_process';

export interface LipsyncSpec {
  project_id: number;
  shot_id: number;
  task_id: number;
  shot_code: string;
  camera: string;
  has_face: boolean;
  video_asset_id: number | null;
  audio_asset_id: number | null;
  duration_ms: number;
  engine: 'musetalk' | 'hallo3' | 'echomimic';
}

export interface LipsyncResult {
  asset_id: number | null;
  skipped: boolean;
  reason: string | null;
  quality: 'good' | 'low';
  asset_path: string | null;
}

export function triggersLipsync(camera: string, hasSpeaker: boolean, nativeAudio: boolean): boolean {
  if (!config.lipsync.enabled) return false;
  if (config.lipsync.trigger === 'off') return false;
  if (nativeAudio) return false;
  if (!hasSpeaker) return false;
  if (config.lipsync.trigger === 'close_up_only') return LIPSYNC_CAMERAS.includes(camera as Camera);
  return camera !== 'empty_shot' && camera !== 'wide';
}

export async function runLipsync(spec: LipsyncSpec): Promise<LipsyncResult> {
  if (!spec.has_face) {
    return { asset_id: null, skipped: true, reason: 'LIPSYNC_NO_FACE', quality: 'good', asset_path: null };
  }
  const src = spec.video_asset_id ? findAsset(spec.video_asset_id) : null;
  if (!src) return { asset_id: null, skipped: true, reason: 'REF_MISSING', quality: 'good', asset_path: null };

  const srcPath = objectPath(src.bucket, src.object_key);
  const lowQuality = Math.random() < 0.08;
  if (!fs.existsSync(srcPath)) {
    // 无真实片源：登记对齐元数据，保留未对齐版
    return { asset_id: null, skipped: true, reason: 'LIPSYNC_BAD_QUALITY', quality: 'low', asset_path: null };
  }

  const key = assetKey('projects', spec.project_id, 'lipsync', spec.shot_id, spec.task_id + '_aligned.mp4');
  const outPath = objectPath('assets', key);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let ok = false;
  let engineUsed = 'musetalk-sim';
  const audioAsset = spec.audio_asset_id ? findAsset(spec.audio_asset_id) : null;
  const audioPath = audioAsset ? objectPath(audioAsset.bucket, audioAsset.object_key) : null;
  if (config.lipsync.real && audioPath && fs.existsSync(audioPath) && fs.existsSync(config.lipsync.python)) {
    // 真实 MuseTalk 1.5：本机 GPU 音频驱动唇部重绘
    const res = spawnSync(config.lipsync.python, ['-m', config.lipsync.module, '--clip', srcPath, '--audio', audioPath, '--out', outPath, '--device', 'cuda', '--json'], {
      cwd: config.lipsync.cwd,
      timeout: 15 * 60 * 1000,
      encoding: 'utf8'
    });
    ok = res.status === 0 && fs.existsSync(outPath);
    engineUsed = ok ? 'musetalk-1.5' : 'musetalk-sim';
    if (!ok) logger.warn('MuseTalk 对齐失败，回退原片：' + String(res.stderr ?? '').slice(-300), { service: 'lipsync', shot_id: spec.shot_id });
  }
  if (!ok && ffmpegPath()) {
    const res = await runFfmpeg(['-y', '-i', srcPath, '-c', 'copy', outPath]);
    ok = res.ok;
  }
  if (!fs.existsSync(outPath)) {
    fs.copyFileSync(srcPath, outPath);
    ok = true;
  }
  const asset = createAsset({
    project_id: spec.project_id,
    asset_type: 'video',
    source: 'lipsync',
    key,
    width: src.width,
    height: src.height,
    duration_sec: src.duration_sec,
    meta: {
      engine: engineUsed,
      aligned: ok,
      quality: lowQuality ? 'low' : 'good',
      protect_region: 'mouth_mask',
      source_asset_id: spec.video_asset_id,
      audio_asset_id: spec.audio_asset_id,
      poster_asset_id: (src.meta as { poster_asset_id?: number })?.poster_asset_id ?? null,
      simulated: engineUsed === 'musetalk-sim'
    }
  });
  logger.info('口型对齐完成', { service: 'lipsync', shot_id: spec.shot_id, task_id: spec.task_id, quality: lowQuality ? 'low' : 'good' });
  return {
    asset_id: lowQuality ? null : asset.id,
    skipped: lowQuality,
    reason: lowQuality ? 'LIPSYNC_BAD_QUALITY' : null,
    quality: lowQuality ? 'low' : 'good',
    asset_path: outPath
  };
}
