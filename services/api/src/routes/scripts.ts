import type { FastifyInstance } from 'fastify';
import { all, get } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { getProject } from '../domain/project-service.js';
import {
  characterBindings, getScript, getLatestScript, listShots, parseOptionsFor, parseScriptDoc, saveScript, structuredToMarkdown,
  complianceOfProject
} from '../domain/script-service.js';
import { parseScript } from '../engine/script-parser.js';
import { SCRIPT_JSON_SCHEMA } from '../engine/script-parser.js';
import { callStructured, listProviders } from '../llm/service.js';
import { normalizeLlmScript, type LlmScriptRaw } from '../orchestration/orchestrator.js';
import type { ParseResult } from '../engine/script-parser.js';

export async function registerScriptRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:id/scripts', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    return all('SELECT id, project_id, parse_status, version, created_at FROM script WHERE project_id = ? ORDER BY version DESC', [projectId]);
  });

  app.post('/projects/:id/scripts', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { raw_md?: string };
    if (!body.raw_md || !body.raw_md.trim()) throw badRequest('缺少台本内容 raw_md');
    const script = saveScript(projectId, body.raw_md);
    reply.status(201);
    return script;
  });

  app.get('/scripts/:scriptId', async (req) => {
    const scriptId = Number((req.params as { scriptId: string }).scriptId);
    const script = getScript(scriptId);
    const shots = listShots(script.project_id);
    return { script, shots, compliance: complianceOfProject(script.project_id) };
  });

  app.get('/scripts/:scriptId/export.md', async (req, reply) => {
    const scriptId = Number((req.params as { scriptId: string }).scriptId);
    const script = getScript(scriptId);
    const md = script.structured_json && 'segments' in script.structured_json
      ? structuredToMarkdown(script.structured_json as never)
      : script.raw_md;
    reply.type('text/markdown; charset=utf-8').send(md);
  });

  app.post('/scripts/:scriptId/parse', async (req) => {
    const scriptId = Number((req.params as { scriptId: string }).scriptId);
    const body = (req.body ?? {}) as { use_llm?: boolean };
    const script = getScript(scriptId);
    const project = getProject(script.project_id);

    let llmResult: ParseResult | null = null;
    const ruleResult = parseScript(script.raw_md, parseOptionsFor(project));
    if (body.use_llm !== false && ruleResult.report.shots < 3 && listProviders().some((p) => p.enabled)) {
      try {
        const characters = characterBindings(project.id).map((c) => ({ role_id: c.role_id, name: c.name, role_type: 'guest' as const, persona: '', voice_hint: '', emotions: [] }));
        const { data, provider, model } = await callStructured<LlmScriptRaw>({
          messages: [
            { role: 'system', content: '你是综艺台本结构化智能体。把台本原文转成结构化 JSON：环节 → 轮次/镜头，保留表演标签与机位，单段不超过 300 秒。' },
            { role: 'user', content: '台本原文：\n' + script.raw_md.slice(0, 12000) }
          ],
          schema: SCRIPT_JSON_SCHEMA as unknown as Record<string, unknown>,
          purpose: 'parse_script',
          project_id: project.id
        });
        const structured = normalizeLlmScript(data, {
          project_id: project.id,
          visual_style: project.visual_style,
          variety_type: project.variety_type,
          title: project.name
        }, characters);
        const shots = structured.segments.reduce((n, s) => n + s.rounds.length, 0);
        llmResult = {
          structured,
          report: {
            segments: structured.segments.length,
            shots,
            estimate_ms: 0,
            used_llm: true,
            source: 'llm',
            warnings: [{ level: 'warn', code: 'LLM_STRUCTURED', message: '规则解析覆盖不足，已使用 ' + provider + '/' + model + ' 结构化兜底' }],
            errors: []
          }
        };
      } catch (err) {
        llmResult = null;
      }
    }

    const outcome = parseScriptDoc(project, scriptId, { llmResult: llmResult ?? undefined });
    return {
      script: outcome.script,
      report: outcome.report,
      compliance: outcome.compliance,
      created_characters: outcome.created_characters,
      shots: listShots(project.id)
    };
  });

  app.post('/projects/:id/parse-preview', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const project = getProject(projectId);
    const body = (req.body ?? {}) as { raw_md?: string };
    if (!body.raw_md || !body.raw_md.trim()) throw badRequest('缺少台本内容 raw_md');
    const result = parseScript(body.raw_md, parseOptionsFor(project));
    const estimated = result.structured.segments.map((seg) => ({
      title: seg.title,
      segment_type: seg.segment_type,
      shots: seg.rounds.length,
      estimate_ms: seg.rounds.reduce((n, r) => n + Number(r.target_duration_ms ?? 3000) + 200, 0)
    }));
    return { ...result, estimated_segments: estimated };
  });

  app.get('/projects/:id/script/latest', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const script = getLatestScript(projectId);
    if (!script) throw notFound('尚未上传台本');
    return script;
  });
}
