/** 编排智能体 + 聚焦子智能体（26.2/26.3）：阶段状态机、确认门、断点续跑、SSE 事件。 */
import {
  CAMERA_LABEL,
  EMOTIONS,
  STYLE_PRESETS,
  composePrompt,
  emotionSpeed,
  SEGMENT_TYPE_LABEL,
  type Camera,
  type RenderEngine,
  type ScriptRound,
  type ScriptSegment,
  type SegmentType,
  type StructuredScript,
  type VisualStyleId,
  type VarietyType
} from '@aurum/core';
import { all, get, jstr, json, nowIso, run as sqlRun } from '../db/index.js';
import { ApiError, notFound } from '../http/errors.js';
import { logger } from '../logger.js';
import { emit } from '../ws/hub.js';
import { callStructured, listProviders } from '../llm/service.js';
import { SCRIPT_JSON_SCHEMA } from '../engine/script-parser.js';
import {
  fallbackCasting,
  fallbackCharacters,
  fallbackOutline,
  fallbackQa,
  fallbackScript,
  extractKeywords,
  extractTopic,
  type CharSpec,
  type OutlineSeg
} from './fallback.js';
import { persistStructuredScript } from '../domain/script-service.js';
import { getProject } from '../domain/project-service.js';

export const STAGES = [
  { stage: 'characters', agent: '角色 Agent', label: '角色与线索提取' },
  { stage: 'outline', agent: '规划 Agent', label: '分集/分段规划' },
  { stage: 'script', agent: '编剧 Agent', label: '剧本与台本生成' },
  { stage: 'casting', agent: '配音 Agent', label: '角色与音色设定' },
  { stage: 'storyboard', agent: '分镜 Agent', label: '分镜脚本与提示词' },
  { stage: 'qa', agent: '质检 Agent', label: '剧本质检与时长合规' }
] as const;

export type StageName = (typeof STAGES)[number]['stage'];

export interface RunRow {
  id: number;
  project_id: number;
  goal: string;
  source_kind: string;
  source_text: string;
  variety_type: string;
  visual_style: string;
  target_sec: number;
  stage: string;
  status: string;
  outputs: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  script_id: number | null;
  created_at: string;
  updated_at: string;
}

