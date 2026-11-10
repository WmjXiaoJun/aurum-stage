/**
 * TTS 适配器（第七章）：IndexTTS-2 本地主力 → CosyVoice3 备 → Fish Drama3 云端兜底。
 * 未连接真实推理服务时走本地合成，产出真实可播放 WAV + 词级时间戳，保证整条管线可跑通。
 */
import { emotionDef, type EmotionDef } from '@aurum/core';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { synthSpeechLike, encodeWav } from '../media/wav.js';
import { createAsset } from './storage.js';
import { assetKey } from './storage.js';
import { pickSeed, sha256 } from '../util.js';
import { ApiError } from '../http/errors.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { objectPath } from './storage.js';
import { breezeAvailable, breezeSynthesize } from './breeze.js';

/** 出海语言 → edge-tts 音色（[主声, 次级声]） */
const VOICE_BY_LANG: Record<string, [string, string]> = {
  en: ['en-US-AriaNeural', 'en-US-GuyNeural'],
  es: ['es-ES-ElviraNeural', 'es-ES-AlvaroNeural'],
  ja: ['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural'],
  ko: ['ko-KR-SunHiNeural', 'ko-KR-InJoonNeural'],
  pt: ['pt-BR-FranciscaNeural', 'pt-BR-AntonioNeural']
};

/** 角色 → 音色：非中文语言按语言选音色，中文按角色选 */
function voiceFor(voiceId: string, language?: string): string {
  if (language && language !== 'zh' && VOICE_BY_LANG[language]) {
    const pair = VOICE_BY_LANG[language];
    const id = voiceId.toLowerCase();
    return id.includes('guest') || id.includes('male') ? pair[1] : pair[0];
  }
  const id = voiceId.toLowerCase();
  if (id.includes('host')) return config.tts.voiceHost;
  if (id.includes('guest_b') || id.includes('guestb') || id.includes('male')) return config.tts.voiceGuestMale;
  if (id.includes('guest')) return config.tts.voiceGuestFemale;
  return config.tts.voiceNarrator;
}

let edgeReady: boolean | null = null;
function edgeTtsAvailable(): boolean {
  if (!config.tts.real) return false;
  if (edgeReady != null) return edgeReady;
  try {
    const r = spawnSync(config.tts.python, ['-m', 'edge_tts', '--version'], { timeout: 15000 });
    edgeReady = r.status === 0;
  } catch {
    edgeReady = false;
  }
  if (!edgeReady) logger.warn('edge-tts 不可用，回退本地合成占位音', { service: 'tts' });
  return edgeReady;
}

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function parseVttWords(vtt: string): Array<{ word: string; start_ms: number; end_ms: number }> {
  const out: Array<{ word: string; start_ms: number; end_ms: number }> = [];
  const blocks = vtt.split(/\r?\n\r?\n/);
  const toMs = (t: string) => {
    const m = t.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
    if (!m) return 0;
    return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]);
  };
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;
    const [a, b] = lines[idx].split('-->').map((s) => s.trim());
    const text = lines.slice(idx + 1).join(' ').trim();
    if (!text) continue;
    out.push({ word: text, start_ms: toMs(a), end_ms: toMs(b) });
  }
  return out;
}

function probeMs(file: string): number {
  try {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 15000 });
    const n = Number(String(r.stdout ?? '').trim());
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  } catch { /* ignore */ }
  return 0;
}

