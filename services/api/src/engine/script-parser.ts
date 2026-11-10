/**
 * 综艺台本解析引擎（M1）——两段式：规则优先 + LLM 兜底。
 * 规则版覆盖绝大多数编导写法，不依赖任何模型；LLM 兜底在路由层按需调用。
 */
import {
  CAMERAS,
  LIPSYNC_CAMERAS,
  SHOT_DURATION_WARN_MAX_MS,
  SHOT_DURATION_WARN_MIN_MS,
  SEGMENT_CAP_MS,
  buildEmotionInstruction,
  composePrompt,
  emotionSpeed,
  isPronounceable,
  normalizeNumbers,
  parseLine,
  stylePreset,
  type Camera,
  type Overlay,
  type RenderEngine,
  type ScriptRound,
  type ScriptSegment,
  type SegmentType,
  type StructuredScript,
  type VarietyType,
  type VisualStyleId
} from '@aurum/core';
import { sha256 } from '../util.js';
import { STYLE_PRESETS } from '@aurum/core';

export interface ParseWarning {
  level: 'warn' | 'error';
  code: string;
  message: string;
  line?: number;
  segment?: string;
}

export interface ParseResult {
  structured: StructuredScript;
  report: {
    segments: number;
    shots: number;
    estimate_ms: number;
    used_llm: boolean;
    source: 'markdown' | 'embedded_json' | 'llm';
    warnings: ParseWarning[];
    errors: ParseWarning[];
  };
}

export interface ParseOptions {
  projectId: number;
  varietyType: VarietyType;
  visualStyle: VisualStyleId;
  title?: string;
  stylePrompt?: string;
  styleNegative?: string;
  privacyMode?: boolean;
  characters?: Array<{ role_id: string; name: string }>;
  defaultEngine?: RenderEngine;
  aspectRatio?: string;
  fps?: number;
}

/** 每秒可读中文字数（IndexTTS-2 中速经验值），用于时长预估；真实时长以 TTS 产物为准 */
const CHARS_PER_SEC = 4.8;

const SEGMENT_KEYWORDS: Array<{ re: RegExp; type: SegmentType }> = [
  { re: /(开场|片花|opening|片头|预告)/i, type: 'opening_flash' },
  { re: /(转场|过渡|transition)/i, type: 'transition' },
  { re: /(闯关|游戏|挑战|game|关卡)/i, type: 'game_round' },
  { re: /(小剧场|情景|skit|短剧|演绎)/i, type: 'skit' },
  { re: /(片尾|结尾|ending|收尾|谢幕)/i, type: 'ending' },
  { re: /(访谈|问答|对话|talk|圆桌|追问|第一轮|第二轮|第三轮)/i, type: 'talk_round' }
];

const DIRECTION_TOKENS = /^(空镜|画面|场景|镜头|字幕|花字|旁白|画外音|画外|字幕条|转场|特效|B-?roll|BROLL)$/i;
const NAME_SPEAKER_RE = /^【([^】]{1,20})】\s*(.*)$/;
const COLON_SPEAKER_RE = /^([\u4e00-\u9fffA-Za-z·\-]{1,12})\s*[:：]\s*(.+)$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const UNDERLINE_HEADING_RE = /^(={2,}|-{2,})\s*(.+?)\s*$/;
const BRACKET_ONLY_RE = /^【([^】]{1,24})】$/;
const CAMERA_HINT_RE = /【\s*(全景|中景|中近景|特写|大特写|空镜|过肩|主观|双人)\s*】/;

const CAMERA_BY_HINT: Record<string, Camera> = {
  全景: 'wide',
  中景: 'medium_shot',
  中近景: 'medium_close_up',
  特写: 'close_up',
  大特写: 'extreme_close_up',
  空镜: 'empty_shot',
  过肩: 'over_shoulder',
  主观: 'pov',
  双人: 'two_shot'
};

const CAMERA_LANGUAGE: Record<Camera, string> = {
  wide: '演播厅全景, 广角镜头, 环境交代',
  medium_shot: '中景, 半身构图, 背景轻微虚化',
  medium_close_up: '中近景, 胸口以上构图, 浅景深',
  close_up: '面部特写, 85mm 人像镜头, 眼神光',
  extreme_close_up: '大特写, 眼部与嘴部细节, 极浅景深',
  over_shoulder: '过肩镜头, 前景遮挡, 对话感强',
  empty_shot: '空镜, 无人物, 空间氛围, 缓慢运镜',
  pov: '第一人称主观视角',
  two_shot: '双人同框构图, 侧面机位'
};

