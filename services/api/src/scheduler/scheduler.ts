/** 调度器（第十章）：依赖晋升、分级并发、重试矩阵、节点看门狗、WebSocket 事件。 */
import { errorMeta, type RenderTask } from '@aurum/core';
import { all, get, nowIso, run } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { mapTask } from '../domain/mappers.js';
import { emit } from '../ws/hub.js';
import { depsSatisfied, executeTask, needsAgent, selectNode } from './executors.js';
import { maybeAutoCompose } from './task-service.js';

interface RunningEntry {
  task_id: number;
  task_type: string;
  started_at: number;
}

const running = new Map<number, RunningEntry>();
let timer: NodeJS.Timeout | null = null;
let ticking = false;

const TYPE_CONCURRENCY: Record<string, () => number> = {
  tts: () => Math.max(1, config.tts.concurrency),
  muse_api: () => Math.max(1, Math.min(3, config.muse.qps)),
  comfy_h3: () => Math.max(1, config.render.h3ConcurrencyPerNode),
  lipsync: () => 2,
  compose: () => 1
};

function runningOfType(type: string): number {
  return Array.from(running.values()).filter((r) => r.task_type === type).length;
}

export function schedulerStats(): Record<string, unknown> {
  return {
    enabled: config.scheduler.enabled,
    running: Array.from(running.values()),
    queued: all("SELECT task_type, COUNT(*) AS n FROM render_task WHERE status = 'pending' GROUP BY task_type"),
    simulate: { comfy: config.comfy.simulate, muse_failure_rate: config.muse.simulateFailureRate }
  };
}

/** 节点看门狗：心跳 > 30s 未到 → offline，任务回收重派（NODE_OFFLINE） */
function watchdog(): void {
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const stale = all<{ id: number; node_key: string }>(
    "SELECT id, node_key FROM agent_node WHERE status = 'online' AND (last_heartbeat IS NULL OR last_heartbeat < ?)",
    [cutoff]
  );
  for (const node of stale) {
    run("UPDATE agent_node SET status = 'offline' WHERE id = ?", [node.id]);
    emit({ type: 'node.offline', payload: { node_id: node.id, node_key: node.node_key } });
    const tasks = all<{ id: number; project_id: number }>(
      "SELECT id, project_id FROM render_task WHERE node_id = ? AND status IN ('assigned','running')",
      [node.id]
    );
    for (const t of tasks) {
      run("UPDATE render_task SET status = 'pending', node_id = NULL, progress = 0, error_code = 'NODE_OFFLINE', error_msg = '节点心跳丢失，任务回收重派' WHERE id = ?", [t.id]);
      emit({ type: 'task.progress', project_id: Number(t.project_id), payload: { task_id: t.id, progress: 0, note: '节点掉线，已转移' } });
    }
  }
}

function retryDecision(task: RenderTask, code: string): { retry: boolean; max: number } {
  const meta = errorMeta(code);
  const max = Math.max(task.max_attempt, meta.maxAttempt);
  if (meta.retry === 'none') return { retry: false, max };
  return { retry: task.attempt + 1 < Math.max(1, max), max };
}

