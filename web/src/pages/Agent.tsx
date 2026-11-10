import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync, useMeta } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Field, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../lib/router';
import { relative } from '../lib/format';
import { engineLabel, eventLabel, modelLabel } from '../lib/zh';
import type { AgentRun } from '../lib/types';

const STAGE_META: Record<string, { label: string; agent: string }> = {
  characters: { label: '角色与线索提取', agent: '角色 Agent' },
  outline: { label: '分集 / 分段规划', agent: '规划 Agent' },
  script: { label: '剧本与台本生成', agent: '编剧 Agent' },
  casting: { label: '角色与音色设定', agent: '配音 Agent' },
  storyboard: { label: '分镜与提示词', agent: '分镜 Agent' },
  qa: { label: '剧本质检与时长合规', agent: '质检 Agent' }
};

export function AgentPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify, meta } = useApp();
  const m = useMeta();
  const { data: runs, loading, error, reload } = useAsync(() => api.agentRuns(projectId), [projectId]);
  const [runId, setRunId] = useState<number | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const [form, setForm] = useState({
    source_text: '三个连续创业者聊为什么九成 AI 产品死在 Demo 阶段：他们在融资、招人、定义需求上三次翻车，最后用一周做出了能卖的东西。',
    source_kind: 'idea',
    goal: '',
    target_sec: 180,
    auto_confirm: true
  });

  useEffect(() => {
    const latest = (runs ?? [])[0];
    if (!runId && latest) setRunId(latest.id);
  }, [runs, runId]);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    api.agentRun(runId).then((r) => { if (alive) { setRun(r); setEvents((r.events ?? []) as Array<Record<string, unknown>>); } }).catch(() => undefined);
    esRef.current?.close();
    const es = new EventSource('/api/v1/agents/runs/' + runId + '/stream');
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type) setEvents((prev) => [...prev.slice(-200), data]);
      } catch { /* ignore */ }
    };
    es.addEventListener('stage.done', (ev) => {
      try { const data = JSON.parse((ev as MessageEvent).data); setEvents((prev) => [...prev.slice(-200), data]); } catch { /* ignore */ }
      api.agentRun(runId).then((r) => setRun(r)).catch(() => undefined);
      reload();
    });
    es.addEventListener('run.end', () => {
      api.agentRun(runId).then((r) => { setRun(r); reload(); }).catch(() => undefined);
      es.close();
    });
    return () => { alive = false; es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const start = async () => {
    setStarting(true);
    try {
      const created = await api.startAgentRun(projectId, {
        source_text: form.source_text,
        source_kind: form.source_kind,
        goal: form.goal || undefined,
        target_sec: form.target_sec,
        auto_run: true,
        auto_confirm: form.auto_confirm
      });
      setRunId(created.id);
      notify('智能体流水线已启动', 'success');
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
    finally { setStarting(false); }
  };

  const step = async () => {
    if (!runId) return;
    setBusy('step');
    try { const r = await api.stepAgentRun(runId); setRun(r); reload(); } catch (err) { notify((err as ApiError).message, 'error'); }
    finally { setBusy(null); }
  };

  const confirm = async (approve: boolean) => {
    if (!runId || !run) return;
    setBusy('confirm');
    try {
      const r = await api.confirmAgentStage(runId, { stage: run.stage, approve, feedback: approve ? undefined : '编导打回：请重写该阶段' });
      setRun(r);
      reload();
      notify(approve ? '已确认，进入下一阶段' : '已打回，等待重跑', approve ? 'success' : 'info');
    } catch (err) { notify((err as ApiError).message, 'error'); }
    finally { setBusy(null); }
  };

  const apply = async () => {
    if (!runId) return;
    setBusy('apply');
    try {
      const res = await api.applyAgentRun(runId);
      notify('已落入项目：' + res.segments + ' 个环节 / ' + res.shots + ' 个镜头', 'success');
      navigate('/project/' + projectId + '/overview');
    } catch (err) { notify((err as ApiError).message, 'error'); }
    finally { setBusy(null); }
  };

  const stages = useMemo(() => run?.stages ?? [], [run]);
  const doneCount = stages.filter((s) => s.status === 'done').length;
  const issues = useMemo(() => {
    const qa = (run?.outputs as Record<string, { issues?: Array<{ level: string; code: string; message: string; suggestion?: string }> }> | undefined)?.qa;
    return qa?.issues ?? [];
  }, [run]);

  if (loading && !runs) return <div className="panel"><Skeleton rows={4} height={80} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">26 · 智能体编排与多 LLM 适配</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>一句话创意 → 台本 → 分镜</h1>
        </div>
        <div className="spacer" />
        <Button icon="model" onClick={() => navigate('/models')}>模型设置</Button>
      </div>

      <div className="split" style={{ gridTemplateColumns: '420px 1fr' }}>
        <Panel title="创意 / 原文入口" sub="编排 Agent 会自动调度 6 个聚焦子智能体，逐阶段返回摘要">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="素材类型">
              <div className="chips">
                {[{ id: 'idea', label: '一句话创意' }, { id: 'novel', label: '小说 / 原文' }, { id: 'material', label: '资料 / 采访稿' }].map((t) => (
                  <Chip key={t.id} on={form.source_kind === t.id} onClick={() => setForm({ ...form, source_kind: t.id })}>{t.label}</Chip>
                ))}
              </div>
            </Field>
            <Field label="素材正文">
              <textarea className="textarea" rows={6} value={form.source_text} onChange={(e) => setForm({ ...form, source_text: e.target.value })} />
            </Field>
            <div className="grid-2">
              <Field label="目标总时长（秒）">
                <input className="input mono" type="number" min={30} max={300} value={form.target_sec} onChange={(e) => setForm({ ...form, target_sec: Number(e.target.value) })} />
              </Field>
              <Field label="项目标题（可选）">
                <input className="input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="默认取素材首句" />
              </Field>
            </div>
            <div className="row">
              <Chip on={form.auto_confirm} onClick={() => setForm({ ...form, auto_confirm: !form.auto_confirm })}>自动通过确认门</Chip>
              <div className="spacer" />
              <Button kind="primary" icon="sparkle" onClick={start} disabled={starting}>{starting ? '启动中…' : '启动流水线'}</Button>
            </div>
            <div className="hint">未配置 LLM 时自动使用本地规则引擎产出（引擎标识为 rule/fallback），配置后自动切换真实模型。</div>
          </div>
        </Panel>

        <Panel
          noBody
          title={'流水线' + (run ? ' · ' + run.status : '')}
          sub={run ? '当前阶段：' + (STAGE_META[run.stage]?.label ?? run.stage) : '还没有运行记录'}
          right={
            <div className="row" style={{ gap: 8 }}>
              {runs && runs.length > 1 && (
                <select className="select" value={runId ?? ''} onChange={(e) => setRunId(Number(e.target.value))}>
                  {runs.map((r) => <option key={r.id} value={r.id}>#{r.id} · {r.goal.slice(0, 16)} · {relative(r.created_at)}</option>)}
                </select>
              )}
              <Button size="small" icon="play" onClick={step} disabled={busy === 'step' || !runId}>执行下一步</Button>
              <Button size="small" icon="check" onClick={() => confirm(true)} disabled={busy === 'confirm' || !run}>确认通过</Button>
              <Button size="small" icon="x" onClick={() => confirm(false)} disabled={busy === 'confirm' || !run}>打回重跑</Button>
              <Button size="small" kind="primary" icon="download" onClick={apply} disabled={busy === 'apply' || !run || (run.stage !== 'done' && run.status !== 'ready')}>落入项目</Button>
            </div>
          }
        >
          {!run ? (
            <EmptyState title="还没有智能体运行" desc="左侧填一段创意，点「启动流水线」，六阶段会自动跑完并给出摘要。" />
          ) : (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="row" style={{ gap: 10 }}>
                <Pill tone="gold">{doneCount}/{stages.length} 阶段完成</Pill>
                <Pill tone={run.status === 'failed' ? 'down' : run.status === 'ready' || run.status === 'applied' ? 'up' : 'warn'} dot>{run.status}</Pill>
                <Pill>目标 {run.target_sec}s</Pill>
                <Pill>{m?.styles.find((s) => s.id === run.visual_style)?.label ?? run.visual_style}</Pill>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stages.map((s, idx) => {
                  const metaStage = STAGE_META[s.stage] ?? { label: s.stage, agent: s.agent };
                  const payload = s.payload as { engine?: string } | undefined;
                  return (
                    <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: 11, display: 'grid', placeItems: 'center',
                          border: '1px solid ' + (s.status === 'done' ? 'rgba(70,175,130,.5)' : s.status === 'running' ? 'rgba(217,158,62,.5)' : s.status === 'failed' ? 'rgba(225,91,80,.5)' : 'var(--border)'),
                          background: s.status === 'done' ? 'rgba(70,175,130,.12)' : s.status === 'running' ? 'rgba(217,158,62,.12)' : '#11161d',
                          color: s.status === 'done' ? 'var(--up)' : s.status === 'running' ? 'var(--warn)' : s.status === 'failed' ? 'var(--down)' : 'var(--text-3)',
                          fontSize: 10
                        }}>
                          {s.status === 'done' ? <Icon name="check" size={12} /> : s.status === 'failed' ? <Icon name="x" size={12} /> : idx + 1}
                        </div>
                        {idx < stages.length - 1 && <div style={{ flex: 1, width: 1, background: 'var(--border)', marginTop: 4 }} />}
                      </div>
                      <div style={{ paddingBottom: 10 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <b style={{ color: 'var(--text-1)', fontSize: 12.5 }}>{metaStage.label}</b>
                          <span className="tag">{metaStage.agent}</span>
                          {payload?.engine && <span className="tag" style={{ color: String(payload.engine).startsWith('rule') ? 'var(--text-3)' : 'var(--gold-light)' }}>{engineLabel(String(payload.engine))}</span>}
                          <div className="spacer" />
                          <span className="mono hint">{s.status}</span>
                        </div>
                        <div style={{ color: s.status === 'pending' ? 'var(--text-3)' : 'var(--text-2)', fontSize: 12, marginTop: 3 }}>{s.summary ?? '等待执行'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {issues.length > 0 && (
                <div>
                  <div className="hint" style={{ marginBottom: 6 }}>质检 Agent 产出（阻断项不通过不进入渲染）</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {issues.slice(0, 8).map((i, idx) => (
                      <div key={idx} className={i.level === 'error' ? 'danger-block' : 'warn-block'} style={{ fontSize: 11.5 }}>
                        <b className="mono">{i.code}</b> · {i.message}{i.suggestion ? '（' + i.suggestion + '）' : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="hint" style={{ marginBottom: 6 }}>事件流（实时推送）</div>
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: '#0d1116' }}>
                  {events.slice(-40).map((e, i) => (
                    <div key={i} className="row" style={{ gap: 10, fontSize: 11.5, alignItems: 'baseline' }}>
                      <span style={{ color: 'var(--text-3)', width: 96, flex: '0 0 96px' }}>{eventLabel(String(e.type ?? ''))}</span>
                      <span style={{ color: 'var(--text-2)', flex: 1 }}>{String(e.message ?? e.stage ?? '')}</span>
                      {e.stage ? <span style={{ color: 'var(--text-3)', fontSize: 10.5 }}>{String(e.stage)}</span> : null}
                    </div>
                  ))}
                  {events.length === 0 && <div className="hint">等待事件…</div>}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="运行历史" sub="每次运行都保留阶段产物与事件，可从任意阶段中断恢复">
        {(runs ?? []).length === 0 ? <EmptyState title="暂无运行记录" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(runs ?? []).map((r) => (
              <div key={r.id} className="row" style={{ gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', background: r.id === runId ? 'var(--gold-soft)' : undefined }} onClick={() => setRunId(r.id)}>
                <span className="mono" style={{ color: 'var(--gold-light)' }}>#{r.id}</span>
                <span style={{ color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.goal}</span>
                <Pill tone={r.status === 'applied' ? 'up' : r.status === 'failed' ? 'down' : 'warn'} dot>{r.status}</Pill>
                <span className="hint">{r.stages.map((s) => s.stage + ':' + s.status).join(' ')}</span>
                <span className="hint">{relative(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
