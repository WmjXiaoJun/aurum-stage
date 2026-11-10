/**
 * 第十八章 · 台词预处理与表演标签解析器（前后端共用，单一事实来源）
 * 输入：编导写的人话台本；输出：TTS 能演的指令序列。
 */
import type { ParsedLine, PerformanceTag } from './types.js';

export interface TagHit {
  tag: string;
  value?: string | number | boolean;
}

const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5
};

function parseAmountString(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const arabic = t.match(/^([0-9]+(?:\.[0-9]+)?)\s*(秒|s|毫秒|ms)?$/i);
  if (arabic) {
    const n = Number(arabic[1]);
    return arabic[2] && /ms|毫秒/i.test(arabic[2]) ? n / 1000 : n;
  }
  if (t === '半') return 0.5;
  if (/^[零一二两三四五六七八九十半]+$/.test(t)) {
    const arr = t.split('');
    let total = 0;
    for (const ch of arr) total += CN_NUM[ch] ?? 0;
    return total > 0 ? total : null;
  }
  return null;
}

/** 标签语法兼容表（18.2）：多种写法统一归一 */
export function lookupTag(innerRaw: string): TagHit | null {
  const inner = innerRaw.trim().replace(/\s+/g, '');
  if (!inner) return null;

  // 语速：加快 / 放慢
  if (/^(加快|语速加快|快一点|加速|快点说)$/.test(inner)) return { tag: 'speed', value: 1.2 };
  if (/^(放慢|语速放慢|慢一点|慢点说)$/.test(inner)) return { tag: 'speed', value: 0.85 };

  // 停顿：停顿 / 停顿两秒 / 顿一下 / 停一下 / 沉默三秒
  const pauseM = inner.match(/^(?:停顿|顿一下|停一下|停|沉默|静默|空白)([0-9零一二两三四五六七八九十半\\.]*)(秒|s|毫秒|ms)?$/);
  if (pauseM) {
    const amount = parseAmountString(pauseM[1] || '一');
    const unit = pauseM[2];
    const sec = amount == null ? 1.0 : (unit && /ms|毫秒/.test(unit) ? amount / 1000 : amount);
    return { tag: 'pause', value: Math.min(Math.max(sec, 0.15), 10) };
  }

  if (/^(笑|笑声|笑一下|哈哈|哄笑)$/.test(inner)) return { tag: 'laugh_in', value: true };
  if (/^(笑着说|带笑|笑腔|带笑腔)$/.test(inner)) return { tag: 'tone', value: 'laugh' };
  if (/^(压低声音|耳语|小声|低语|轻声)$/.test(inner)) return { tag: 'whisper', value: true };
  if (/^(大声|加重|重读|提高音量|吼)$/.test(inner)) return { tag: 'emphasis', value: true };
  if (/^(叹气|叹一口气|长叹)$/.test(inner)) return { tag: 'sigh', value: true };
  if (/^(吸气|倒吸气|抽气)$/.test(inner)) return { tag: 'breath', value: 'inhale' };
  if (/^(呼气|吐气)$/.test(inner)) return { tag: 'breath', value: 'exhale' };
  if (/^(哽咽|带哭腔|哭腔)$/.test(inner)) return { tag: 'tear', value: true };
  if (/^(拖长|拖音|拉长)$/.test(inner)) return { tag: 'stretch', value: true };
  if (/^(打断|抢话|接话)$/.test(inner)) return { tag: 'interrupt', value: true };
  if (/^(清嗓子|咳嗽)$/.test(inner)) return { tag: 'cough', value: true };
  return null;
}

const PAIRS: Record<string, string> = { '（': '）', '(': ')', '[': ']', '{': '}', '【': '】', '<': '>', '《': '》' };

function findMatching(raw: string, start: number): number {
  const open = raw[start];
  const close = PAIRS[open];
  if (!close) return -1;
  for (let i = start + 1; i < raw.length; i++) {
    if (raw[i] === close) return i;
  }
  return -1;
}

/** 标点 → 停顿映射（18.3） */
export const PUNCT_PAUSE_MS: Record<string, number> = {
  '，': 200, ',': 200,
  '。': 500, '.': 500,
  '；': 300, ';': 300,
  '？': 400, '?': 400,
  '！': 600, '!': 600,
  '、': 150,
  '…': 350,
  '—': 250
};

