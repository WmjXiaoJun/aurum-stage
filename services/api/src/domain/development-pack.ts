/**
 * 综艺开发包：把七个技能串成一条流水线
 * 角色 → 大纲 → 台本 → 调度 → 分镜，逐道质量门校验；全过后一次性落成「段 + 镜头」
 */
import { all, get, nowIso, run } from '../db/index.js';
import { runSkill, type GateResult } from './skills-service.js';
import { notFound } from '../http/errors.js';
import { generateCharacterArt } from '../adapters/character-art.js';
import { generatePlanArt } from '../adapters/asset-art.js';
import { autoBindVoice, autoGenerateArtPack } from './character-autopack.js';
import { submitShotRender } from '../scheduler/task-service.js';

export interface PackStep { key: string; name: string; status: 'passed' | 'needs_revision' | 'skipped'; gates: GateResult[] }
export interface PackResult {
  ok: boolean;
  stopped_at: string | null;
  steps: PackStep[];
  created?: { segments: number; shots: number; characters: number; art?: number; plan_art?: number; render_submitted?: number };
}

const STEPS: Array<{ key: string; name: string }> = [
  { key: 'variety-characters', name: '角色圣经' },
  { key: 'variety-outline', name: '节目大纲五件套' },
  { key: 'variety-script', name: '台本' },
  { key: 'variety-staging', name: '场景与开场调度' },
  { key: 'variety-storyboard', name: '分镜表' },
  { key: 'variety-art', name: '视觉资产计划' },
  { key: 'variety-refs', name: '角色一致性参考' }
];

const NON_BLOCKING = ['variety-art', 'variety-refs'];

const CAMERA_MAP: Record<string, string> = {
  特写: 'close_up', 近景: 'medium_close_up', 中景: 'medium_shot', 全景: 'wide', 空镜: 'empty_shot'
};

