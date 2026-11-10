import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync, useMeta } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Field, Modal, Panel, Pill, Skeleton, Toggle } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../lib/router';
import { relative, seconds, shortText } from '../lib/format';
import type { Project } from '../lib/types';

const VARIETY_LABEL: Record<string, string> = { talk_show: '访谈', standup: '脱口秀', challenge: '闯关', skit: '情景小剧场' };

export function ProjectsPage(): React.ReactElement {
  const { notify, meta } = useApp();
  const { data, loading, error, reload } = useAsync<Project[]>(() => api.listProjects(), []);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', variety_type: 'talk_show', visual_style: 'photoreal', aspect_ratio: '16:9', privacy_mode: false });
  const [covers, setCovers] = useState<Record<number, string>>({});
  const { data: board, reload: reloadBoard } = useAsync(() => api.board(), []);
  useEffect(() => { const t = window.setInterval(() => reloadBoard(), 8000); return () => window.clearInterval(t); }, []);
  const [creating, setCreating] = useState(false);
  const styles = meta?.styles ?? [];

  useEffect(() => {
    if (!data?.length) return;
    let alive = true;
    (async () => {
      const next: Record<number, string> = {};
      await Promise.all(data.map(async (p) => {
        try {
          const r = await api.projectCovers(p.id);
          if (r.covers[0]) next[p.id] = r.covers[0];
        } catch { /* ignore */ }
      }));
      if (alive) setCovers(next);
    })();
    return () => { alive = false; };
  }, [data]);

  const create = async () => {
    if (!draft.name.trim()) { notify('请填写项目名称', 'error'); return; }
    setCreating(true);
    try {
      const project = await api.createProject(draft);
      notify('项目已创建', 'success');
      setOpen(false);
      navigate('/project/' + project.id + '/overview');
    } catch (err) {
      const e = err as ApiError;
      notify(e.code + ' · ' + e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">STUDIO · 项目库</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 26, color: 'var(--text-1)', fontWeight: 600, letterSpacing: 0.5 }}>微综艺生产项目</h1>
          <div className="hint" style={{ marginTop: 4 }}>单段成片硬上限 300 秒 · 引擎双通道：云端 Muse / 本地 ComfyUI·H3</div>
        </div>
        <div className="spacer" />
        <Button kind="primary" icon="plus" onClick={() => setOpen(true)}>新建项目</Button>
      </div>

      {loading && <div className="panel"><Skeleton rows={4} height={92} /></div>}
      {error && <div className="panel"><ErrorState message={error} onRetry={reload} /></div>}

      {data && data.length === 0 && (
        <div className="panel">
          <EmptyState
            title="还没有任何项目"
            desc="先建一个项目，粘贴一段创意或台本，智能体会把它拆成环节 / 轮次 / 镜头。"
            action={<Button kind="primary" icon="plus" onClick={() => setOpen(true)}>新建项目</Button>}
          />
        </div>
      )}

      <Panel title="批次看板 · 自动成片" sub="开启自动成片的项目：渲染进度、队列、导出数量；每 8 秒刷新">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>项目</th><th style={{ width: 150 }}>渲染进度</th><th style={{ width: 90 }}>队列</th><th style={{ width: 80 }}>失败</th><th style={{ width: 80 }}>导出</th><th style={{ width: 110 }}>成片</th></tr></thead>
            <tbody>
              {(board ?? []).filter((b) => Number(b.auto_compose) === 1).map((b) => {
                const total = Number(b.total_shots ?? 0);
                const done = Number(b.generated ?? 0);
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <tr key={String(b.id)} style={{ cursor: 'pointer' }} onClick={() => navigate('/project/' + b.id + '/overview')}>
                    <td>{String(b.name)}</td>
                    <td>
                      <div style={{ height: 6, background: 'var(--bg-panel-2)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg, var(--gold), var(--gold-light))' }} />
                      </div>
                      <span className="hint">{done}/{total}</span>
                    </td>
                    <td>{Number(b.pending) > 0 ? <Pill tone="warn">进行中 {String(b.pending)}</Pill> : <Pill tone="up">空闲</Pill>}</td>
                    <td>{Number(b.failed) > 0 ? <Pill tone="down">{String(b.failed)}</Pill> : <span className="hint">—</span>}</td>
                    <td>{String(b.exports)}</td>
                    <td>{Number(b.exports) > 0 ? <Pill tone="up">已出片</Pill> : <span className="hint">待合成</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {(data ?? []).map((p) => {
          const style = styles.find((s) => s.id === p.visual_style);
          const usage = p.duration_ms ?? 0;
          return (
            <div key={p.id} className="panel" style={{ cursor: 'pointer', overflow: 'hidden' }} onClick={() => navigate('/project/' + p.id + '/overview')}>
              <div style={{ height: 168, position: 'relative', background: 'linear-gradient(120deg, #141a23, #0d1116)', overflow: 'hidden' }}>
                {covers[p.id] && (
                  <>
                    <img src={covers[p.id]} alt="" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(18px) saturate(1.15)', opacity: 0.55, transform: 'scale(1.15)' }} />
                    <img src={covers[p.id]} alt={p.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  </>
                )}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,12,15,.15) 0%, rgba(10,12,15,.55) 55%, rgba(10,12,15,.92) 100%)' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(420px 180px at 85% -20%, rgba(212,184,126,.28), transparent 70%)' }} />
                <div style={{ position: 'absolute', left: 16, top: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Pill tone="gold">{VARIETY_LABEL[p.variety_type] ?? p.variety_type}</Pill>
                  <Pill>{style?.label ?? p.visual_style}</Pill>
                  {p.privacy_mode && <Pill tone="jade">隐私模式</Pill>}
                </div>
                <div style={{ position: 'absolute', left: 16, bottom: 12, right: 16 }}>
                  <div style={{ color: '#fff', fontSize: 21, fontWeight: 700, letterSpacing: 0.3, textShadow: '0 2px 16px rgba(0,0,0,.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div className="hint" style={{ marginTop: 2 }}>{p.aspect_ratio === '9:16' ? '竖屏 9:16' : p.aspect_ratio === '16:9' ? '横屏 16:9' : p.aspect_ratio === '1:1' ? '方形 1:1' : '社媒 4:5'} · {p.shot_count ?? 0} 镜</div>
                </div>
              </div>
              <div style={{ padding: '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="row" style={{ gap: 14, fontSize: 11.5, color: 'var(--text-3)' }}>
                  <span><b className="mono" style={{ color: 'var(--text-1)' }}>{p.shot_count ?? 0}</b> 镜头</span>
                  <span><b className="mono" style={{ color: 'var(--text-1)' }}>{p.segment_count ?? 0}</b> 环节</span>
                  <span><b className="mono" style={{ color: 'var(--text-1)' }}>{seconds(usage, 0)}</b> 秒</span>
                  <div className="spacer" />
                  <span>{relative(p.updated_at)}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Pill tone={p.status === 'composed' ? 'up' : p.status === 'producing' ? 'warn' : null} dot>
                    {p.status === 'composed' ? '已出片' : p.status === 'producing' ? '生产中' : p.status === 'parsing' ? '解析中' : '草稿'}
                  </Pill>
                  <div className="spacer" />
                  <span className="hint">{(p.aspect_ratio === '9:16' ? '竖屏' : p.aspect_ratio === '16:9' ? '横屏' : p.aspect_ratio === '1:1' ? '方形' : '社媒竖版') + ' · ' + p.fps + ' 帧'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={open}
        title="新建微综艺项目"
        onClose={() => setOpen(false)}
        footer={<><Button kind="ghost" onClick={() => setOpen(false)}>取消</Button><Button kind="primary" onClick={create} disabled={creating}>{creating ? '创建中…' : '创建并进入'}</Button></>}
      >
        <Field label="项目名称">
          <input className="input" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：AI 圆桌派 第 1 期" />
        </Field>
        <div className="grid-2">
          <Field label="综艺类型">
            <select className="select" value={draft.variety_type} onChange={(e) => setDraft({ ...draft, variety_type: e.target.value })}>
              {(meta?.constants.variety_types ?? []).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="画幅">
            <select className="select" value={draft.aspect_ratio} onChange={(e) => setDraft({ ...draft, aspect_ratio: e.target.value })}>
              <option value="16:9">16:9 横屏（默认）</option>
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="1:1">1:1 方形</option>
              <option value="4:5">4:5 社交</option>
            </select>
          </Field>
        </div>
        <Field label="视觉风格（与渲染引擎正交）">
          <div className="chips">
            {styles.map((s) => (
              <Chip key={s.id} on={draft.visual_style === s.id} onClick={() => setDraft({ ...draft, visual_style: s.id })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="row">
          <Toggle on={draft.privacy_mode} onChange={(v) => setDraft({ ...draft, privacy_mode: v })} label="隐私模式（全链路禁用云端引擎）" />
        </div>
        <div className="hint">创建后可在「智能体」页用一句话创意自动生成台本，或直接在「台本编辑」粘贴 Markdown。</div>
      </Modal>
    </>
  );
}
