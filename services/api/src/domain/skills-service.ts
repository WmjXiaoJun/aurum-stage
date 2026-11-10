/**
 * 剧本技能库（参照 shuohao-skills 的方法，落到综艺/台本场景）
 * 每个技能：声明输入 → 模型产出结构化 JSON → 确定性质量门校验 → 落库版本化
 */
import { all, get, json, nowIso, run } from '../db/index.js';
import { config } from '../config.js';
import { deepseekKey } from './settings-service.js';
import { notFound } from '../http/errors.js';

export interface GateResult { id: string; label: string; pass: boolean; detail: string }
export interface SkillDef {
  key: string;
  name: string;
  group: '开发' | '写作' | '视觉' | '分镜';
  summary: string;
  outputs: string[];
  system: string;
  user: (ctx: SkillContext) => string;
  gates: (body: Record<string, unknown>) => GateResult[];
}

export interface SkillContext {
  project: Record<string, unknown>;
  segments: Array<Record<string, unknown>>;
  shots: Array<Record<string, unknown>>;
  characters: Array<Record<string, unknown>>;
  brief: string;
}

const SEG_CAP = 300;
const CAMERA_ENUM = ['特写', '近景', '中景', '全景', '空镜'];

function asArray(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function num(v: unknown, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function str(v: unknown): string { return v == null ? '' : String(v); }

const JSON_RULE = '只输出一个 JSON 对象，不要 Markdown 代码块、不要解释。字段名用英文，内容用简体中文。';

export const SKILLS: SkillDef[] = [
  {
    key: 'variety-characters',
    name: '角色圣经',
    group: '开发',
    summary: '把创意/台本里的出镜人拆成角色卡：定位、人设、外貌提示词、音色、参考角度。',
    outputs: ['characters[]'],
    system: '你是综艺节目的人物总监。' + JSON_RULE,
    user: (ctx) => [
      '节目名：' + str(ctx.project.name),
      '类型：' + str(ctx.project.variety_type) + '，画幅 ' + str(ctx.project.aspect_ratio),
      '创意/台本片段：\n' + ctx.brief.slice(0, 3000),
      '已有角色：' + JSON.stringify(ctx.characters.map((c) => ({ name: c.name, role_type: c.role_type }))),
      '请输出 {"characters":[{"name":"","role_type":"host|guest|narrator|virtual|judge","persona":"一句话人设","prompt_prefix":"英文外貌提示词","voice_trait":"音色描述","ref_angles":["front","smile","profile"],"importance":"lead|support|functional"}]}',
      '要求：主角 ≤5、重要配角 ≤10、功能角色 ≤10；每个角色至少 2 个参考角度。'
    ].join('\n'),
    gates: (body) => {
      const chars = asArray(body.characters) as Array<Record<string, unknown>>;
      const lead = chars.filter((c) => str(c.importance) === 'lead').length;
      const support = chars.filter((c) => str(c.importance) === 'support').length;
      const func = chars.filter((c) => str(c.importance) === 'functional').length;
      const missingAngles = chars.filter((c) => asArray(c.ref_angles).length < 2).map((c) => str(c.name));
      return [
        { id: 'char-count', label: '角色数量合理', pass: chars.length > 0 && chars.length <= 25, detail: '共 ' + chars.length + ' 人' },
        { id: 'char-tiers', label: '分档上限（主角≤5/配角≤10/功能≤10）', pass: lead <= 5 && support <= 10 && func <= 10, detail: '主 ' + lead + ' / 配 ' + support + ' / 功能 ' + func },
        { id: 'char-refs', label: '每人 ≥2 个参考角度', pass: missingAngles.length === 0, detail: missingAngles.length ? '缺角度：' + missingAngles.join('、') : '齐全' }
      ];
    }
  },
  {
    key: 'variety-outline',
    name: '节目大纲五件套',
    group: '开发',
    summary: '节目定位、环节表、情绪点表、分段梗概、资产清单；含爽点间隔与单段时长门。',
    outputs: ['positioning', 'segments[]', 'beats[]', 'synopsis[]', 'assets[]'],
    system: '你是综艺总编剧。' + JSON_RULE,
    user: (ctx) => [
      '节目：' + str(ctx.project.name) + '（' + str(ctx.project.variety_type) + '）',
      '目标：单段 ≤ ' + SEG_CAP + ' 秒，可多段；画幅 ' + str(ctx.project.aspect_ratio),
      '创意：' + ctx.brief.slice(0, 2000),
      '请输出 {"positioning":{"one_liner":"","audience":"","tone":""},"segments":[{"title":"","goal":"","duration_sec":0,"hook":""}],"beats":[{"segment_index":0,"type":"笑点|冲突|反转|泪点|信息","desc":"","at_sec":0}],"synopsis":[{"segment_index":0,"text":""}],"assets":[{"name":"","kind":"scene|prop|costume|broll","note":""}]}',
      '要求：3–8 个环节；每个环节必须有 hook；情绪点间隔不超过 3 个环节；总分镜时长不超过 300 秒/段。'
    ].join('\n'),
    gates: (body) => {
      const segs = asArray(body.segments) as Array<Record<string, unknown>>;
      const beats = asArray(body.beats) as Array<Record<string, unknown>>;
      const hooks = segs.filter((s) => str(s.hook).trim().length > 0).length;
      const durations = segs.map((s) => num(s.duration_sec));
      const idx = beats.map((b) => num(b.segment_index));
      let maxGap = 0;
      for (let i = 1; i < idx.length; i++) maxGap = Math.max(maxGap, idx[i] - idx[i - 1]);
      return [
        { id: 'seg-count', label: '环节数 3–8', pass: segs.length >= 3 && segs.length <= 8, detail: '共 ' + segs.length + ' 个环节' },
        { id: 'seg-hook', label: '每个环节都有钩子', pass: segs.length > 0 && hooks === segs.length, detail: hooks + '/' + segs.length },
        { id: 'seg-cap', label: '单段 ≤300 秒', pass: durations.every((d) => d <= SEG_CAP), detail: '最长 ' + Math.max(0, ...durations) + 's' },
        { id: 'beat-gap', label: '情绪点间隔 ≤3 个环节', pass: maxGap <= 3, detail: '最大间隔 ' + maxGap },
        { id: 'beat-exists', label: '至少 3 个情绪点', pass: beats.length >= 3, detail: beats.length + ' 个' }
      ];
    }
  },
  {
    key: 'variety-script',
    name: '台本（台词 + 表演标签）',
    group: '写作',
    summary: '把大纲写成可拍的台词：发言人对白、表演标签、情绪、预计时长。',
    outputs: ['segments[].rounds[].lines[]'],
    system: '你是综艺台本编剧。' + JSON_RULE,
    user: (ctx) => [
      '节目：' + str(ctx.project.name),
      '角色：' + JSON.stringify(ctx.characters.map((c) => str(c.name))),
      '创意：' + ctx.brief.slice(0, 1500),
      '请输出 {"segments":[{"title":"","rounds":[{"lines":[{"speaker":"","text":"","performance_tags":["（笑）"],"emotion":"friendly_smile","est_sec":0}]}]}]}',
      '要求：每句 ≤40 字（约 8 秒）；表演标签只用（笑）（停顿）（叹气）（提高音量）（压低声音）；不要写镜头描述。'
    ].join('\n'),
    gates: (body) => {
      const segs = asArray(body.segments) as Array<Record<string, unknown>>;
      const lines = segs.flatMap((s) => asArray(s.rounds).flatMap((r) => asArray((r as Record<string, unknown>).lines))) as Array<Record<string, unknown>>;
      const long = lines.filter((l) => str(l.text).length > 40).length;
      const total = lines.reduce((n, l) => n + num(l.est_sec), 0);
      const badTags = lines.filter((l) => asArray(l.performance_tags).some((t) => !/^（(笑|停顿|叹气|提高音量|压低声音)）$/.test(str(t)))).length;
      return [
        { id: 'line-count', label: '有台词产出', pass: lines.length > 0, detail: lines.length + ' 句' },
        { id: 'line-len', label: '单句 ≤40 字', pass: long === 0, detail: long ? long + ' 句超长' : '全部合格' },
        { id: 'line-tags', label: '表演标签规范', pass: badTags === 0, detail: badTags ? badTags + ' 句标签不规范' : '规范' },
        { id: 'line-total', label: '单段总时长 ≤300 秒', pass: total <= SEG_CAP, detail: total + 's' }
      ];
    }
  },
  {
    key: 'variety-staging',
    name: '场景与开场调度',
    group: '视觉',
    summary: '舞台/机位/站位/道具/灯光，开场 5 秒怎么抓人。',
    outputs: ['stage', 'blocking[]', 'props[]', 'lighting', 'opening'],
    system: '你是综艺舞台导演。' + JSON_RULE,
    user: (ctx) => [
      '节目：' + str(ctx.project.name) + '，画幅 ' + str(ctx.project.aspect_ratio),
      '请输出 {"stage":{"desc":"英文场景描述","palette":""},"blocking":[{"who":"","x":0.5,"y":0.6}],"props":[{"name":"","zone":"","note":""}],"lighting":{"key":"","rim":"","practical":""},"opening":{"first_3s":"","first_5s":"","hook":""}}',
      '要求：站位 x/y 在 0–1；道具 ≤8 件；开场必须有 3 秒钩子。'
    ].join('\n'),
    gates: (body) => {
      const blocking = asArray(body.blocking) as Array<Record<string, unknown>>;
      const props = asArray(body.props);
      const out = blocking.filter((b) => num(b.x) < 0 || num(b.x) > 1 || num(b.y) < 0 || num(b.y) > 1).length;
      const opening = (body.opening ?? {}) as Record<string, unknown>;
      return [
        { id: 'stage-desc', label: '舞台描述完整', pass: str((body.stage as Record<string, unknown>)?.desc).length > 30, detail: '英文描述长度 ' + str((body.stage as Record<string, unknown>)?.desc).length },
        { id: 'blocking-range', label: '站位坐标 0–1', pass: out === 0, detail: out ? out + ' 个越界' : '全部合法' },
        { id: 'prop-count', label: '道具 ≤8 件', pass: props.length <= 8, detail: props.length + ' 件' },
        { id: 'opening-hook', label: '开场 3 秒钩子', pass: str(opening.first_3s).trim().length > 0, detail: str(opening.first_3s).slice(0, 40) }
      ];
    }
  },
  {
    key: 'variety-storyboard',
    name: '分镜表（段 → 镜 → 提示词）',
    group: '分镜',
    summary: '按 15 秒段切镜，每镜 2–5 秒，台词装得下，每段一条 H3 提示词。',
    outputs: ['segments[].shots[]', 'segments[].h3_prompt'],
    system: '你是分镜师，熟悉 MiniMax H3 视频提示词写法。' + JSON_RULE,
    user: (ctx) => [
      '节目：' + str(ctx.project.name) + '，画幅 ' + str(ctx.project.aspect_ratio),
      '现有镜头：' + JSON.stringify(ctx.shots.slice(0, 20).map((s) => ({ camera: s.camera, dur: s.duration_ms, text: str(s.text_clean).slice(0, 20) }))),
      '请输出 {"segments":[{"title":"","duration_sec":0,"shots":[{"scale":"特写|近景|中景|全景|空镜","duration_sec":0,"frame_prompt":"中文分镜图提示词（直呼角色名）","shot_prompt":"中文这几秒发生什么","lines_sec":0}],"h3_prompt":"integrated_multimodal_description: ...\\n\\noverall_soundscape: ...\\n\\nnon_diegetic_music: ..."}]}',
      '要求：每段 ≤15 秒；每镜 2–5 秒；lines_sec ≤ 镜头时长；每段必须有一条 h3_prompt。'
    ].join('\n'),
    gates: (body) => {
      const segs = asArray(body.segments) as Array<Record<string, unknown>>;
      const badSeg = segs.filter((s) => num(s.duration_sec) > 15).length;
      const allShots = segs.flatMap((s) => asArray(s.shots) as Array<Record<string, unknown>>);
      const badShot = allShots.filter((s) => num(s.duration_sec) < 2 || num(s.duration_sec) > 5).length;
      const overflow = allShots.filter((s) => num(s.lines_sec) > num(s.duration_sec)).length;
      const badScale = allShots.filter((s) => !CAMERA_ENUM.includes(str(s.scale))).length;
      const missingH3 = segs.filter((s) => !str(s.h3_prompt).includes('integrated_multimodal_description')).length;
      return [
        { id: 'seg-15', label: '每段 ≤15 秒', pass: badSeg === 0, detail: badSeg ? badSeg + ' 段超长' : '合格' },
        { id: 'shot-2-5', label: '每镜 2–5 秒', pass: badShot === 0, detail: badShot ? badShot + ' 镜越界' : '合格' },
        { id: 'lines-fit', label: '台词秒数装得下', pass: overflow === 0, detail: overflow ? overflow + ' 镜超载' : '合格' },
        { id: 'scale-enum', label: '景别枚举合法', pass: badScale === 0, detail: badScale ? badScale + ' 镜非法' : '合格' },
        { id: 'h3-prompt', label: '每段有 H3 提示词', pass: missingH3 === 0, detail: missingH3 ? missingH3 + ' 段缺' : '齐全' }
      ];
    }
  },
  {
    key: 'variety-art',
    name: '视觉资产计划',
    group: '视觉',
    summary: '场景/角色/道具的参考图提示词与 IP-Adapter 一致性方案。',
    outputs: ['items[]'],
    system: '你是 AI 视觉资产导演。' + JSON_RULE,
    user: (ctx) => [
      '节目：' + str(ctx.project.name) + '，风格 ' + str(ctx.project.visual_style),
      '角色：' + JSON.stringify(ctx.characters.map((c) => str(c.name))),
      '请输出 {"items":[{"name":"","kind":"scene|character|prop","prompt":"英文出图提示词","negative":"","refs":["front","side"],"ipadapter_weight":0.7}]}',
      '要求：每个角色至少一条；场景至少 2 条；提示词里不要出现中文文字要求。'
    ].join('\n'),
    gates: (body) => {
      const items = asArray(body.items) as Array<Record<string, unknown>>;
      const chars = items.filter((i) => str(i.kind) === 'character');
      const scenes = items.filter((i) => str(i.kind) === 'scene');
      const bad = items.filter((i) => num(i.ipadapter_weight) > 1 || num(i.ipadapter_weight) < 0).length;
      return [
        { id: 'art-chars', label: '每个角色有资产', pass: chars.length >= 1, detail: chars.length + ' 条角色资产' },
        { id: 'art-scenes', label: '场景 ≥2 条', pass: scenes.length >= 2, detail: scenes.length + ' 条' },
        { id: 'art-weight', label: 'IP-Adapter 权重 0–1', pass: bad === 0, detail: bad ? bad + ' 条越界' : '合法' }
      ];
    }
  },
  {
    key: 'variety-refs',
    name: '角色一致性参考',
    group: '视觉',
    summary: '为每个角色排参考角度与首帧锚定策略，保证换镜不换脸。',
    outputs: ['characters[].refs[]', 'characters[].anchor_policy'],
    system: '你是角色一致性工程师。' + JSON_RULE,
    user: (ctx) => [
      '角色：' + JSON.stringify(ctx.characters.map((c) => ({ name: c.name, seed: c.seed }))),
      '请输出 {"characters":[{"name":"","refs":[{"angle":"front|smile|profile|full","purpose":""}],"anchor_policy":"first_frame|ipadapter|both","seed":0}]}',
      '要求：每个角色 ≥3 个角度；anchor_policy 三选一。'
    ].join('\n'),
    gates: (body) => {
      const chars = (asArray(body.characters).length ? asArray(body.characters) : asArray(body.items)) as Array<Record<string, unknown>>;
      const few = chars.filter((c) => asArray(c.refs).length < 3).map((c) => str(c.name));
      const badPolicy = chars.filter((c) => !['first_frame', 'ipadapter', 'both'].includes(str(c.anchor_policy))).length;
      return [
        { id: 'refs-angles', label: '每角色 ≥3 角度', pass: chars.length > 0 && few.length === 0, detail: chars.length === 0 ? '缺少 characters 字段' : few.length ? '不足：' + few.join('、') : '齐全' },
        { id: 'refs-policy', label: '锚定策略合法', pass: badPolicy === 0, detail: badPolicy ? badPolicy + ' 个非法' : '合法' }
      ];
    }
  }
];

export function skillDef(key: string): SkillDef {
  const def = SKILLS.find((s) => s.key === key);
  if (!def) throw notFound('技能不存在：' + key);
  return def;
}

function contextOf(projectId: number): SkillContext {
  const project = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!project) throw notFound('项目不存在');
  const segments = all('SELECT * FROM segment WHERE project_id = ? ORDER BY seq', [projectId]);
  const shots = all('SELECT s.*, g.seq AS segment_seq FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.project_id = ? ORDER BY g.seq, s.seq', [projectId]);
  const characters = all('SELECT * FROM character_asset WHERE project_id = ? AND is_active = 1', [projectId]);
  const script = get('SELECT raw_md FROM script WHERE project_id = ? ORDER BY version DESC LIMIT 1', [projectId]);
  const brief = String(script?.raw_md ?? '') || [str(project.name), str(project.style_prompt)].join(' ');
  return { project, segments, shots, characters, brief };
}

function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

export async function llmJson(system: string, user: string): Promise<Record<string, unknown>> {
  const key = deepseekKey();
  if (!key) throw new Error('未配置文本模型密钥，无法运行技能');
  const res = await fetch(config.llm.deepseekBase.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.6,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error('模型调用失败 HTTP ' + res.status + '：' + text.slice(0, 200));
  const content = String((JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '');
  const raw = extractJson(content);
  if (!raw) throw new Error('模型没有返回 JSON');
  return JSON.parse(raw) as Record<string, unknown>;
}

export interface RunSkillResult { skill_key: string; version: number; status: string; gates: GateResult[]; body: Record<string, unknown> }

export async function runSkill(projectId: number, key: string, extraBrief?: string): Promise<RunSkillResult> {
  const def = skillDef(key);
  const ctx = contextOf(projectId);
  if (extraBrief) ctx.brief = extraBrief + '\n' + ctx.brief;
  const body = await llmJson(def.system, def.user(ctx));
  const gates = def.gates(body);
  const status = gates.every((g) => g.pass) ? 'passed' : 'needs_revision';
  const last = get('SELECT MAX(version) AS v FROM script_document WHERE project_id = ? AND skill_key = ?', [projectId, key]);
  const version = Number(last?.v ?? 0) + 1;
  run('INSERT INTO script_document (project_id, skill_key, version, status, body, gates, created_at) VALUES (?,?,?,?,?,?,?)', [
    projectId, key, version, status, JSON.stringify(body), JSON.stringify(gates), nowIso()
  ]);
  return { skill_key: key, version, status, gates, body };
}

export function listSkillDocs(projectId: number): Array<Record<string, unknown>> {
  const rows = all('SELECT skill_key, MAX(version) AS v FROM script_document WHERE project_id = ? GROUP BY skill_key', [projectId]);
  return SKILLS.map((s) => {
    const row = rows.find((r) => String(r.skill_key) === s.key);
    const doc = row ? get('SELECT * FROM script_document WHERE project_id = ? AND skill_key = ? AND version = ?', [projectId, s.key, Number(row.v)]) : null;
    return {
      key: s.key, name: s.name, group: s.group, summary: s.summary, outputs: s.outputs,
      version: doc ? Number(doc.version) : 0,
      status: doc ? String(doc.status) : 'empty',
      gates: doc ? json<GateResult[]>(doc.gates, []) : [],
      updated_at: doc ? String(doc.created_at) : null
    };
  });
}

export function getSkillDoc(projectId: number, key: string, version?: number): Record<string, unknown> | null {
  const row = version
    ? get('SELECT * FROM script_document WHERE project_id = ? AND skill_key = ? AND version = ?', [projectId, key, version])
    : get('SELECT * FROM script_document WHERE project_id = ? AND skill_key = ? ORDER BY version DESC LIMIT 1', [projectId, key]);
  if (!row) return null;
  return { ...row, body: json(row.body, {}), gates: json(row.gates, []) };
}