function mapRun(row: Record<string, unknown>): RunRow {
  return {
    id: Number(row.id),
    project_id: Number(row.project_id),
    goal: String(row.goal),
    source_kind: String(row.source_kind),
    source_text: String(row.source_text),
    variety_type: String(row.variety_type),
    visual_style: String(row.visual_style),
    target_sec: Number(row.target_sec),
    stage: String(row.stage),
    status: String(row.status),
    outputs: json<Record<string, unknown>>(row.outputs, {}),
    events: json<Array<Record<string, unknown>>>(row.events, []),
    script_id: row.script_id == null ? null : Number(row.script_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

export function getRun(runId: number): RunRow {
  const row = get('SELECT * FROM agent_run WHERE id = ?', [runId]);
  if (!row) throw notFound('智能体运行不存在');
  return mapRun(row);
}

export function listRuns(projectId: number): RunRow[] {
  return all('SELECT * FROM agent_run WHERE project_id = ? ORDER BY id DESC', [projectId]).map(mapRun);
}

export function stageRows(runId: number): Array<Record<string, unknown>> {
  return all('SELECT * FROM agent_stage WHERE run_id = ? ORDER BY id', [runId]).map((row) => ({
    ...row,
    payload: json<Record<string, unknown>>(row.payload, {})
  }));
}

function appendEvent(runId: number, event: Record<string, unknown>): void {
  const run = getRun(runId);
  const events = [...run.events, { ts: Date.now(), ...event }].slice(-200);
  sqlRun('UPDATE agent_run SET events = ?, updated_at = ? WHERE id = ?', [jstr(events), nowIso(), runId]);
  emit({ type: 'agent.event', project_id: run.project_id, payload: { run_id: runId, ...event } });
}

export interface StartRunInput {
  project_id: number;
  source_kind?: 'idea' | 'novel' | 'material';
  source_text: string;
  goal?: string;
  variety_type?: VarietyType;
  visual_style?: VisualStyleId;
  target_sec?: number;
  auto_confirm?: boolean;
}

export function startRun(input: StartRunInput): RunRow {
  const project = getProject(input.project_id);
  const target = Math.min(300, Math.max(30, Number(input.target_sec ?? 300)));
  const now = nowIso();
  const res = sqlRun(
    'INSERT INTO agent_run (project_id, goal, source_kind, source_text, variety_type, visual_style, target_sec, stage, status, outputs, events, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      input.project_id,
      input.goal ?? extractTopic(input.source_text).slice(0, 40),
      input.source_kind ?? 'idea',
      input.source_text,
      input.variety_type ?? project.variety_type,
      input.visual_style ?? project.visual_style,
      target,
      'characters',
      'running',
      '{}',
      '[]',
      now,
      now
    ]
  );
  const runId = res.lastInsertRowid;
  for (const s of STAGES) {
    sqlRun('INSERT OR IGNORE INTO agent_stage (run_id, stage, agent, status) VALUES (?,?,?,?)', [runId, s.stage, s.agent, 'pending']);
  }
  appendEvent(runId, { type: 'run.started', message: '智能体流水线启动：' + STAGES[0].label });
  void (input.auto_confirm ?? true);
  return getRun(runId);
}

const CHARACTERS_SCHEMA = {
  type: 'object',
  required: ['characters'],
  properties: {
    characters: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['role_id', 'name', 'role_type'],
        properties: {
          role_id: { type: 'string' },
          name: { type: 'string' },
          role_type: { type: 'string', enum: ['host', 'guest', 'narrator', 'virtual', 'judge'] },
          persona: { type: 'string' },
          voice_hint: { type: 'string' },
          emotions: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
} as const;

const OUTLINE_SCHEMA = {
  type: 'object',
  required: ['segments'],
  properties: {
    segments: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        required: ['segment_type', 'title', 'target_sec'],
        properties: {
          segment_type: { type: 'string', enum: ['opening_flash', 'talk_round', 'game_round', 'skit', 'transition', 'ending'] },
          title: { type: 'string' },
          beats: { type: 'array', items: { type: 'string' } },
          target_sec: { type: 'number' }
        }
      }
    }
  }
} as const;

const QA_SCHEMA = {
  type: 'object',
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['level', 'code', 'message'],
        properties: {
          level: { type: 'string', enum: ['error', 'warn'] },
          code: { type: 'string' },
          message: { type: 'string' },
          suggestion: { type: 'string' },
          segment_title: { type: 'string' }
        }
      }
    }
  }
} as const;

function llmAvailable(): boolean {
  return listProviders().some((p) => p.enabled);
}

/** 阶段产物都包在 { engine, ... } 里，取用统一入口，避免嵌套结构散落各处 */
function payloadCharacters(run: RunRow): CharSpec[] {
  const payload = run.outputs.characters as { characters?: CharSpec[] } | undefined;
  return payload?.characters ?? [];
}

function payloadOutline(run: RunRow): OutlineSeg[] {
  const payload = run.outputs.outline as { segments?: OutlineSeg[] } | undefined;
  return payload?.segments ?? [];
}

function payloadScript(run: RunRow): StructuredScript | null {
  const payload = run.outputs.script as { structured?: StructuredScript } | undefined;
  return payload?.structured ?? null;
}

function payloadStoryboard(run: RunRow): StructuredScript | null {
  const payload = run.outputs.storyboard as { structured?: StructuredScript } | undefined;
  return payload?.structured ?? null;
}

async function stageCharacters(run: RunRow): Promise<{ payload: Record<string, unknown> }> {
  if (llmAvailable()) {
    try {
      const { data, provider, model } = await callStructured<{ characters: CharSpec[] }>({
        messages: [
          { role: 'system', content: '你是综艺内容工厂的角色设计智能体。从创意/原文中提取可直接上镜的角色：主持人控场、嘉宾提供具体细节、反方制造冲突。角色必须有可表演的语气特征。' },
          { role: 'user', content: '素材：' + run.source_text.slice(0, 4000) + '\n类型：' + run.variety_type + '\n目标时长：' + run.target_sec + ' 秒' }
        ],
        schema: CHARACTERS_SCHEMA as unknown as Record<string, unknown>,
        purpose: 'characters',
        project_id: run.project_id,
        temperature: 0.7
      });
      return { payload: { engine: provider + '/' + model, characters: data.characters } };
    } catch (err) {
      logger.warn('角色阶段 LLM 失败，回退规则引擎：' + String(err), { service: 'agent' });
    }
  }
  return { payload: { engine: 'rule/fallback', characters: fallbackCharacters(run.source_text, run.variety_type as VarietyType) } };
}