function slugRole(name: string): string {
  return 'c_' + sha256(name).slice(0, 6);
}

interface SpeakerHit {
  speaker: string | null;
  head: string | null;
  text: string;
  direction: boolean;
}

function detectSpeaker(raw: string): SpeakerHit {
  const m1 = raw.match(NAME_SPEAKER_RE);
  if (m1) {
    const head = m1[1].trim();
    const rest = (m1[2] ?? '').trim();
    if (DIRECTION_TOKENS.test(head)) return { speaker: null, head, text: rest, direction: true };
    return { speaker: head, head, text: rest, direction: false };
  }
  const m2 = raw.match(COLON_SPEAKER_RE);
  if (m2) {
    const head = m2[1].trim();
    if (DIRECTION_TOKENS.test(head)) return { speaker: null, head, text: m2[2].trim(), direction: true };
    return { speaker: head, head, text: m2[2].trim(), direction: false };
  }
  return { speaker: null, head: null, text: raw, direction: false };
}

function cleanSpeakerName(raw: string): { name: string; roleHint: string | null } {
  const parts = raw.split(/[·•\/｜|]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { name: parts[parts.length - 1], roleHint: parts[0] };
  return { name: raw.trim(), roleHint: null };
}

function inferEmotion(text: string, tags: string[], hasBang: boolean, hasQuestion: boolean): string {
  if (tags.includes('laugh_in') || /笑/.test(text)) return 'friendly_smile';
  if (tags.includes('whisper')) return 'thoughtful';
  if (tags.includes('sigh')) return 'moved';
  if (tags.includes('emphasis')) return 'excited';
  if (hasBang && text.length <= 24) return 'excited';
  if (hasQuestion) return 'thoughtful';
  if (text.length > 45) return 'serious';
  return 'friendly_smile';
}

function estimateShotMs(text: string, pauseMs: number, speed: number): number {
  const chars = Array.from(text.replace(/\s/g, '')).length;
  const base = (chars / CHARS_PER_SEC) * 1000;
  const ms = Math.round(base / (speed || 1)) + pauseMs;
  return Math.max(1200, ms);
}

function pickCamera(text: string, hasSpeaker: boolean, tags: string[], firstInSegment: boolean): Camera {
  const hint = text.match(CAMERA_HINT_RE);
  if (hint) {
    const cam = CAMERA_BY_HINT[hint[1]];
    if (cam) return cam;
  }
  if (!hasSpeaker) return 'empty_shot';
  const len = Array.from(text).length;
  if (tags.includes('whisper')) return 'close_up';
  if (tags.includes('laugh_in') && len <= 30) return 'medium_close_up';
  if (len <= 18) return 'close_up';
  if (len <= 40) return 'medium_close_up';
  if (firstInSegment) return 'medium_shot';
  return 'medium_shot';
}

function segmentTypeOf(title: string, index: number): SegmentType {
  for (const kw of SEGMENT_KEYWORDS) if (kw.re.test(title)) return kw.type;
  return index === 0 ? 'opening_flash' : 'talk_round';
}

function defaultEngineFor(type: SegmentType, camera: Camera, privacy: boolean): RenderEngine {
  // 生成视频优先走云端 Muse；涉敏镜头强制本地，其余交云端
  if (privacy) return 'comfy_h3';
  void type;
  void camera;
  return 'muse_api';
}

interface DraftLine {
  lineNo: number;
  speaker: string | null;
  text: string;
  direction: boolean;
  camera?: Camera;
}

interface DraftSegment {
  title: string;
  type: SegmentType;
  direction: string[];
  flowers: string[];
  lines: DraftLine[];
}

function tryEmbeddedJson(md: string, opts: ParseOptions): ParseResult | null {
  const fence = md.match(/```json\s*([\s\S]*?)```/);
  if (!fence) return null;
  try {
    const parsed = JSON.parse(fence[1]);
    if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) return null;
    const structured: StructuredScript = {
      project_id: opts.projectId,
      variety_type: (parsed.variety_type as VarietyType) ?? opts.varietyType,
      visual_style: (parsed.visual_style as VisualStyleId) ?? opts.visualStyle,
      global: {
        title: parsed.global?.title ?? opts.title ?? '未命名微综艺',
        aspect_ratio: parsed.global?.aspect_ratio ?? opts.aspectRatio ?? '16:9',
        fps: parsed.global?.fps ?? opts.fps ?? 25,
        style_prompt: parsed.global?.style_prompt ?? opts.stylePrompt ?? '',
        style_negative: parsed.global?.style_negative ?? opts.styleNegative ?? '',
        subtitle_style_id: parsed.global?.subtitle_style_id ?? 'st_variety_01',
        bgm_id: parsed.global?.bgm_id ?? 'bgm_light_talk_01'
      },
      segments: parsed.segments as ScriptSegment[]
    };
    const shots = structured.segments.reduce((n, s) => n + (s.rounds?.length ?? 0), 0);
    return {
      structured,
      report: {
        segments: structured.segments.length,
        shots,
        estimate_ms: 0,
        used_llm: false,
        source: 'embedded_json',
        warnings: [],
        errors: []
      }
    };
  } catch {
    return null;
  }
}

