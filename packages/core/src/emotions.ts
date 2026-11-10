/**
 * 第七章 7.4 · 情绪词典（写进配置，不让编导瞎写抽象词）
 * 原则：只写可表演的动作与韵律——声音高低、停顿长短、语速快慢、笑/叹/气口。
 */
export interface EmotionDef {
  id: string;
  label: string;
  /** 一句话能力说明，给编导看 */
  hint: string;
  /** 自然语言情绪指令（直接喂 TTS） */
  instruction: string;
  /** 语速建议倍率 */
  speed: number;
  /** 情绪强度参考音频类型 */
  refType: 'normal' | 'emotional_peak' | 'angry' | 'laugh';
  /** 前端 chips 颜色语义 */
  tone: 'gold' | 'jade' | 'up' | 'warn' | 'down' | 'neutral';
}

export const EMOTIONS: EmotionDef[] = [
  { id: 'friendly_smile', label: '友好微笑', hint: '开场、接话、暖场', instruction: '语气轻松友善，带着微笑，语速稍快，尾音上扬', speed: 1.05, refType: 'normal', tone: 'gold' },
  { id: 'thoughtful', label: '思考', hint: '追问、铺垫、留白', instruction: '语速放慢，句间有思考停顿，声音沉稳', speed: 0.92, refType: 'normal', tone: 'jade' },
  { id: 'surprised', label: '惊讶', hint: '包袱、反转、接梗', instruction: '声音骤然提高半度，短暂停顿后接话', speed: 1.12, refType: 'emotional_peak', tone: 'warn' },
  { id: 'laugh_out_loud', label: '大笑', hint: '爆梗、嗨点', instruction: '先短促笑一声，再笑着把话说完，语气松弛', speed: 1.08, refType: 'laugh', tone: 'warn' },
  { id: 'serious', label: '严肃', hint: '结论、价值观、点评', instruction: '语速放缓，音量下沉，咬字加重，不带笑意', speed: 0.9, refType: 'normal', tone: 'down' },
  { id: 'teasing', label: '调侃', hint: '吐槽、拱火、抖机灵', instruction: '带调侃的上扬语调，句尾拖一点，留一点余味', speed: 1.0, refType: 'emotional_peak', tone: 'gold' },
  { id: 'warm_gentle', label: '温和', hint: '访谈收尾、共情', instruction: '声音放软，气息平稳，句子之间留小停顿，尾音不上扬', speed: 0.95, refType: 'normal', tone: 'jade' },
  { id: 'nervous', label: '紧张犹豫', hint: '素人、闯关、失误', instruction: '句间有短停顿，"嗯"一下再接话，语速忽快忽慢', speed: 1.0, refType: 'normal', tone: 'warn' },
  { id: 'excited', label: '兴奋', hint: '开场片花、宣布规则', instruction: '声音提高半度，语速加快，句尾上扬，重音落在关键词上', speed: 1.15, refType: 'emotional_peak', tone: 'warn' },
  { id: 'moved', label: '感动', hint: '情感落点、结尾升华', instruction: '语速放慢，声音放低，句尾带一点气音', speed: 0.88, refType: 'emotional_peak', tone: 'down' },
  { id: 'deadpan', label: '面无表情', hint: '冷幽默、反差', instruction: '语调压平，几乎没有起伏，句末干脆收住', speed: 0.98, refType: 'normal', tone: 'neutral' },
  { id: 'interview_probe', label: '认真追问', hint: '访谈深挖', instruction: '语气平稳有力，语速适中，重音落在疑问词上，句尾略下沉', speed: 0.97, refType: 'normal', tone: 'jade' }
];

export const EMOTION_MAP: Record<string, EmotionDef> = Object.fromEntries(EMOTIONS.map((e) => [e.id, e]));

export function emotionDef(id: string | null | undefined): EmotionDef | null {
  if (!id) return null;
  return EMOTION_MAP[id] ?? null;
}

/** 自动补情绪指令：emotion 字段 → 情绪词典 → emotion_instruction（v1.3 第 5 步） */
export function buildEmotionInstruction(emotion: string | null | undefined, extra?: string | null): string {
  const def = emotionDef(emotion);
  const base = def?.instruction ?? '';
  const tail = (extra ?? '').trim();
  if (!base) return tail;
  return tail ? base + '，' + tail : base;
}

export function emotionSpeed(emotion: string | null | undefined, fallback = 1): number {
  const def = emotionDef(emotion);
  return def ? def.speed : fallback;
}

/** 编导易写错的抽象词 → 可表演写法（附录 E 对照表，前端提示用） */
export const ABSTRACT_TO_PERFORMABLE: Array<{ bad: string; good: string }> = [
  { bad: '很激动', good: '声音提高半度，语速加快，句尾上扬' },
  { bad: '很感动', good: '语速放慢，声音放低，句尾带一点气音' },
  { bad: '很开心', good: '带着笑腔，尾音上扬，句子之间留小停顿' },
  { bad: '很严肃', good: '音量下沉，咬字加重，不带笑意，语速平稳' },
  { bad: '在调侃', good: '句尾拖长半拍，语调上扬，留半秒余味' },
  { bad: '紧张犹豫', good: '句间有短停顿，"嗯"一下再接话，语速忽快忽慢' }
];
