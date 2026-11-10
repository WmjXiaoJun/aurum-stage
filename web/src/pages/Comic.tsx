import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';

const LAYOUTS = [
  { id: 'grid_4', label: '四宫格' },
  { id: 'grid_6', label: '六宫格' },
  { id: 'grid_9', label: '九宫格' }
];

export function ComicPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.comicPanels(projectId), [projectId]);
  const { data: shots } = useAsync(() => api.shots(projectId), [projectId]);
  const [layout, setLayout] = useState('grid_4');

  const add = async (shotId?: number) => {
    try {
      await api.createComicPanel({ project_id: projectId, layout, shot_id: shotId ?? null, panel_json: { title: '新面板' } });
      notify('已新增面板', 'success');
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  if (loading && !data) return <div className="panel"><Skeleton rows={3} height={140} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  const panels = data ?? [];

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">27.4 · 漫画 / 漫剧工作台</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>面板 · 宫格 · 条漫</h1>
          <div className="hint" style={{ marginTop: 4 }}>角色一次定义、跨格复用；对白气泡与花字走原生排版，画面不生成中文。</div>
        </div>
        <div className="spacer" />
        <div className="chips">
          {LAYOUTS.map((l) => <Chip key={l.id} on={layout === l.id} onClick={() => setLayout(l.id)}>{l.label}</Chip>)}
        </div>
        <Button kind="primary" icon="plus" onClick={() => add()}>新增面板</Button>
      </div>

      {panels.length === 0 ? (
        <Panel><EmptyState title="还没有漫画面板" desc="新增一个面板，把镜头按宫格组织成纵向条漫。" action={<Button kind="primary" icon="plus" onClick={() => add()}>新增面板</Button>} /></Panel>
      ) : (
        <div className="split" style={{ gridTemplateColumns: '1fr 380px' }}>
          <Panel title="面板列表" sub={panels.length + ' 个面板 · 顺序即 webtoon 阅读顺序'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {panels.map((p, idx) => {
                const json = (p.panel_json ?? {}) as { panels?: Array<{ x: number; y: number; w: number; h: number }> };
                const cells = json.panels ?? [];
                return (
                  <div key={String(p.id)} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                    <div className="row" style={{ marginBottom: 8 }}>
                      <span className="mono" style={{ color: 'var(--gold-light)' }}>#{idx + 1}</span>
                      <Pill>{String(p.layout) === 'grid_9' ? '九宫格' : String(p.layout) === 'grid_6' ? '六宫格' : '四宫格'}</Pill>
                      <span className="hint">{p.shot_id ? '第 ' + String(p.shot_id) + ' 镜' : '通用面板'}</span>
                      <div className="spacer" />
                      <Button size="small" kind="danger" icon="trash" onClick={async () => { await api.deleteComicPanel(Number(p.id)); notify('已删除面板', 'success'); reload(); }}>删除</Button>
                    </div>
                    <div style={{ position: 'relative', paddingBottom: '56%', background: '#0d1116', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      {cells.map((c, i) => (
                        <div key={i} style={{ position: 'absolute', left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%', border: '1px solid rgba(212,184,126,.35)', display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 10 }} className="mono">
                          {i + 1}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="条漫预览" sub="纵向长条滚动 · 动态漫可按每格首尾帧驱动图生视频">
            <div style={{ maxHeight: 620, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6 }}>
              {panels.map((p, idx) => (
                <div key={String(p.id)} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                  <img src={'/scenes/' + (idx % 2 === 0 ? 'scene-skit.jpg' : 'scene-interview.jpg')} alt={'panel ' + idx} style={{ width: '100%', display: 'block', opacity: 0.85 }} />
                  <div style={{ position: 'absolute', left: 8, top: 8 }} className="tag">#{idx + 1}</div>
                </div>
              ))}
              {panels.length === 0 && <div className="hint">暂无面板</div>}
            </div>
          </Panel>
        </div>
      )}

      {shots && shots.length > 0 && (
        <Panel title="把镜头转成面板" sub="选择一个镜头建立漫画面板（首尾帧可驱动动态漫）">
          <div className="chips">
            {shots.slice(0, 12).map((s) => (
              <Chip key={s.id} onClick={() => add(s.id)} icon="plus">{s.shot_code}</Chip>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