export function parseScript(md: string, opts: ParseOptions): ParseResult {
  const warnings: ParseWarning[] = [];
  const embedded = tryEmbeddedJson(md, opts);
  if (embedded) return embedded;

  const rawLines = md.replace(/\r\n?/g, '\n').split('\n');
  const drafts: DraftSegment[] = [];
  let title = opts.title ?? '';
  let current: DraftSegment | null = null;
  let lastSpeaker: string | null = null;

  const pushSegment = (name: string) => {
    const seg: DraftSegment = { title: name, type: 'talk_round', direction: [], flowers: [], lines: [] };
    drafts.push(seg);
    current = seg;
    lastSpeaker = null;
    return seg;
  };

  rawLines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    let line = rawLine.trim();
    if (!line) return;
    if (/^\`\`\`/.test(line)) return;

    const heading = line.match(HEADING_RE) ?? line.match(UNDERLINE_HEADING_RE);
    const bracketOnly = line.match(BRACKET_ONLY_RE);

    if (heading) {
      const level = heading[1].startsWith('#') ? heading[1].length : 2;
      const name = heading[2].trim();
      if (level === 1 && !title) {
        title = name;
        return;
      }
      if (level === 1 && drafts.length === 0) {
        title = name;
        return;
      }
      const seg = pushSegment(name);
      seg.type = segmentTypeOf(name, drafts.length - 1);
      return;
    }

    if (bracketOnly) {
      const name = bracketOnly[1].trim();
      if (DIRECTION_TOKENS.test(name)) {
        if (!current) current = pushSegment(opts.title ?? '开场');
        return;
      }
      const seg = pushSegment(name);
      seg.type = segmentTypeOf(name, drafts.length - 1);
      return;
    }

    line = line.replace(/^([-*+>]|\d+[.、)])\s*/, '').trim();
    if (!line) return;

    const { speaker, head, text, direction } = detectSpeaker(line);

    if (!current) {
      current = pushSegment(opts.title ?? '开场');
      current.type = 'opening_flash';
    }

    const seg: DraftSegment = current;
    const cameraHint = line.match(CAMERA_HINT_RE);

    if (direction) {
      const body = (text || line).replace(/^[（(]|[）)]$/g, '').trim();
      if (body) {
        if (/^(花字|字幕|字幕条)$/.test(String(head ?? ''))) seg.flowers.push(body);
        else seg.direction.push(body);
      }
      return;
    }
    if (!speaker && /^[（(].*[）)]$/.test(line) && line.length <= 24) {
      seg.direction.push(line.replace(/^[（(]|[）)]$/g, ''));
      return;
    }
    if (!speaker && !text) return;

    const dialogue = text || line;
    if (!speaker && /^[（(].*[）)]$/.test(dialogue)) {
      seg.direction.push(dialogue.replace(/^[（(]|[）)]$/g, ''));
      return;
    }

    seg.lines.push({
      lineNo,
      speaker: speaker ?? lastSpeaker,
      text: dialogue,
      direction: false,
      camera: cameraHint ? CAMERA_BY_HINT[cameraHint[1]] : undefined
    });
    lastSpeaker = speaker ?? lastSpeaker;
  });

  // 没有任何环节标题时，按段落空行切分
  if (drafts.length === 0) {
    const seg = pushSegment(title || opts.title || '正片');
    seg.type = 'talk_round';
    md.split(/\n\s*\n/).forEach((block, i) => {
      const t = block.trim();
      if (!t) return;
      const { speaker, text } = detectSpeaker(t.replace(/\n/g, ' '));
      seg.lines.push({ lineNo: i + 1, speaker, text: text || t, direction: false });
    });
  }

  const charMap = new Map<string, string>();
  for (const c of opts.characters ?? []) charMap.set(c.name, c.role_id);

  const preset = stylePreset(opts.visualStyle);
  const segments: ScriptSegment[] = [];
  let totalShots = 0;
  let estimate = 0;

  drafts.forEach((draft, sIdx) => {
    if (draft.lines.length === 0 && draft.direction.length === 0) return;
    const segmentId = 's_' + String(sIdx + 1).padStart(2, '0');
    const rounds: ScriptRound[] = [];
    let firstInSegment = true;

    if (draft.direction.length > 0 && draft.lines.length === 0) {
      const cam: Camera = 'empty_shot';
      const prompt = composePrompt({
        styleId: opts.visualStyle,
        content: draft.direction.join('，'),
        camera_language: CAMERA_LANGUAGE[cam]
      });
      rounds.push({
        round_id: 'r_' + String(sIdx + 1).padStart(2, '0') + '_01',
        speaker_role_id: null,
        speaker_name: null,
        camera: cam,
        lines: [],
        emotion: null,
        emotion_instruction: null,
        performance_tags: [],
        visual_prompt: prompt,
        overlays: draft.type === 'opening_flash'
          ? [{ type: 'title_card', text: title || opts.title || '微综艺', in: 0.5, out: 3.5 }]
          : [],
        engine_params: { engine: defaultEngineFor(draft.type, cam, !!opts.privacyMode) },
        tts: null,
        lipsync_required: false,
        privacy: !!opts.privacyMode,
        target_duration_ms: 3000
      });
      firstInSegment = false;
      estimate += 3000;
    }

    draft.lines.forEach((line, lIdx) => {
      const parsed = parseLine(line.text);
      const tagIds = parsed.tags.map((t) => String(t.tag));
      const textForTTS = normalizeNumbers(parsed.clean_text);
      const pron = isPronounceable(textForTTS);
      if (!pron.ok && textForTTS.length > 0) {
        warnings.push({
          level: 'warn',
          code: 'TTS_TEXT_INVALID',
          message: '台词可发音字符比例偏低（' + Math.round(pron.ratio * 100) + '%），可能触发 TTS_TEXT_INVALID：' + line.text.slice(0, 24),
          line: line.lineNo,
          segment: draft.title
        });
      }
      if (parsed.warnings.length) {
        warnings.push({
          level: 'warn',
          code: 'SCRIPT_TAG_UNCLOSED',
          message: parsed.warnings.join('；'),
          line: line.lineNo,
          segment: draft.title
        });
      }

      const speakerClean = line.speaker ? cleanSpeakerName(line.speaker) : null;
      const roleId = speakerClean ? charMap.get(speakerClean.name) ?? slugRole(speakerClean.name) : null;
      const hasSpeaker = !!roleId;
      const cam = line.camera ?? pickCamera(textForTTS, hasSpeaker, tagIds, firstInSegment);
      if (!CAMERAS.includes(cam)) {
        warnings.push({ level: 'warn', code: 'CAMERA_INVALID', message: '未知机位已回退中景', line: line.lineNo, segment: draft.title });
      }
      const emotion = inferEmotion(textForTTS, tagIds, /！/.test(line.text), /[?？]/.test(line.text));
      const instruction = buildEmotionInstruction(emotion, parsed.emotion_instruction_extra);
      const speedTag = parsed.tags.find((t) => t.tag === 'speed');
      const speed = speedTag ? Number(speedTag.value) : 1;
      const pauseMs = parsed.tags.filter((t) => t.tag === 'pause').reduce((n, t) => n + Number(t.value ?? 1) * 1000, 0);

      const prompt = composePrompt({
        styleId: opts.visualStyle,
        content: draft.direction.length ? draft.direction.join('，') + '，' + textForTTS.slice(0, 24) : textForTTS.slice(0, 24),
        anchor: speakerClean ? speakerClean.name + (speakerClean.roleHint ? ' · ' + speakerClean.roleHint : '') : '',
        camera_language: CAMERA_LANGUAGE[cam]
      });

      const overlays: Overlay[] = [];
      if (speakerClean && cam !== 'empty_shot') overlays.push({ type: 'name_tag', text: speakerClean.name + (speakerClean.roleHint ? ' · ' + speakerClean.roleHint : '') });
      if (draft.type === 'opening_flash' && lIdx === 0) overlays.push({ type: 'title_card', text: title || opts.title || '微综艺', in: 0.5, out: 3.5 });

      const engine = defaultEngineFor(draft.type, cam, !!opts.privacyMode);
      const lipsync = !!opts.privacyMode ? LIPSYNC_CAMERAS.includes(cam) && hasSpeaker : LIPSYNC_CAMERAS.includes(cam) && hasSpeaker;

      rounds.push({
        round_id: 'r_' + String(sIdx + 1).padStart(2, '0') + '_' + String(lIdx + 1).padStart(2, '0'),
        speaker_role_id: roleId,
        speaker_name: speakerClean?.name ?? null,
        camera: cam,
        lines: [line.text],
        emotion,
        emotion_instruction: instruction,
        performance_tags: parsed.tags,
        visual_prompt: prompt,
        overlays,
        engine_params: {
          engine,
          ...(STYLE_PRESETS[opts.visualStyle].engine_params[engine] ?? {})
        },
        tts: { engine: 'indextts2', voice_id: speakerClean ? 'v_' + sha256(speakerClean.name).slice(0, 6) : 'v_narrator', speed },
        lipsync_required: lipsync,
        privacy: !!opts.privacyMode,
        target_duration_ms: estimateShotMs(textForTTS, pauseMs, speed)
      });

      const est = estimateShotMs(textForTTS, pauseMs, speed);
      estimate += est;
      if (est < SHOT_DURATION_WARN_MIN_MS || est > SHOT_DURATION_WARN_MAX_MS) {
        warnings.push({
          level: 'warn',
          code: 'SHOT_DURATION_WARN',
          message: '单镜头预估时长 ' + (est / 1000).toFixed(1) + 's 落在 2–8s 建议区间之外（仅警告）',
          line: line.lineNo,
          segment: draft.title
        });
      }
      firstInSegment = false;
      totalShots += 1;
    });

    if (rounds.length === 0) return;

    if (draft.flowers.length > 0) {
      const target = rounds.find((r) => (r.lines ?? []).length > 0) ?? rounds[0];
      for (const flower of draft.flowers) {
        target.overlays.push({ type: 'flower', text: flower, in: 0.4, out: 2.8 });
      }
    }

    const segDefaultEngine = rounds[0]?.engine_params?.engine as RenderEngine ?? 'comfy_h3';
    segments.push({
      segment_id: segmentId,
      segment_type: draft.type,
      title: draft.title,
      default_engine: segDefaultEngine,
      visual_style: opts.visualStyle,
      rounds
    });
  });

  const structured: StructuredScript = {
    project_id: opts.projectId,
    variety_type: opts.varietyType,
    visual_style: opts.visualStyle,
    global: {
      title: title || opts.title || '未命名微综艺',
      aspect_ratio: opts.aspectRatio ?? '16:9',
      fps: opts.fps ?? 25,
      style_prompt: opts.stylePrompt ?? preset.prefix,
      style_negative: opts.styleNegative ?? preset.negative,
      subtitle_style_id: 'st_variety_01',
      bgm_id: 'bgm_light_talk_01'
    },
    segments
  };

  if (segments.length === 0) {
    warnings.push({ level: 'error', code: 'SCRIPT_EMPTY', message: '未解析出任何环节，请检查台本标记（标题/【角色】/角色：）' });
  }

  return {
    structured,
    report: {
      segments: segments.length,
      shots: totalShots,
      estimate_ms: estimate,
      used_llm: false,
      source: 'markdown',
      warnings,
      errors: warnings.filter((w) => w.level === 'error')
    }
  };
}

/** 供 LLM 兜底使用的 JSON schema（结构约束），与台本结构一致 */
export const SCRIPT_JSON_SCHEMA = {
  type: 'object',
  required: ['segments'],
  properties: {
    title: { type: 'string' },
    segments: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['segment_type', 'title', 'rounds'],
        properties: {
          segment_id: { type: 'string' },
          segment_type: { type: 'string', enum: ['opening_flash', 'talk_round', 'game_round', 'skit', 'transition', 'ending'] },
          title: { type: 'string' },
          default_engine: { type: 'string', enum: ['muse_api', 'comfy_h3'] },
          rounds: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['speaker_name', 'camera', 'lines', 'visual_prompt'],
              properties: {
                round_id: { type: 'string' },
                speaker_name: { type: 'string' },
                camera: { type: 'string', enum: ['wide', 'medium_shot', 'medium_close_up', 'close_up', 'extreme_close_up', 'over_shoulder', 'empty_shot', 'pov', 'two_shot'] },
                lines: { type: 'array', items: { type: 'string' } },
                emotion: { type: 'string' },
                emotion_instruction: { type: 'string' },
                performance_tags: { type: 'array', items: { type: 'string' } },
                visual_prompt: { type: 'string' },
                target_duration_ms: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }
} as const;