async function stageOutline(run: RunRow): Promise<{ payload: Record<string, unknown> }> {
  const characters = payloadCharacters(run).length > 0 ? payloadCharacters(run) : fallbackCharacters(run.source_text, run.variety_type as VarietyType);
  if (llmAvailable()) {
    try {
      const { data, provider, model } = await callStructured<{ segments: OutlineSeg[] }>({
        messages: [
          { role: 'system', content: '你是综艺分段规划智能体。把素材拆成 4–6 个环节，单段成片硬上限 300 秒，必须保证每段 target_sec 之和接近目标总时长且单段不超过 300。环节类型只能用给定枚举。' },
          { role: 'user', content: '素材：' + run.source_text.slice(0, 3000) + '\n角色：' + characters.map((c) => c.name + '(' + c.role_type + ')').join('、') + '\n目标总时长：' + run.target_sec + ' 秒' }
        ],
        schema: OUTLINE_SCHEMA as unknown as Record<string, unknown>,
        purpose: 'outline',
        project_id: run.project_id,
        temperature: 0.6
      });
      return { payload: { engine: provider + '/' + model, segments: data.segments } };
    } catch (err) {
      logger.warn('规划阶段 LLM 失败，回退规则引擎：' + String(err), { service: 'agent' });
    }
  }
  return { payload: { engine: 'rule/fallback', segments: fallbackOutline(run.source_text, run.variety_type as VarietyType, run.target_sec) } };
}

export interface LlmScriptRaw {
  title?: string;
  segments: Array<{
    segment_type: SegmentType;
    title: string;
    default_engine?: RenderEngine;
    rounds: Array<{
      speaker_name?: string;
      speaker_role_id?: string;
      camera?: Camera;
      lines?: string[];
      emotion?: string;
      emotion_instruction?: string;
      performance_tags?: string[];
      visual_prompt?: string;
      target_duration_ms?: number;
    }>;
  }>;
}

export interface NormalizeScriptContext {
  project_id: number;
  visual_style: string;
  variety_type: string;
  title: string;
}

export function normalizeLlmScript(raw: LlmScriptRaw, run: NormalizeScriptContext, characters: CharSpec[]): StructuredScript {
  const preset = STYLE_PRESETS[run.visual_style as VisualStyleId] ?? STYLE_PRESETS.photoreal;
  const byName = new Map(characters.map((c) => [c.name, c]));
  const segments: ScriptSegment[] = raw.segments.map((seg, sIdx) => {
    const rounds: ScriptRound[] = (seg.rounds ?? []).map((r, rIdx) => {
      const name = r.speaker_name ?? '';
      const char = byName.get(name);
      const roleId = r.speaker_role_id ?? char?.role_id ?? null;
      const lines = (r.lines ?? []).filter((l) => typeof l === 'string');
      const text = lines.join(' ');
      const emotionId = EMOTIONS.some((e) => e.id === r.emotion) ? String(r.emotion) : 'friendly_smile';
      const speed = emotionSpeed(emotionId, 1);
      const camera: Camera = (['wide', 'medium_shot', 'medium_close_up', 'close_up', 'extreme_close_up', 'over_shoulder', 'empty_shot', 'pov', 'two_shot'] as Camera[]).includes(r.camera as Camera)
        ? (r.camera as Camera)
        : Array.from(text).length <= 18 ? 'close_up' : 'medium_shot';
      const chars = Array.from(text.replace(/\s/g, '')).length;
      const dur = Math.max(1200, Math.round((chars / 4.8) * 1000 / speed) + 200);
      return {
        round_id: 'r_' + String(sIdx + 1).padStart(2, '0') + '_' + String(rIdx + 1).padStart(2, '0'),
        speaker_role_id: roleId,
        speaker_name: name || null,
        camera,
        lines,
        emotion: emotionId,
        emotion_instruction: r.emotion_instruction ?? '',
        performance_tags: (r.performance_tags ?? []).map((t) => ({ type: 'tag' as const, tag: t })),
        visual_prompt: r.visual_prompt || composePrompt({ styleId: run.visual_style, content: text.slice(0, 24), anchor: name, camera_language: CAMERA_LABEL[camera] }),
        overlays: name ? [{ type: 'name_tag', text: name }] : [],
        engine_params: { engine: seg.default_engine ?? 'muse_api' },
        tts: { engine: 'indextts2', voice_id: roleId ? 'v_' + roleId.replace('c_', '') : 'v_narrator', speed },
        lipsync_required: camera === 'close_up' || camera === 'medium_close_up',
        target_duration_ms: dur
      };
    });
    return {
      segment_id: 's_' + String(sIdx + 1).padStart(2, '0'),
      segment_type: seg.segment_type,
      title: seg.title,
      default_engine: seg.default_engine ?? 'muse_api',
      visual_style: run.visual_style as VisualStyleId,
      rounds
    };
  });
  return {
    project_id: run.project_id,
    variety_type: run.variety_type as VarietyType,
    visual_style: run.visual_style as VisualStyleId,
    global: {
      title: raw.title ?? run.title,
      aspect_ratio: '16:9',
      fps: 25,
      style_prompt: preset.prefix,
      style_negative: preset.negative,
      subtitle_style_id: 'st_variety_01',
      bgm_id: 'bgm_light_talk_01'
    },
    segments
  };
}

