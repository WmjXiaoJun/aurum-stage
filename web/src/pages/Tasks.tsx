import React, { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp, useAsync, useEvents, useMeta } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Panel, Pill, Skeleton, TaskPill } from '../components/ui';
import { Icon } from '../components/Icon';
import { dateTime, relative } from '../lib/format';
import { errorLabel, taskTypeLabel } from '../lib/zh';
import type { Task, TaskType } from '../lib/types';

const TABS: Array<{ id: 'all' | TaskType; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'tts', label: '配音' },
  { id: 'comfy_h3', label: '本地渲染' },
  { id: 'muse_api', label: '云端渲染' },
  { id: 'lipsync', label: '口型对齐' },
  { id: 'compose', label: '合成' }
];

export function TasksPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const m = useMeta();
  const { data, loading, error, reload } = useAsync(() => api.tasks({ project_id: projectId, limit: 300 }), [projectId]);
  const { data: stats, reload: reloadStats } = useAsync(() => api.schedulerStats(), []);
  const [tab, setTab] = useState<'all' | TaskType>('all');
  const [status, setStatus] = useState<'all' | 'pending' | 'running' | 'success' | 'failed'>('all');

  useEvents(projectId, (event) => {
    if (['task.progress', 'task.success', 'task.failed'].includes(event.type)) {
      window.setTimeout(() => { reload(); reloadStats(); }, 300);
    }
  });

  const tasks = (data ?? []).filter((t) => {
    if (tab !== 'all' && t.task_type !== tab) return false;
    if (status === 'pending' && !['pending', 'assigned', 'blocked'].includes(t.status)) return false;
    if (status === 'running' && t.status !== 'running') return false;
    if (status === 'success' && t.status !== 'success') return false;
    if (status === 'failed' && !['failed', 'timeout', 'canceled'].includes(t.status)) return false;
    return true;
  });

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const t of data ?? []) acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, [data]);

  if (loading && !data) return <div className="panel"><Skeleton rows={6} height={48} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">L3 · 调度与任务</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>任务队列</h1>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          <Button icon="refresh" onClick={() => { reload(); reloadStats(); }}>刷新</Button>
          <Button icon="play" onClick={async () => { await api.tickScheduler(); notify('已手动触发调度 tick', 'success'); reload(); }}>手动调度</Button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="kpi"><div className="kpi-label"><Icon name="clock" size={13} /> 排队</div><div className="kpi-value">{(counts.pending ?? 0) + (counts.assigned ?? 0)}<small>个</small></div><div className="kpi-foot">含已派发给 GPU 节点</div></div>
        <div className="kpi"><div className="kpi-label"><Icon name="wave" size={13} /> 执行中</div><div className="kpi-value">{counts.running ?? 0}<small>个</small></div><div className="kpi-foot">本地生成单机串行</div></div>
        <div className="kpi accent"><div className="kpi-label"><Icon name="check" size={13} /> 成功</div><div className="kpi-value">{counts.success ?? 0}<small>个</small></div><div className="kpi-foot">幂等键去重生效</div></div>
        <div className="kpi"><div className="kpi-label"><Icon name="warn" size={13} /> 失败</div><div className="kpi-value" style={{ color: (counts.failed ?? 0) > 0 ? 'var(--down)' : undefined }}>{(counts.failed ?? 0) + (counts.blocked ?? 0) + (counts.timeout ?? 0)}<small>个</small></div><div className="kpi-foot">点击重试按错误码策略处理</div></div>
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <div className="chips">{TABS.map((t) => <Chip key={t.id} on={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</Chip>)}</div>
        <div className="spacer" />
        <div className="chips">
          {(['all', 'pending', 'running', 'success', 'failed'] as const).map((s) => (
            <Chip key={s} on={status === s} onClick={() => setStatus(s)}>{{ all: '全部状态', pending: '排队', running: '执行中', success: '成功', failed: '失败' }[s]}</Chip>
          ))}
        </div>
      </div>

      <Panel noBody title={'任务 · ' + tasks.length} sub="实时刷新 · 任务状态：排队 → 已派发 → 执行中 → 成功 / 失败">
        {tasks.length === 0 ? (
          <EmptyState title="没有符合条件的任务" desc="提交渲染后任务会出现在这里。" />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>ID</th>
                  <th style={{ width: 96 }}>类型</th>
                  <th style={{ width: 64 }}>镜头</th>
                  <th style={{ width: 110 }}>状态</th>
                  <th style={{ width: 140 }}>进度</th>
                  <th>错误</th>
                  <th style={{ width: 90 }}>重试</th>
                  <th style={{ width: 130 }}>创建</th>
                  <th style={{ width: 130 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td><span className="mono">#{t.id}</span></td>
                    <td><Pill tone={t.task_type === 'muse_api' ? 'gold' : t.task_type === 'comfy_h3' ? 'jade' : null}>{taskTypeLabel(t.task_type)}</Pill></td>
                    <td><span className="mono hint">{t.shot_id ?? '—'}</span></td>
                    <td><TaskPill status={t.status} /></td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <div className="meter" style={{ flex: 1 }}><i style={{ width: t.progress + '%' }} /></div>
                        <span className="mono hint">{t.progress}%</span>
                      </div>
                    </td>
                    <td>{t.error_code ? <span className="pill down" title={t.error_msg ?? ''}>{errorLabel(t.error_code)}</span> : <span className="hint">—</span>}</td>
                    <td><span className="mono hint">{t.attempt}/{t.max_attempt}</span></td>
                    <td><span className="hint" title={dateTime(t.created_at)}>{relative(t.created_at)}</span></td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {['failed', 'timeout', 'canceled', 'blocked'].includes(t.status) && <Button size="small" icon="refresh" onClick={async () => { await api.retryTask(t.id); notify('已重试 #' + t.id, 'success'); reload(); }}>重试</Button>}
                        {['pending', 'assigned', 'running'].includes(t.status) && <Button size="small" kind="danger" onClick={async () => { await api.cancelTask(t.id); notify('已取消 #' + t.id, 'success'); reload(); }}>取消</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="调度器状态" sub="队列积压 / 运行中任务 / 模拟开关">
        {(() => {
          const s = (stats ?? {}) as { running?: unknown[]; simulate?: { comfy?: boolean; muse_failure_rate?: number }; by_status?: Array<{ status: string; n: number }> };
          const total = (s.by_status ?? []).reduce((n, x) => n + Number(x.n ?? 0), 0);
          return (
            <div className="row wrap" style={{ gap: 10 }}>
              <Pill tone="gold">执行中 {s.running?.length ?? 0} 个</Pill>
              <Pill>累计任务 {total} 个</Pill>
              <Pill tone={s.simulate?.comfy ? 'warn' : 'up'} dot>本地渲染 {s.simulate?.comfy ? '模拟模式' : '真实直连'}</Pill>
              <Pill>云端失败演练比例 {Math.round((s.simulate?.muse_failure_rate ?? 0) * 100)}%</Pill>
            </div>
          );
        })()}
      </Panel>
    </>
  );
}
