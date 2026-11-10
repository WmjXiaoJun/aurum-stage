/** 无 LLM 时的确定性生成引擎：保证「创意 → 台本 → 分镜」链路开箱可用。 */
import {
  CAMERA_LABEL,
  STYLE_PRESETS,
  composePrompt,
  emotionSpeed,
  type Camera,
  type RenderEngine,
  type ScriptRound,
  type ScriptSegment,
  type SegmentType,
  type StructuredScript,
  type VisualStyleId,
  type VarietyType
} from '@aurum/core';

export interface CharSpec {
  role_id: string;
  name: string;
  role_type: 'host' | 'guest' | 'narrator' | 'virtual' | 'judge';
  persona: string;
  voice_hint: string;
  emotions: string[];
}

export interface OutlineSeg {
  segment_type: SegmentType;
  title: string;
  beats: string[];
  target_sec: number;
}

export interface StagePayload {
  engine: string;
  [key: string]: unknown;
}

const STOPWORDS = /^(我们|你们|他们|这个|那个|一个|什么|怎么|为什么|可以|就是|然后|但是|所以|因为|如果|已经|还是|这样|那样)$/;

export function extractTopic(text: string): string {
  const clean = text.replace(/[#*\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const firstSentence = clean.split(/[。！？.!?]/)[0] ?? clean;
  return (firstSentence || clean).slice(0, 40);
}

export function extractKeywords(text: string): string[] {
  const clean = text.replace(/[，。！？、；：""''（）()《》\n]/g, ' ').replace(/\s+/g, ' ');
  const tokens = clean.split(' ').filter((t) => t.length >= 2 && t.length <= 8 && !STOPWORDS.test(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
}

export function fallbackCharacters(sourceText: string, varietyType: VarietyType): CharSpec[] {
  const topic = extractTopic(sourceText);
  const kw = extractKeywords(sourceText);
  const host: CharSpec = {
    role_id: 'c_host',
    name: varietyType === 'standup' ? '老雷' : varietyType === 'challenge' ? '大鹏' : '阿哲',
    role_type: 'host',
    persona: '控场型主持人，反应快，擅长把话题推向具体的人与事；口头禅"我们掰开说"',
    voice_hint: '男声，中低音，语速偏快，尾音上扬',
    emotions: ['friendly_smile', 'teasing', 'surprised', 'serious']
  };
  const guestA: CharSpec = {
    role_id: 'c_guest_a',
    name: varietyType === 'challenge' ? '小鹿' : '林小满',
    role_type: 'guest',
    persona: '一线实践者，观点具体，愿意讲细节与翻车经历；被追问时会停顿思考',
    voice_hint: '女声，中音偏暖，句间有停顿',
    emotions: ['thoughtful', 'moved', 'friendly_smile', 'nervous']
  };
  const guestB: CharSpec = {
    role_id: 'c_guest_b',
    name: varietyType === 'skit' ? '胖虎' : '徐不器',
    role_type: 'guest',
    persona: '唱反调的角色，喜欢抛数据和反例，是包袱的主要来源；' + (kw[0] ? '对' + kw[0] + '有强烈的个人立场' : '对行业现状有强烈观点'),
    voice_hint: '男声，低音，语速慢，重音明显',
    emotions: ['deadpan', 'teasing', 'laugh_out_loud', 'serious']
  };
  void topic;
  return [host, guestA, guestB];
}

export function fallbackOutline(sourceText: string, varietyType: VarietyType, targetSec: number): OutlineSeg[] {
  const kw = extractKeywords(sourceText);
  const topic = extractTopic(sourceText);
  const t = Math.min(300, Math.max(60, targetSec));
  const k = (i: number) => kw[i % Math.max(1, kw.length)] ?? topic;
  const segs: OutlineSeg[] = [
    {
      segment_type: 'opening_flash',
      title: '开场片花',
      beats: ['城市夜景推镜', '标题卡：' + topic.slice(0, 12), '主持人入画定调'],
      target_sec: Math.round(t * 0.07)
    },
    {
      segment_type: 'talk_round',
      title: '第一轮 · ' + (kw[0] ?? topic).slice(0, 10),
      beats: ['主持人抛题', '嘉宾A给具体案例', '嘉宾B唱反调', '主持人首次收束'],
      target_sec: Math.round(t * 0.3)
    },
    {
      segment_type: 'talk_round',
      title: '第二轮 · 追问与反转',
      beats: ['追问细节', '翻车经历', '现场反应与笑点', '价值观落点'],
      target_sec: Math.round(t * 0.3)
    },
    {
      segment_type: varietyType === 'challenge' ? 'game_round' : 'skit',
      title: varietyType === 'challenge' ? '闯关 · 现场挑战' : '小剧场 · ' + k(1).slice(0, 8),
      beats: ['规则宣布', '执行翻车', '队友补刀', '结果公布'],
      target_sec: Math.round(t * 0.22)
    },
    {
      segment_type: 'ending',
      title: '收尾',
      beats: ['一句总结', '下期钩子', '片尾字幕'],
      target_sec: Math.max(6, Math.round(t * 0.11))
    }
  ];
  return segs;
}

const HOST_LINES = [
  '欢迎来到本期节目，今天我们只聊一件具体的事：{topic}。',
  '先别急着下结论，我们把{topic}掰开说。',
  '我先抛一个可能不太客气的判断：{topic}这件事，大多数人一开始就想错了。',
  '（笑）这个话题我们内部吵了三天，今天当面吵。'
];

const GUEST_A_LINES = [
  '我上周刚踩过一次，特别具体：本来三天能做完的事，我们拖了两周。',
  '（停顿）说实话，第一次做的时候我完全没底，硬着头皮上。',
  '我们试过最笨的办法，反而最有效，就是把它拆成每天能验收的一小块。',
  '我最怕的不是做错，是做完了才发现方向本来就错了。'
];

const GUEST_B_LINES = [
  '（唱反调）我不同意，这个结论只在小样本里成立。',
  '（压低声音）我给你们一个更扎心的数据：真正跑完的人不到两成。',
  '（笑）你们说的都对，但都没说成本。',
  '我承认我保守，可我宁愿慢一点，也不想返工三次。'
];

const REACTIONS = [
  '（惊讶）等一下，这个数字哪来的？',
  '（大笑）行，这话我记下了。',
  '（叹气）听到这句我有点破防。',
  '（笑着说）你这属于把天聊死了。'
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function estMs(text: string, speed = 1): number {
  const chars = Array.from(text.replace(/\s/g, '')).length;
  return Math.round((chars / 4.8) * 1000 / speed) + 200;
}

function cameraFor(i: number, lineLen: number): Camera {
  if (lineLen <= 16) return 'close_up';
  if (lineLen <= 34) return 'medium_close_up';
  if (i % 7 === 0) return 'wide';
  return 'medium_shot';
}

function engineFor(segType: SegmentType, cam: Camera): RenderEngine {
  if (segType === 'opening_flash' || segType === 'ending' || segType === 'transition') return 'muse_api';
  if (cam === 'wide') return 'muse_api';
  return 'comfy_h3';
}

export function fallbackScript(input: {
  project_id: number;
  title: string;
  sourceText: string;
  varietyType: VarietyType;
  visualStyle: VisualStyleId;
  targetSec: number;
  characters: CharSpec[];
  outline: OutlineSeg[];
  aspect_ratio?: string;
  fps?: number;
}): StructuredScript {
  const preset = STYLE_PRESETS[input.visualStyle];
  const topic = extractTopic(input.sourceText);
  const kw = extractKeywords(input.sourceText);
  const host = input.characters.find((c) => c.role_type === 'host') ?? input.characters[0];
  const guestA = input.characters.find((c) => c.role_type === 'guest') ?? input.characters[1] ?? host;
  const guestB = input.characters.filter((c) => c.role_type === 'guest')[1] ?? guestA;
  const segments: ScriptSegment[] = [];
  let seq = 0;

  for (const seg of input.outline) {
    const rounds: ScriptRound[] = [];
    const segTargetMs = seg.target_sec * 1000;
    let acc = 0;
    let lineIdx = 0;

    if (seg.segment_type === 'opening_flash' || seg.segment_type === 'transition') {
      const cam: Camera = 'empty_shot';
      rounds.push({
        round_id: 'r_' + String(seq + 1).padStart(2, '0') + '_01',
        speaker_role_id: null,
        speaker_name: null,
        camera: cam,
        lines: [],
        emotion: null,
        emotion_instruction: null,
        performance_tags: [],
        visual_prompt: composePrompt({ styleId: input.visualStyle, content: '赛博霓虹城市夜景推镜，片花氛围，字幕感光斑', camera_language: CAMERA_LABEL[cam] }),
        overlays: [{ type: 'title_card', text: input.title.slice(0, 16), in: 0.5, out: 3.5 }],
        engine_params: { engine: 'muse_api' },
        lipsync_required: false,
        target_duration_ms: Math.max(3000, Math.min(6000, segTargetMs))
      });
    } else {
      while (acc < segTargetMs && lineIdx < 14) {
        const who = lineIdx % 4 === 0 ? host : lineIdx % 4 === 1 ? guestA : lineIdx % 4 === 2 ? guestB : host;
        let line = '';
        if (who.role_id === host.role_id) line = pick(HOST_LINES, lineIdx).replace('{topic}', topic.slice(0, 18));
        else if (who.role_id === guestB.role_id) line = pick(GUEST_B_LINES, lineIdx);
        else line = pick(GUEST_A_LINES, lineIdx);
        if (lineIdx % 4 === 3 && lineIdx > 2) line = pick(REACTIONS, lineIdx);
        const emotion = who.role_id === guestB.role_id ? 'teasing' : who.role_id === host.role_id ? 'friendly_smile' : lineIdx % 3 === 0 ? 'thoughtful' : 'friendly_smile';
        const speed = emotionSpeed(emotion, 1);
        const cam = cameraFor(lineIdx, Array.from(line).length);
        const dur = estMs(line, speed);
        rounds.push({
          round_id: 'r_' + String(seq + 1).padStart(2, '0') + '_' + String(lineIdx + 1).padStart(2, '0'),
          speaker_role_id: who.role_id,
          speaker_name: who.name,
          camera: cam,
          lines: [line],
          emotion,
          emotion_instruction: '',
          performance_tags: [],
          visual_prompt: composePrompt({
            styleId: input.visualStyle,
            content: line.slice(0, 24),
            anchor: who.name + (kw[0] ? ' · ' + kw[0] : ''),
            camera_language: CAMERA_LABEL[cam]
          }),
          overlays: [{ type: 'name_tag', text: who.name }],
          engine_params: { engine: engineFor(seg.segment_type, cam) },
          tts: { engine: 'indextts2', voice_id: 'v_' + who.role_id.replace('c_', ''), speed },
          lipsync_required: cam === 'close_up' || cam === 'medium_close_up',
          target_duration_ms: dur
        });
        acc += dur + 200;
        lineIdx += 1;
      }
    }
    seq += 1;
    segments.push({
      segment_id: 's_' + String(seq).padStart(2, '0'),
      segment_type: seg.segment_type,
      title: seg.title,
      default_engine: rounds[0]?.engine_params?.engine as RenderEngine ?? 'muse_api',
      visual_style: input.visualStyle,
      rounds
    });
  }

  return {
    project_id: input.project_id,
    variety_type: input.varietyType,
    visual_style: input.visualStyle,
    global: {
      title: input.title,
      aspect_ratio: input.aspect_ratio ?? '16:9',
      fps: input.fps ?? 25,
      style_prompt: preset.prefix,
      style_negative: preset.negative,
      subtitle_style_id: 'st_variety_01',
      bgm_id: 'bgm_light_talk_01'
    },
    segments
  };
}

export function fallbackCasting(chars: CharSpec[]): Array<{ role_id: string; voice_id: string; provider: string; base_speed: number; emotions: string[]; forbidden: string }> {
  return chars.map((c) => ({
    role_id: c.role_id,
    voice_id: 'v_' + c.role_id.replace('c_', ''),
    provider: 'indextts2',
    base_speed: c.role_type === 'host' ? 1.05 : 0.98,
    emotions: c.emotions,
    forbidden: c.role_type === 'host' ? '哭腔, 过于沉重' : '过度播音腔, 沙哑'
  }));
}

export function fallbackQa(structured: StructuredScript, targetSec: number): Array<{ level: 'error' | 'warn'; code: string; message: string; suggestion: string; segment_title?: string; shot_code?: string }> {
  const issues: Array<{ level: 'error' | 'warn'; code: string; message: string; suggestion: string; segment_title?: string; shot_code?: string }> = [];
  let total = 0;
  for (const seg of structured.segments) {
    let segMs = 0;
    for (const round of seg.rounds) {
      const dur = Number(round.target_duration_ms ?? 3000);
      segMs += dur + 200;
      const text = (round.lines ?? []).join('');
      if (!text && round.camera !== 'empty_shot') {
        issues.push({ level: 'warn', code: 'EMPTY_LINE', message: '《' + seg.title + '》有镜头没有台词', suggestion: '补台词或标为空镜', segment_title: seg.title });
      }
      if (!round.speaker_role_id && round.camera !== 'empty_shot') {
        issues.push({ level: 'warn', code: 'NO_SPEAKER', message: '《' + seg.title + '》有镜头未绑定角色', suggestion: '指定说话人，否则无法绑定音色', segment_title: seg.title });
      }
      if (dur < 2000) {
        issues.push({ level: 'warn', code: 'SHOT_TOO_SHORT', message: '镜头时长 ' + (dur / 1000).toFixed(1) + 's 偏短', suggestion: '合并或补充台词', segment_title: seg.title });
      }
    }
    total += segMs;
    if (segMs > 300_000) {
      issues.push({ level: 'error', code: 'SEGMENT_DURATION_EXCEED', message: '《' + seg.title + '》预计 ' + Math.round(segMs / 1000) + ' 秒，超过 300 秒硬上限', suggestion: '删减镜头或拆分段落', segment_title: seg.title });
    }
  }
  if (total > targetSec * 1000 * 1.25) {
    issues.push({ level: 'warn', code: 'TARGET_OVERSHOOT', message: '总时长预计 ' + Math.round(total / 1000) + ' 秒，明显超过目标 ' + targetSec + ' 秒', suggestion: '压缩第二轮或减少反应镜头' });
  }
  if (total < targetSec * 1000 * 0.6) {
    issues.push({ level: 'warn', code: 'TARGET_UNDERSHOOT', message: '总时长预计 ' + Math.round(total / 1000) + ' 秒，明显低于目标 ' + targetSec + ' 秒', suggestion: '补充追问镜头或延长互动环节' });
  }
  return issues;
}