async function stageScript(run: RunRow): Promise<{ payload: Record<string, unknown> }> {
  const characters = payloadCharacters(run).length > 0 ? payloadCharacters(run) : fallbackCharacters(run.source_text, run.variety_type as VarietyType);
  const outline = payloadOutline(run).length > 0 ? payloadOutline(run) : fallbackOutline(run.source_text, run.variety_type as VarietyType, run.target_sec);
  if (llmAvailable()) {
    try {
      const { data, provider, model } = await callStructured<LlmScriptRaw>({
        messages: [
          {
            role: 'system',
            content:
              '你是综艺编剧智能体。按给定环节生成可直接拍摄的台本。要求：每句话 12–34 个中文字；台词里可写表演标签如（笑）（停顿半秒）（压低声音）；情绪只能用给定 id：' +
              EMOTIONS.map((e) => e.id).join('/') +
              '；每个 round 必须绑定 speaker_name（来自角色列表）；镜头语言写清景别/构图/光线。单环节总时长不得超过 300 秒。'
          },
          {
            role: 'user',
            content:
              '素材：' + run.source_text.slice(0, 2500) +
              '\n角色：' + JSON.stringify(characters.map((c) => ({ name: c.name, role_type: c.role_type, persona: c.persona }))) +
              '\n环节规划：' + JSON.stringify(outline) +
              '\n目标总时长：' + run.target_sec + ' 秒\n输出 JSON。'
          }
        ],
        schema: SCRIPT_JSON_SCHEMA as unknown as Record<string, unknown>,
        purpose: 'script',
        project_id: run.project_id,
        temperature: 0.8
      });
      const structured = normalizeLlmScript(data, {
        project_id: run.project_id,
        visual_style: run.visual_style,
        variety_type: run.variety_type,
        title: run.goal
      }, characters);
      const shots = structured.segments.reduce((n, s) => n + s.rounds.length, 0);
      if (shots < 3) throw new Error('LLM 产出镜头过少（' + shots + '）');
      return { payload: { engine: provider + '/' + model, structured } };
    } catch (err) {
      logger.warn('剧本阶段 LLM 失败，回退规则引擎：' + String(err), { service: 'agent' });
    }
  }
  const structured = fallbackScript({
    project_id: run.project_id,
    title: run.goal,
    sourceText: run.source_text,
    varietyType: run.variety_type as VarietyType,
    visualStyle: run.visual_style as VisualStyleId,
    targetSec: run.target_sec,
    characters,
    outline
  });
  return { payload: { engine: 'rule/fallback', structured } };
}

async function stageCasting(run: RunRow): Promise<{ payload: Record<string, unknown> }> {
  const characters = payloadCharacters(run);
  return { payload: { engine: 'rule/voice-map', voices: fallbackCasting(characters) } };
}