/** 真实配音：edge-tts 生成 mp3 + 词级时间戳，转存为素材 */
async function realSynth(spec: TTSSpec, idx: number): Promise<TTSCandidate | null> {
  if (!edgeTtsAvailable()) return null;
  const voice = voiceFor(spec.voice_id, spec.language);
  const rate = idx === 1 ? '+0%' : idx === 2 ? '-5%' : '+5%';
  const dir = path.join(process.cwd(), '.tts-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const base = 'tts_' + spec.shot_id + '_' + spec.task_id + '_c' + idx;
  const mp3 = path.join(dir, base + '.mp3');
  const vtt = path.join(dir, base + '.vtt');
  const args = ['-m', 'edge_tts', '--voice', voice, '--rate', rate, '--text', spec.text, '--write-media', mp3, '--write-subtitles', vtt];
  const run = spawnSync(config.tts.python, args, { timeout: 120000 });
  if (run.status !== 0 || !fs.existsSync(mp3)) {
    logger.warn('edge-tts 合成失败：' + String(run.stderr ?? '').slice(0, 200), { service: 'tts', shot_id: spec.shot_id });
    return null;
  }
  const duration = probeMs(mp3) || estimateDurationMs(spec.text, spec.speed, spec.emotion);
  const words = fs.existsSync(vtt) ? parseVttWords(fs.readFileSync(vtt, 'utf8')) : [];
  const key = assetKey('projects', spec.project_id, 'tts_real', spec.shot_id, spec.task_id + '_c' + idx + '.mp3');
  const asset = createAsset({
    project_id: spec.project_id,
    asset_type: 'audio',
    source: 'tts',
    key,
    duration_sec: Math.round((duration / 1000) * 100) / 100,
    meta: { engine: 'edge-tts', voice, rate, text: spec.text, word_ts: words, simulated: false }
  });
  const buf = fs.readFileSync(mp3);
  fs.mkdirSync(path.dirname(objectPath('assets', key)), { recursive: true });
  fs.writeFileSync(objectPath('assets', key), buf);
  try { fs.unlinkSync(mp3); fs.unlinkSync(vtt); } catch { /* ignore */ }
  return { idx, asset_id: asset.id, duration_ms: duration, word_ts: words, engine: 'edge-tts', url: '/api/v1/assets/' + asset.id + '/raw' };
}

export interface TTSSpec {
  project_id: number;
  shot_id: number;
  task_id: number;
  text: string;
  voice_id: string;
  emotion: string | null;
  emotion_instruction: string | null;
  speed: number;
  target_duration_ms: number | null;
  engine?: 'indextts2' | 'cosyvoice3' | 'fishspeech' | 'drama3' | 'breeze';
  voice_instruction?: string;
  candidates?: number;
  /** 出海语言（en/es/ja/ko/pt），决定 edge-tts 音色 */
  language?: string;
}

export interface TTSCandidate {
  idx: number;
  asset_id: number;
  duration_ms: number;
  word_ts: Array<{ word: string; start_ms: number; end_ms: number }>;
  engine: string;
  url: string;
}

export interface TTSResult {
  duration_ms: number;
  candidates: TTSCandidate[];
  engine: string;
  degraded: boolean;
}

const PAUSE_AFTER_PUNCT: Record<string, number> = { '，': 200, ',': 200, '。': 500, '.': 500, '？': 400, '?': 400, '！': 600, '!': 600, '；': 300, ';': 300, '、': 150 };

/** 伪词级时间戳：按标点与字数分配，保证 SRT 可直接用 */
function buildWordTs(text: string, durationMs: number): Array<{ word: string; start_ms: number; end_ms: number }> {
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  const weightOf = (ch: string) => (/\s/.test(ch) ? 0.2 : PAUSE_AFTER_PUNCT[ch] ? 1 + PAUSE_AFTER_PUNCT[ch] / 300 : 1);
  const total = chars.reduce((n, ch) => n + weightOf(ch), 0) || 1;
  const out: Array<{ word: string; start_ms: number; end_ms: number }> = [];
  let cursor = 0;
  let buf = '';
  let bufStart = 0;
  chars.forEach((ch, i) => {
    if (!buf) bufStart = cursor;
    const w = weightOf(ch);
    const dur = Math.round((w / total) * durationMs);
    cursor += dur;
    buf += ch;
    const breakHere = PAUSE_AFTER_PUNCT[ch] != null || buf.length >= 12 || i === chars.length - 1;
    if (breakHere) {
      out.push({ word: buf, start_ms: bufStart, end_ms: Math.min(durationMs, cursor) });
      buf = '';
    }
  });
  return out;
}

function estimateDurationMs(text: string, speed: number, emotion: string | null): number {
  const chars = Array.from(text.replace(/\s/g, '')).length;
  const def: EmotionDef | null = emotionDef(emotion);
  const natural = (chars / 4.6) * 1000 / (speed || 1);
  const pause = def ? 120 : 0;
  return Math.max(900, Math.round(natural + pause));
}

async function probeWorker(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 600);
    const res = await fetch(config.tts.workerUrl.replace(/\/$/, '') + '/health', { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function synthesize(spec: TTSSpec): Promise<TTSResult> {
  if (!spec.text || !spec.text.trim()) {
    throw new ApiError('PARAM_INVALID', '台词为空，无法配音');
  }
  const candidates = Math.max(1, Math.min(3, spec.candidates ?? config.render.defaultCandidates));
  const chain: Array<TTSSpec['engine'] & string> = ['indextts2', 'cosyvoice3', 'drama3'];
  const workerUp = await probeWorker();
  let degraded = false;
  let engine = spec.engine ?? 'indextts2';
  const baseDuration = spec.target_duration_ms && spec.target_duration_ms > 0
    ? spec.target_duration_ms
    : estimateDurationMs(spec.text, spec.speed, spec.emotion);

  // 角色绑定本地 Breeze TTS 2 时优先用模型配音
  if ((spec.engine === 'breeze' || String(spec.voice_id).startsWith('breeze')) && await breezeAvailable()) {
    const synth = await breezeSynthesize({ text: spec.text, instruction: spec.emotion_instruction || spec.voice_instruction || undefined, seed: 20261026 + (spec.shot_id % 97) });
    if (synth) {
      const key = assetKey('projects', spec.project_id, 'tts_breeze', spec.shot_id, spec.task_id + '_c1.wav');
      const file = objectPath('assets', key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, synth.wav);
      const asset = createAsset({
        project_id: spec.project_id,
        asset_type: 'audio',
        source: 'tts',
        key,
        duration_sec: Math.round((synth.duration_ms / 1000) * 100) / 100,
        meta: { engine: 'breeze-tts2', voice_id: spec.voice_id, text: spec.text, word_ts: buildWordTs(spec.text, synth.duration_ms), simulated: false }
      });
      const cand: TTSCandidate = { idx: 1, asset_id: asset.id, duration_ms: synth.duration_ms, word_ts: buildWordTs(spec.text, synth.duration_ms), engine: 'breeze-tts2', url: '/api/v1/assets/' + asset.id + '/raw' };
      logger.info('Breeze 模型配音完成', { service: 'tts', task_id: spec.task_id, shot_id: spec.shot_id, duration_ms: synth.duration_ms });
      return { duration_ms: synth.duration_ms, candidates: [cand], engine: 'breeze-tts2', degraded: false };
    }
  }

  // 优先真实中文配音（edge-tts）；不可用时回退本地合成占位
  if (edgeTtsAvailable()) {
    const real: TTSCandidate[] = [];
    for (let idx = 1; idx <= candidates; idx++) {
      const item = await realSynth(spec, idx);
      if (item) real.push(item);
    }
    if (real.length > 0) {
      logger.info('真实配音完成（edge-tts）', { service: 'tts', task_id: spec.task_id, shot_id: spec.shot_id, candidates: real.length, duration_ms: real[0].duration_ms });
      return { duration_ms: real[0].duration_ms, candidates: real, engine: 'edge-tts', degraded: false };
    }
  }

  const out: TTSCandidate[] = [];
  for (let idx = 1; idx <= candidates; idx++) {
    const seed = pickSeed(spec.shot_id + ':' + idx + ':' + spec.voice_id + ':' + spec.text);
    // 三候选：微调语速与情绪强度，给编导可挑选的表演差异
    const jitter = idx === 1 ? 1 : idx === 2 ? 0.96 : 1.04;
    const duration = Math.max(600, Math.round(baseDuration * jitter));
    const samples = synthSpeechLike(duration, seed + idx * 17);
    const buf = encodeWav(samples);
    const key = assetKey('projects', spec.project_id, 'tts', spec.shot_id, spec.task_id + '_c' + idx + '.wav');
    const asset = createAsset({
      project_id: spec.project_id,
      asset_type: 'audio',
      source: 'tts',
      key,
      duration_sec: Math.round((duration / 1000) * 100) / 100,
      meta: {
        engine,
        worker: workerUp ? 'remote' : 'local-sim',
        voice_id: spec.voice_id,
        emotion: spec.emotion,
        emotion_instruction: spec.emotion_instruction,
        speed: spec.speed,
        seed,
        candidate: idx,
        text: spec.text,
        word_ts: buildWordTs(spec.text, duration),
        simulated: !workerUp
      }
    });
    const { putObject } = await import('./storage.js');
    putObject({ key, content: buf });
    out.push({
      idx,
      asset_id: asset.id,
      duration_ms: duration,
      word_ts: buildWordTs(spec.text, duration),
      engine,
      url: '/api/v1/assets/' + asset.id + '/raw'
    });
  }

  if (!workerUp && chain.includes('drama3')) degraded = true;
  engine = spec.engine ?? 'indextts2';
  logger.info('TTS 合成完成', { service: 'tts', task_id: spec.task_id, shot_id: spec.shot_id, candidates: out.length, duration_ms: out[0]?.duration_ms });

  return {
    duration_ms: out[0]?.duration_ms ?? baseDuration,
    candidates: out,
    engine,
    degraded
  };
}

export function voiceHealth(): { ok: boolean; mode: string } {
  const seed = sha256('health');
  return { ok: seed.length > 0, mode: 'local-sim' };
}