async function runOne(task: RenderTask): Promise<void> {
  const startedAt = Date.now();
  running.set(task.id, { task_id: task.id, task_type: task.task_type, started_at: startedAt });
  run("UPDATE render_task SET status = 'running', started_at = ?, progress = 5 WHERE id = ?", [nowIso(), task.id]);
  emit({ type: 'task.progress', project_id: task.project_id, payload: { task_id: task.id, task_type: task.task_type, shot_id: task.shot_id, progress: 5, status: 'running' } });

  try {
    const result = await executeTask(task);
    const latency = Date.now() - startedAt;
    run("UPDATE render_task SET status = 'success', progress = 100, finished_at = ?, result_asset_id = ?, error_code = NULL, error_msg = NULL, meta = ? WHERE id = ?", [
      nowIso(),
      result && typeof result.asset_id === 'number' ? result.asset_id : null,
      JSON.stringify({ ...(task.meta ?? {}), result }),
      task.id
    ]);
    emit({
      type: 'task.success',
      project_id: task.project_id,
      payload: { task_id: task.id, task_type: task.task_type, shot_id: task.shot_id, latency_ms: latency, result }
    });
    logger.info('任务成功', { service: 'scheduler', task_id: task.id, shot_id: task.shot_id, latency_ms: latency });
  } catch (err) {
    const apiErr = err as { code?: string; message?: string };
    const code = String(apiErr.code ?? 'INTERNAL');
    const message = String(apiErr.message ?? String(err));
    const attempt = task.attempt + 1;
    const decision = retryDecision(task, code);
    if (decision.retry) {
      const degrade = errorMeta(code).retry === 'degrade-once';
      run("UPDATE render_task SET status = 'pending', attempt = ?, max_attempt = ?, error_code = ?, error_msg = ?, node_id = NULL, progress = 0 WHERE id = ?", [
        attempt, decision.max, code, message, task.id
      ]);
      emit({
        type: 'task.progress',
        project_id: task.project_id,
        payload: { task_id: task.id, task_type: task.task_type, shot_id: task.shot_id, progress: 0, retrying: true, error_code: code, note: '自动重试中' }
      });
      logger.warn('任务失败将重试：' + code, { service: 'scheduler', task_id: task.id, attempt, code });
      if (degrade && task.shot_id) {
        run('UPDATE round_shot SET engine_params = json_set(COALESCE(engine_params, \'{}\'), \'$.degraded\', 1) WHERE id = ?', [Number(task.shot_id)]);
      }
    } else {
      run("UPDATE render_task SET status = 'failed', attempt = ?, error_code = ?, error_msg = ?, finished_at = ?, progress = 100 WHERE id = ?", [
        attempt, code, message, nowIso(), task.id
      ]);
      if (task.shot_id) {
        run('UPDATE round_shot SET error_code = ?, updated_at = ? WHERE id = ?', [code, nowIso(), Number(task.shot_id)]);
      }
      emit({
        type: 'task.failed',
        project_id: task.project_id,
        payload: { task_id: task.id, task_type: task.task_type, shot_id: task.shot_id, error_code: code, message, ui_hint: errorMeta(code).uiHint }
      });
      logger.error('任务失败：' + code + ' ' + message, { service: 'scheduler', task_id: task.id, shot_id: task.shot_id });
    }
  } finally {
    running.delete(task.id);
    // 队列排空后自动合成（项目开启 auto_compose 时）
    if (task.task_type !== 'compose') { try { maybeAutoCompose(task.project_id); } catch (e) { logger.warn('自动合成排队失败：' + String(e), { service: 'scheduler' }); } }
  }
}

async function dispatchPending(): Promise<void> {
  const rows = all("SELECT * FROM render_task WHERE status = 'pending' ORDER BY priority ASC, created_at ASC LIMIT 40");
  for (const row of rows) {
    const task = mapTask(row);
    if (running.has(task.id)) continue;
    const concurrency = TYPE_CONCURRENCY[task.task_type]?.() ?? 1;
    if (runningOfType(task.task_type) >= concurrency) continue;

    const dep = depsSatisfied(task);
    if (dep.failed.length > 0) {
      run("UPDATE render_task SET status = 'blocked', error_code = 'PARAM_INVALID', error_msg = ? WHERE id = ?", [
        '上游任务失败（' + dep.failed.join(',') + '），未启动下游',
        task.id
      ]);
      emit({ type: 'task.failed', project_id: task.project_id, payload: { task_id: task.id, task_type: task.task_type, shot_id: task.shot_id, error_code: 'PARAM_INVALID', message: '上游任务失败，已阻断下游' } });
      continue;
    }
    if (!dep.ok) continue;

    if (needsAgent(task)) {
      const tag = task.task_type === 'comfy_h3' ? 'h3' : 'lipsync';
      const node = selectNode(tag);
      if (!node) {
        run("UPDATE render_task SET error_code = 'NODE_OFFLINE', error_msg = '无可用 GPU 节点' WHERE id = ?", [task.id]);
        continue;
      }
      run("UPDATE render_task SET status = 'assigned', node_id = ?, external_task_id = ? WHERE id = ?", [node.id, 'node:' + node.node_key + ':' + task.id, task.id]);
      emit({ type: 'task.assigned', project_id: task.project_id, payload: { task_id: task.id, node_id: node.id, node_key: node.node_key } });
      continue;
    }

    void runOne(task);
  }
}

export async function tickOnce(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    watchdog();
    await dispatchPending();
  } catch (err) {
    logger.error('调度循环异常：' + String(err), { service: 'scheduler' });
  } finally {
    ticking = false;
  }
}

export function startScheduler(): void {
  if (timer || !config.scheduler.enabled) return;
  timer = setInterval(() => void tickOnce(), config.scheduler.tickMs);
  timer.unref?.();
  logger.info('调度器已启动', { service: 'scheduler', tick_ms: config.scheduler.tickMs });
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getRunningTasks(): RunningEntry[] {
  return Array.from(running.values());
}