async function stageStoryboard(run: RunRow): Promise<{ payload: Record<string, unknown> }> {
  const structured = payloadScript(run);
  if (!structured) return { payload: { engine: 'rule/storyboard', shots: 0 } };
  const preset = STYLE_PRESETS[(structured.visual_style ?? run.visual_style) as VisualStyleId] ?? STYLE_PRESETS.photoreal;
  const clues = extractKeywords(run.source_text).slice(0, 3);
  let count = 0;
  const patched: StructuredScript = {
    ...structured,
    segments: structured.segments.map((seg) => ({
      ...seg,
      rounds: seg.rounds.map((round) => {
        count += 1;
        const engine: RenderEngine = round.engine_params?.engine as RenderEngine ?? seg.default_engine;
        return {
          ...round,
          visual_prompt: composePrompt({
            styleId: structured.visual_style,
            content: round.visual_prompt ?? (round.lines ?? []).join(' ').slice(0, 30),
            anchor: (round.speaker_name ?? '') + (clues.length ? ' · ' + clues.join('/') : ''),
            camera_language: CAMERA_LABEL[round.camera] ?? round.camera,
            style: preset.prefix.split(',')[0]
          }),
          engine_params: { engine, ...(preset.engine_params[engine] ?? {}) },
          overlays: (round.overlays && round.overlays.length > 0) ? round.overlays : (round.speaker_name ? [{ type: 'name_tag' as const, text: round.speaker_name }] : [])
        };
      })
    }))
  };
  return { payload: { engine: 'rule/storyboard', shots: count, clues, structured: patched } };
}

async function stageQa(run: RunRow): Promise<{ payload: Record<string, unknown> }> {
  const structured = payloadStoryboard(run) ?? payloadScript(run);
  if (!structured) throw new ApiError('AGENT_STAGE_LOCKED', '缺少剧本产物，无法质检');
  let issues = fallbackQa(structured, run.target_sec);
  let engine = 'rule/qa';
  if (llmAvailable()) {
    try {
      const { data, provider, model } = await callStructured<{ issues: typeof issues }>({
        messages: [
          { role: 'system', content: '你是综艺质检智能体。检查逻辑漏洞、角色矛盾、场景跳跃、空台词、时长超限（单段 300 秒硬上限）、合规风险。只输出问题数组。' },
          { role: 'user', content: '台本 JSON：' + JSON.stringify(structured).slice(0, 6000) }
        ],
        schema: QA_SCHEMA as unknown as Record<string, unknown>,
        purpose: 'qa',
        project_id: run.project_id,
        temperature: 0.3
      });
      if (Array.isArray(data.issues) && data.issues.length > 0) issues = data.issues;
      engine = provider + '/' + model;
    } catch (err) {
      logger.warn('质检阶段 LLM 失败，回退规则引擎：' + String(err), { service: 'agent' });
    }
  }
  return { payload: { engine, issues } };
}

export async function runStage(runId: number, stage?: StageName): Promise<RunRow> {
  const run = getRun(runId);
  const target = stage ?? (run.stage as StageName);
  if (!STAGES.some((s) => s.stage === target)) throw new ApiError('PARAM_INVALID', '未知阶段：' + target);
  const stageRow = get('SELECT * FROM agent_stage WHERE run_id = ? AND stage = ?', [runId, target]);
  if (stageRow && String(stageRow.status) === 'done' && !stage) {
    return run;
  }
  const startedAt = nowIso();
  sqlRun('UPDATE agent_stage SET status = ?, started_at = ? WHERE run_id = ? AND stage = ?', ['running', startedAt, runId, target]);
  appendEvent(runId, { type: 'stage.started', stage: target, agent: STAGES.find((s) => s.stage === target)?.agent, message: '开始：' + STAGES.find((s) => s.stage === target)?.label });

  try {
    let payload: Record<string, unknown> = {};
    if (target === 'characters') payload = (await stageCharacters(run)).payload;
    else if (target === 'outline') payload = (await stageOutline(run)).payload;
    else if (target === 'script') payload = (await stageScript(run)).payload;
    else if (target === 'casting') payload = (await stageCasting(run)).payload;
    else if (target === 'storyboard') payload = (await stageStoryboard(run)).payload;
    else if (target === 'qa') payload = (await stageQa(run)).payload;

    const outputs: Record<string, unknown> = { ...run.outputs, [target]: payload };
    const idx = STAGES.findIndex((s) => s.stage === target);
    const next = idx + 1 < STAGES.length ? STAGES[idx + 1].stage : 'done';
    const summary = summarize(target, payload);
    sqlRun('UPDATE agent_stage SET status = ?, finished_at = ?, summary = ?, payload = ? WHERE run_id = ? AND stage = ?', [
      'done', nowIso(), summary, jstr(payload), runId, target
    ]);
    sqlRun('UPDATE agent_run SET outputs = ?, stage = ?, status = ?, updated_at = ? WHERE id = ?', [
      jstr(outputs), next, next === 'done' ? 'ready' : 'running', nowIso(), runId
    ]);
    appendEvent(runId, { type: 'stage.done', stage: target, agent: STAGES[idx].agent, message: summary, engine: payload.engine });
    return getRun(runId);
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'INTERNAL';
    sqlRun('UPDATE agent_stage SET status = ?, finished_at = ?, summary = ? WHERE run_id = ? AND stage = ?', ['failed', nowIso(), String((err as Error).message).slice(0, 200), runId, target]);
    sqlRun('UPDATE agent_run SET status = ?, updated_at = ? WHERE id = ?', ['failed', nowIso(), runId]);
    appendEvent(runId, { type: 'stage.failed', stage: target, message: String((err as Error).message).slice(0, 200), code });
    throw err;
  }
}

