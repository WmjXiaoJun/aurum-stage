/** 剧本技能库接口（参照 shuohao-skills 的技能形态，落到综艺台本） */
import type { FastifyInstance } from 'fastify';
import { all, get, json, nowIso, run } from '../db/index.js';
import { SKILLS, skillDef, runSkill, listSkillDocs, getSkillDoc } from '../domain/skills-service.js';
import { badRequest } from '../http/errors.js';
import { runDevelopmentPack } from '../domain/development-pack.js';

export async function registerSkillRoutes(app: FastifyInstance): Promise<void> {
  // 综艺开发包：技能串成流水线，全过后直接落成段与镜头
  app.post('/projects/:id/skills/development-pack', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { brief?: string; withArt?: boolean; withRender?: boolean; render_limit?: number };
    return runDevelopmentPack(projectId, String(body.brief ?? ''), { withArt: body.withArt, withRender: body.withRender, render_limit: body.render_limit });
  });

  app.get('/skills', async () => SKILLS.map((s) => ({ key: s.key, name: s.name, group: s.group, summary: s.summary, outputs: s.outputs })));

  app.get('/projects/:id/skills', async (req) => listSkillDocs(Number((req.params as { id: string }).id)));

  app.get('/projects/:id/skills/:key', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const key = String((req.params as { key: string }).key);
    const version = (req.query as { version?: string }).version;
    const doc = getSkillDoc(projectId, key, version ? Number(version) : undefined);
    return doc ?? { skill_key: key, body: null, gates: [] };
  });

  app.post('/projects/:id/skills/:key/run', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const key = String((req.params as { key: string }).key);
    const body = (req.body ?? {}) as { brief?: string };
    return runSkill(projectId, key, body.brief);
  });

  /** 把技能产物落回台本/分镜（目前支持台本技能：按顺序覆盖镜头台词） */
  app.post('/projects/:id/skills/:key/apply', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const key = String((req.params as { key: string }).key);
    const doc = getSkillDoc(projectId, key);
    if (!doc || !doc.body) throw badRequest('该技能还没有产物，先运行一次');
    if (key !== 'variety-script') return { applied: false, note: '该技能为结构化建议，暂不直接落库' };
    const body = doc.body as { segments?: Array<{ rounds?: Array<{ lines?: Array<{ text?: string; speaker?: string; emotion?: string; est_sec?: number }> }> }> };
    const lines = (body.segments ?? []).flatMap((s) => (s.rounds ?? []).flatMap((r) => r.lines ?? []));
    const shots = all('SELECT id FROM round_shot WHERE project_id = ? ORDER BY segment_id, seq', [projectId]);
    let applied = 0;
    for (let i = 0; i < Math.min(lines.length, shots.length); i++) {
      const line = lines[i];
      const dur = Math.max(1500, Math.round(Number(line.est_sec ?? 4) * 1000));
      run('UPDATE round_shot SET text_clean = ?, lines = ?, emotion = COALESCE(?, emotion), duration_ms = ?, target_duration_ms = ?, updated_at = ? WHERE id = ?', [
        String(line.text ?? ''), JSON.stringify([String(line.text ?? '')]), line.emotion ?? null, dur, dur, nowIso(), Number(shots[i].id)
      ]);
      applied += 1;
    }
    return { applied: true, updated_shots: applied, total_lines: lines.length };
  });
}

void get; void json;