function asArray(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function num(v: unknown, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function str(v: unknown): string { return v == null ? '' : String(v); }

export interface PackOptions { withArt?: boolean; withRender?: boolean; render_limit?: number }

function styleOf(projectId: number): string { return String(get('SELECT visual_style FROM project WHERE id = ?', [projectId])?.visual_style ?? 'photoreal'); }

export async function runDevelopmentPack(projectId: number, brief: string, input: PackOptions = {}): Promise<PackResult> {
  const project = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!project) throw notFound('项目不存在');
  const steps: PackStep[] = [];
  const docs: Record<string, Record<string, unknown>> = {};

  for (const step of STEPS) {
    let res = await runSkill(projectId, step.key, brief);
    // 未过门时带反馈重试一次，提高全自动成功率
    if (res.status !== 'passed') {
      const feedback = brief + '\n\n上一次未过质量门，请按以下问题修正后重出：\n' + res.gates.filter((g) => !g.pass).map((g) => '- ' + g.label + '：' + g.detail).join('\n');
      res = await runSkill(projectId, step.key, feedback);
    }
    docs[step.key] = res.body as Record<string, unknown>;
    steps.push({ key: step.key, name: step.name, status: res.status as PackStep['status'], gates: res.gates });
    if (res.status !== 'passed' && !NON_BLOCKING.includes(step.key)) {
      return { ok: false, stopped_at: step.name, steps };
    }
  }

  // ---- 全部通过：落库 ----
  const cast = docs['variety-characters'] as { characters?: Array<Record<string, unknown>> };
  const outline = docs['variety-outline'] as { segments?: Array<Record<string, unknown>>; positioning?: Record<string, unknown> };
  const script = docs['variety-script'] as { segments?: Array<Record<string, unknown>> };
  const staging = docs['variety-staging'] as { stage?: Record<string, unknown>; opening?: Record<string, unknown> };
  const storyboard = docs['variety-storyboard'] as { segments?: Array<Record<string, unknown>> };

  let charCount = 0;
  for (const c of cast.characters ?? []) {
    const name = str(c.name);
    if (!name) continue;
    const exists = get('SELECT id FROM character_asset WHERE project_id = ? AND name = ? AND is_active = 1', [projectId, name]);
    if (exists) continue;
    const roleId = 'c_' + name.replace(/\s+/g, '').slice(0, 6);
    run('INSERT INTO character_asset (project_id, role_id, version, name, role_type, persona, prompt_prefix, negative_extra, lock_seed, seed, is_active, anchor_prompt, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)', [
      projectId, roleId, 1, name, str(c.role_type) || 'guest', str(c.persona), str(c.prompt_prefix), '', 1, Math.floor(Math.random() * 1_000_000), '', nowIso()
    ]);
    charCount += 1;
  }

  // 清掉旧段与镜头（开发包是全量重建）
  run('DELETE FROM round_shot WHERE project_id = ?', [projectId]);
  run('DELETE FROM segment WHERE project_id = ?', [projectId]);

  run('UPDATE project SET auto_compose = 1 WHERE id = ?', [projectId]);
  const stageDesc = str(staging.stage?.desc);
  if (stageDesc) run('UPDATE project SET style_prompt = ?, updated_at = ? WHERE id = ?', [stageDesc, nowIso(), projectId]);

  const scriptSegs = script.segments ?? [];
  const boardSegs = storyboard.segments ?? [];
  let segCount = 0;
  let shotCount = 0;

  for (let i = 0; i < scriptSegs.length; i++) {
    const outlineSeg = (outline.segments ?? [])[i] ?? {};
    const title = str(scriptSegs[i].title) || str(outlineSeg.title) || ('环节 ' + (i + 1));
    const boardSeg = boardSegs[i] as Record<string, unknown> | undefined;
    const boardShots = asArray(boardSeg?.shots) as Array<Record<string, unknown>>;
    const lines = asArray(scriptSegs[i].rounds).flatMap((r) => asArray((r as Record<string, unknown>).lines)) as Array<Record<string, unknown>>;
    const lineSec = lines.reduce((n, l) => n + num(l.est_sec, 4), 0);
    const segDur = Math.round((num(outlineSeg.duration_sec, lineSec) || lineSec) * 1000);

    const segRes = run('INSERT INTO segment (project_id, seq, segment_type, title, default_engine, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)', [
      projectId, i + 1, 'talk_round', title, 'muse_api', Math.min(segDur, 300000), nowIso()
    ]);
    segCount += 1;

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const boardShot = boardShots[j] ?? {};
      const camera = CAMERA_MAP[str(boardShot.scale)] ?? 'medium_shot';
      const dur = Math.max(2000, Math.round(num(boardShot.duration_sec, num(line.est_sec, 4)) * 1000));
      const prompt = str(boardShot.frame_prompt) || (stageDesc + ', cinematic lighting');
      const h3 = str(boardSeg?.h3_prompt);
      run('INSERT INTO round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, emotion_instruction, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        projectId, segRes.lastInsertRowid, j + 1, 'DP' + (j + 1), 'c_host', str(line.speaker), camera,
        JSON.stringify([str(line.text)]), str(line.text), str(line.emotion) || 'friendly_smile', '', JSON.stringify(line.performance_tags ?? []),
        prompt, '', '[]', 'muse_api', String(project.visual_style ?? 'photoreal'), JSON.stringify({ h3_prompt: h3 }), 'edge-tts', 'v_host', 1,
        camera === 'close_up' ? 1 : 0, 0, 0, 1, 'empty', dur, dur, nowIso(), nowIso()
      ]);
      shotCount += 1;
    }
  }

  // ---- 自动补角色立绘 + 提交渲染 ----
  const createdCharacters = all('SELECT id FROM character_asset WHERE project_id = ? AND is_active = 1', [projectId]).map((r) => Number(r.id));
  let artCount = 0;
  if (input.withArt !== false) {
    for (const cid of createdCharacters) {
      const has = get('SELECT id FROM character_ref_image WHERE character_id = ? LIMIT 1', [cid]);
      if (has) continue;
      try { const r = await generateCharacterArt({ character_id: cid, modes: ['portrait'], count: 1, style: styleOf(projectId) }); artCount += r.assets.length; } catch { /* 单张失败不影响流水线 */ }
      try { await autoBindVoice(cid); } catch { /* 音色推断失败不影响 */ }
      void autoGenerateArtPack(cid);
    }
  }
  let planArt = 0;
  if (input.withArt !== false) {
    const items = (docs['variety-art'] as { items?: Array<Record<string, unknown>> }).items ?? [];
    try { const r = await generatePlanArt(projectId, items as never, 3); planArt = r.generated; } catch { /* 场景图失败不阻断 */ }
  }
  let renderSubmitted = 0;
  if (input.withRender !== false) {
    const limit = Math.max(1, Math.min(30, Number(input.render_limit ?? 8)));
    const shotsToRender = all('SELECT id FROM round_shot WHERE project_id = ? ORDER BY segment_id, seq LIMIT ?', [projectId, limit]);
    for (const srow of shotsToRender) {
      try { submitShotRender(Number(srow.id), { force: true, candidates: 1 }); renderSubmitted += 1; } catch { /* 时长超限等跳过 */ }
    }
  }

  return { ok: true, stopped_at: null, steps, created: { segments: segCount, shots: shotCount, characters: charCount, art: artCount, plan_art: planArt, render_submitted: renderSubmitted } };
}