function summarize(stage: StageName, payload: Record<string, unknown>): string {
  if (stage === 'characters') {
    const chars = (payload.characters as CharSpec[]) ?? [];
    return '提取 ' + chars.length + ' 个角色：' + chars.map((c) => c.name).join('、');
  }
  if (stage === 'outline') {
    const segs = (payload.segments as OutlineSeg[]) ?? [];
    return '规划 ' + segs.length + ' 个环节，合计 ' + segs.reduce((n, s) => n + s.target_sec, 0) + ' 秒';
  }
  if (stage === 'script') {
    const structured = payload.structured as StructuredScript | undefined;
    const shots = structured?.segments.reduce((n, s) => n + s.rounds.length, 0) ?? 0;
    return '生成 ' + (structured?.segments.length ?? 0) + ' 个环节 / ' + shots + ' 个镜头';
  }
  if (stage === 'casting') {
    const voices = (payload.voices as unknown[]) ?? [];
    return '绑定 ' + voices.length + ' 条音色';
  }
  if (stage === 'storyboard') {
    return '完成 ' + (payload.shots ?? 0) + ' 个镜头的分镜提示词与引擎参数';
  }
  if (stage === 'qa') {
    const issues = (payload.issues as unknown[]) ?? [];
    const errors = (payload.issues as Array<{ level: string }> ?? []).filter((i) => i.level === 'error').length;
    return '质检完成：' + issues.length + ' 项问题（' + errors + ' 项阻断）';
  }
  return '完成';
}

export async function advance(runId: number): Promise<RunRow> {
  const run = getRun(runId);
  if (run.stage === 'done') return run;
  return runStage(runId, run.stage as StageName);
}

/** 确认门（26.3）：approve → 自动跑下一阶段；reject → 带反馈重跑当前阶段 */
export async function confirmStage(runId: number, input: { stage?: StageName; approve: boolean; feedback?: string }): Promise<RunRow> {
  const run = getRun(runId);
  const stage = input.stage ?? (run.stage as StageName);
  appendEvent(runId, { type: 'stage.confirm', stage, message: input.approve ? '编导确认通过' : '编导打回：' + (input.feedback ?? ''), approve: input.approve });
  if (!input.approve) {
    const idx = STAGES.findIndex((s) => s.stage === stage);
    if (idx >= 0) {
      const outputs = { ...run.outputs };
      delete outputs[stage];
      sqlRun('UPDATE agent_run SET outputs = ?, stage = ?, status = ?, updated_at = ? WHERE id = ?', [jstr(outputs), stage, 'running', nowIso(), runId]);
      sqlRun('UPDATE agent_stage SET status = ? WHERE run_id = ? AND stage = ?', ['pending', runId, stage]);
      for (const s of STAGES.slice(idx + 1)) sqlRun('UPDATE agent_stage SET status = ? WHERE run_id = ? AND stage = ?', ['pending', runId, s.stage]);
    }
    return getRun(runId);
  }
  return advance(runId);
}

