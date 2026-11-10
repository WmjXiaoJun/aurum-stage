import type { FastifyInstance } from 'fastify';
import { all, get } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import {
  STAGES, advance, applyRun, confirmStage, getRun, listRuns, runAll, runStage, stageRows, startRun
} from '../orchestration/orchestrator.js';

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agents/stages', async () => STAGES);

  app.get('/projects/:id/agents/runs', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    return listRuns(projectId).map((run) => ({ ...run, stages: stageRows(run.id) }));
  });

  app.post('/projects/:id/agents/run', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.source_text) throw badRequest('缺少创意/原文 source_text');
    const run = startRun({
      project_id: projectId,
      source_text: String(body.source_text),
      source_kind: (body.source_kind as 'idea' | 'novel' | 'material') ?? 'idea',
      goal: body.goal ? String(body.goal) : undefined,
      target_sec: body.target_sec ? Number(body.target_sec) : undefined,
      auto_confirm: body.auto_confirm !== false
    });
    reply.status(201);
    if (body.auto_run !== false) {
      void runAll(run.id, true).catch(() => undefined);
    }
    return { ...getRun(run.id), stages: stageRows(run.id) };
  });

  app.get('/agents/runs/:runId', async (req) => {
    const runId = Number((req.params as { runId: string }).runId);
    const run = getRun(runId);
    return {
      ...run,
      stages: stageRows(runId),
      issues: all('SELECT * FROM quality_issue WHERE run_id = ? ORDER BY id', [runId])
    };
  });

  app.post('/agents/runs/:runId/step', async (req) => {
    const runId = Number((req.params as { runId: string }).runId);
    const body = (req.body ?? {}) as { stage?: string };
    const run = body.stage ? await runStage(runId, body.stage as never) : await advance(runId);
    return { ...run, stages: stageRows(runId) };
  });

  app.post('/agents/runs/:runId/run-all', async (req) => {
    const runId = Number((req.params as { runId: string }).runId);
    const run = await runAll(runId, true);
    return { ...run, stages: stageRows(runId) };
  });

  app.post('/agents/runs/:runId/confirm', async (req) => {
    const runId = Number((req.params as { runId: string }).runId);
    const body = (req.body ?? {}) as { stage?: string; approve?: boolean; feedback?: string; rerun?: boolean };
    const run = await confirmStage(runId, {
      stage: body.stage as never,
      approve: body.approve !== false,
      feedback: body.feedback
    });
    if (body.rerun) {
      const after = await advance(runId);
      return { ...after, stages: stageRows(runId) };
    }
    return { ...run, stages: stageRows(runId) };
  });

  app.post('/agents/runs/:runId/apply', async (req) => {
    const runId = Number((req.params as { runId: string }).runId);
    return applyRun(runId);
  });

  /** SSE 流式事件（26.6 智能体面板） */
  app.get('/agents/runs/:runId/stream', async (req, reply) => {
    const runId = Number((req.params as { runId: string }).runId);
    const run = getRun(runId);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    let cursor = 0;
    const send = (event: string, data: unknown) => {
      reply.raw.write('event: ' + event + '\n' + 'data: ' + JSON.stringify(data) + '\n\n');
    };
    send('run.snapshot', { run: { ...run, stages: stageRows(runId) }, stages: STAGES });
    send('run.stage', { stage: run.stage, status: run.status });
    const timer = setInterval(() => {
      try {
        const fresh = getRun(runId);
        const events = fresh.events;
        if (events.length > cursor) {
          for (const ev of events.slice(cursor)) send(String(ev.type ?? 'event'), ev);
          cursor = events.length;
        }
        send('run.stage', { stage: fresh.stage, status: fresh.status });
        if (['ready', 'applied', 'failed'].includes(fresh.status)) {
          send('run.end', { status: fresh.status });
          clearInterval(timer);
          reply.raw.end();
        }
      } catch {
        clearInterval(timer);
        reply.raw.end();
      }
    }, 500);
    const stop = setTimeout(() => {
      clearInterval(timer);
      try { reply.raw.end(); } catch { /* ignore */ }
    }, 120_000);
    req.raw.on('close', () => {
      clearInterval(timer);
      clearTimeout(stop);
    });
  });
}