/** 词法状态机（18.4）：括号必须配对闭合才识别为标签，不闭合一律当普通文本 */
export function parseLine(raw: string): ParsedLine {
  const segments: PerformanceTag[] = [];
  const warnings: string[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      segments.push({ type: 'text', text: buf });
      buf = '';
    }
  };

  while (i < raw.length) {
    const ch = raw[i];
    if (PAIRS[ch]) {
      const close = findMatching(raw, i);
      if (close === -1) {
        warnings.push('括号未闭合，按普通文本处理：' + ch + raw.slice(i + 1, Math.min(i + 12, raw.length)));
        buf += ch;
        i += 1;
        continue;
      }
      flush();
      const inner = raw.slice(i + 1, close);
      const hit = lookupTag(inner);
      if (hit) segments.push({ type: 'tag', tag: hit.tag, value: hit.value });
      else segments.push({ type: 'emotion_extra', text: inner });
      i = close + 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();

  const tags = segments.filter((s) => s.type === 'tag');
  const emotionExtra = segments.filter((s) => s.type === 'emotion_extra').map((s) => s.text).join('，');
  const clean = segments.filter((s) => s.type === 'text').map((s) => s.text).join('').replace(/\s+/g, ' ').trim();

  return {
    text_raw: raw,
    segments,
    clean_text: clean,
    emotion_instruction_extra: emotionExtra,
    tags,
    warnings
  };
}

/** 数字清洗（18.3）：年份逐位读，金额/比例按语境 */
const DIGITS_CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const UNIT_CN = ['', '十', '百', '千', '万'];

export function intToChinese(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return '零';
  if (n >= 100000) return String(n).split('').map((d) => DIGITS_CN[Number(d)]).join('');
  const s = String(Math.floor(n));
  let out = '';
  let zero = false;
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const unit = s.length - 1 - i;
    if (d === 0) { zero = true; continue; }
    if (zero && out) out += '零';
    zero = false;
    out += DIGITS_CN[d] + (UNIT_CN[unit] ?? '');
  }
  // 一十三 → 十三
  return out.replace(/^一十/, '十');
}

export function normalizeNumbers(text: string): string {
  let out = text;
  // 年份：2026年 → 二零二六年
  out = out.replace(/((?:19|20)\d{2})\s*年/g, (_, y: string) => y.split('').map((d) => DIGITS_CN[Number(d)]).join('') + '年');
  // 手机号：11 位连续数字逐位读
  out = out.replace(/\b1[3-9]\d{9}\b/g, (m) => m.split('').map((d) => DIGITS_CN[Number(d)]).join(''));
  // 百分比：35% → 百分之三十五
  out = out.replace(/(\d{1,3}(?:\.\d+)?)\s*%/g, (_, v: string) => '百分之' + (Number(v) % 1 === 0 ? intToChinese(Number(v)) : String(v)));
  // 普通整数（≤ 99999）：3秒 → 三秒
  out = out.replace(/(?<![\d.])(\d{1,5})(?![\d.])/g, (m, d: string) => (Number(d) <= 99999 ? intToChinese(Number(d)) : m));
  return out;
}

/** 清洗文本用于 TTS；返回文本、估算停顿、警告 */
export function cleanForTTS(raw: string): { text: string; pause_ms: number; tags: PerformanceTag[]; warnings: string[] } {
  const parsed = parseLine(raw);
  let pause = 0;
  for (const seg of parsed.tags) {
    if (seg.tag === 'pause') pause += Math.round(Number(seg.value ?? 1) * 1000);
  }
  const text = normalizeNumbers(parsed.clean_text)
    .replace(/…+/g, '…')
    .replace(/——+/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, pause_ms: pause, tags: parsed.tags, warnings: parsed.warnings };
}

/** 性别/中文兜底发音自检：可发音字符比例太低 → TTS_TEXT_INVALID */
export function isPronounceable(text: string): { ok: boolean; ratio: number } {
  const meaningful = Array.from(text.replace(/[\s\p{P}\p{S}]/gu, ''));
  if (meaningful.length === 0) return { ok: false, ratio: 0 };
  const pronounceable = meaningful.filter((ch) => /[\u4e00-\u9fffA-Za-z0-9]/.test(ch)).length;
  const ratio = pronounceable / meaningful.length;
  return { ok: ratio >= 0.3, ratio };
}

/** 给前端编辑器用的标签速查表 */
export const TAG_CHEATSHEET: Array<{ write: string; alias: string; result: string }> = [
  { write: '（笑）', alias: '(笑) / [笑] / <笑>', result: 'laugh_in · 句首笑腔气口' },
  { write: '（停顿）', alias: '（停顿两秒）/（顿一下）', result: 'pause · 插入静音段' },
  { write: '（压低声音）', alias: '（耳语）', result: 'whisper · 音量与气息感' },
  { write: '（大声）', alias: '（加重）', result: 'emphasis · 音量提高、咬字加重' },
  { write: '（笑着说）', alias: '（带笑）', result: 'tone=laugh · 整句带笑腔' },
  { write: '（加快）', alias: '（放慢）', result: 'speed=1.2 / 0.85' },
  { write: '阿哲：', alias: '【阿哲】/ Host:', result: 'speaker 标记 · 绑定 voice_id' },
  { write: '（任何其它括号内容）', alias: '—', result: 'emotion_extra · 原文交模型自然语言理解' }
];