export async function runAll(runId: number, autoConfirm = true): Promise<RunRow> {
  let run = getRun(runId);
  let guard = 0;
  while (run.stage !== 'done' && guard < STAGES.length + 2) {
    guard += 1;
    run = await advance(runId);
    const stageRow = get('SELECT * FROM agent_stage WHERE run_id = ? AND stage = ?', [runId, run.events.length ? (run.events[run.events.length - 1].stage ?? 'characters') : 'characters']);
    void stageRow;
    if (!autoConfirm) break;
  }
  return getRun(runId);
}

/** 把智能体产物落到项目：角色、音色、台本、镜头（走与人工台本相同的校验与时长复算） */
export function applyRun(runId: number): { script_id: number; created_characters: string[]; segments: number; shots: number; compliance: unknown } {
  const run = getRun(runId);
  const project = getProject(run.project_id);
  const characters = payloadCharacters(run);
  const voices = (run.outputs.casting as { voices: Array<{ role_id: string; voice_id: string; provider: string; base_speed: number; emotions: string[]; forbidden: string }> })?.voices ?? [];
  const structured = payloadStoryboard(run) ?? payloadScript(run);
  if (!structured) throw new ApiError('AGENT_STAGE_LOCKED', '剧本尚未生成，无法落入项目');

  for (const c of characters) {
    const existing = get('SELECT id FROM character_asset WHERE project_id = ? AND role_id = ? AND version = 1', [project.id, c.role_id]);
    if (existing) {
      sqlRun('UPDATE character_asset SET name = ?, persona = ?, role_type = ? WHERE id = ?', [c.name, c.persona ?? '', c.role_type, Number(existing.id)]);
    } else {
      sqlRun('INSERT INTO character_asset (project_id, role_id, version, name, role_type, persona, prompt_prefix, negative_extra, lock_seed, seed, is_active, anchor_prompt, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        project.id, c.role_id, 1, c.name, c.role_type, c.persona ?? '', c.voice_hint ?? '', '', 1, Math.floor(Math.random() * 1_000_000), 1, '', nowIso()
      ]);
    }
  }
  for (const v of voices) {
    const existing = get('SELECT id FROM voice_asset WHERE project_id = ? AND voice_id = ?', [project.id, v.voice_id]);
    if (existing) {
      sqlRun('UPDATE voice_asset SET available_emotions = ?, base_speed = ?, forbidden = ?, role_id = ? WHERE id = ?', [
        jstr(v.emotions ?? []), v.base_speed ?? 1, v.forbidden ?? '', v.role_id, Number(existing.id)
      ]);
    } else {
      sqlRun('INSERT INTO voice_asset (project_id, voice_id, role_id, provider, base_speed, available_emotions, forbidden, is_active, created_at) VALUES (?,?,?,?,?,?,?,1,?)', [
        project.id, v.voice_id, v.role_id, v.provider ?? 'indextts2', v.base_speed ?? 1, jstr(v.emotions ?? []), v.forbidden ?? '', nowIso()
      ]);
    }
  }

  const persisted = persistStructuredScript(project, structured);
  const qaIssues = (run.outputs.qa as { issues: Array<{ level: 'error' | 'warn'; code: string; message: string; suggestion?: string; segment_title?: string }> })?.issues ?? [];
  sqlRun('DELETE FROM quality_issue WHERE project_id = ? AND run_id = ?', [project.id, run.id]);
  for (const issue of qaIssues) {
    sqlRun('INSERT INTO quality_issue (project_id, run_id, level, code, message, suggestion, resolved, created_at) VALUES (?,?,?,?,?,?,0,?)', [
      project.id, run.id, issue.level, issue.code, issue.message, issue.suggestion ?? '', nowIso()
    ]);
  }
  sqlRun('UPDATE agent_run SET status = ?, updated_at = ?, script_id = ? WHERE id = ?', ['applied', nowIso(), persisted.script_id, run.id]);
  appendEvent(runId, { type: 'run.applied', message: '已落入项目：' + persisted.segments + ' 个环节 / ' + persisted.shots + ' 个镜头' });
  return {
    script_id: persisted.script_id,
    created_characters: persisted.created_characters,
    segments: persisted.segments,
    shots: persisted.shots,
    compliance: persisted.compliance
  };
}

export { SEGMENT_TYPE_LABEL };
