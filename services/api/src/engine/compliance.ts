/**
 * 4.1.1 段时长硬约束 + 规范化校验 + 镜头/段时长复算。
 * 判定规则：单镜头 2–8s 仅警告；段累计 >300s 为错误并阻断提交；≥280s 进入预警。
 */
import {
  SEGMENT_CAP_MS,
  SEGMENT_NEAR_MS,
  SHOT_DURATION_WARN_MAX_MS,
  SHOT_DURATION_WARN_MIN_MS,
  type ShotStatus
} from '@aurum/core';

export interface ShotDurationLike {
  id: number;
  segment_id: number;
  seq: number;
  camera: string;
  tts_duration_ms: number | null;
  duration_ms: number;
  target_duration_ms?: number | null;
  native_audio?: boolean;
}

export interface SegmentCompliance {
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

import { SHOT_GAP_MS } from '@aurum/core';
export { SHOT_GAP_MS };

export function shotEffectiveMs(shot: ShotDurationLike): number {
  if (shot.tts_duration_ms && shot.tts_duration_ms > 0) return shot.tts_duration_ms + 300;
  if (shot.duration_ms && shot.duration_ms > 0) return shot.duration_ms;
  if (shot.target_duration_ms && shot.target_duration_ms > 0) return shot.target_duration_ms;
  return 3000;
}

export function segmentDuration(shots: ShotDurationLike[]): number {
  if (shots.length === 0) return 0;
  const sum = shots.reduce((n, s) => n + shotEffectiveMs(s), 0);
  return sum + SHOT_GAP_MS * Math.max(0, shots.length - 1);
}

export function evaluateSegment(input: {
  segment_id: number;
  seq: number;
  title: string;
  shots: ShotDurationLike[];
  capSec?: number;
}): SegmentCompliance {
  const capSec = input.capSec ?? SEGMENT_CAP_MS / 1000;
  const capMs = capSec * 1000;
  const nearMs = (SEGMENT_NEAR_MS / SEGMENT_CAP_MS) * capMs;
  const duration = segmentDuration(input.shots);
  const exceed = duration > capMs;
  const near = !exceed && duration >= nearMs;
  const ratio = duration / capMs;
  let splitSuggestion: string | null = null;
  if (exceed) {
    // 在超限位置附近找镜头边界作为拆分点
    let acc = 0;
    let boundary = 0;
    for (let i = 0; i < input.shots.length; i++) {
      acc += shotEffectiveMs(input.shots[i]) + (i > 0 ? SHOT_GAP_MS : 0);
      if (acc > capMs) {
        boundary = i;
        break;
      }
    }
    splitSuggestion = boundary > 0
      ? '建议在第 ' + boundary + ' 与第 ' + (boundary + 1) + ' 个镜头之间拆分（前段约 ' + Math.round(acc / 1000) + ' 秒）'
      : '建议删减前几个镜头或缩短台词';
  }
  return {
    segment_id: input.segment_id,
    seq: input.seq,
    title: input.title,
    duration_ms: duration,
    duration_sec: Math.round(duration / 100) / 10,
    cap_sec: capSec,
    remaining_sec: Math.round((capMs - duration) / 100) / 10,
    near_cap: near,
    exceed,
    exceed_sec: exceed ? Math.round((duration - capMs) / 100) / 10 : 0,
    shots: input.shots.length,
    split_suggestion: splitSuggestion,
    status: exceed ? 'exceed' : near ? 'near' : 'ok'
  };
}

export function shotWarnings(ms: number): string[] {
  const out: string[] = [];
  if (ms < SHOT_DURATION_WARN_MIN_MS) out.push('短于 2s，观众来不及读');
  if (ms > SHOT_DURATION_WARN_MAX_MS) out.push('长于 8s，建议拆镜或压台词');
  return out;
}

const STATUS_ORDER: ShotStatus[] = ['empty', 'queued', 'rendering', 'generated', 'reviewed', 'locked'];

export function deriveShotStatus(current: ShotStatus, target: ShotStatus): ShotStatus {
  if (current === 'locked' && target !== 'locked') return current;
  const ci = STATUS_ORDER.indexOf(current);
  const ti = STATUS_ORDER.indexOf(target);
  return ti > ci ? target : current;
}
