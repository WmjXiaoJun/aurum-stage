import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync, useEvents, useMeta } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, EngineTag, Meter, Panel, Pill, Ring, Skeleton, StatusPill, Modal, Field , Toggle } from '../components/ui';
import { Icon } from '../components/Icon';
import { ShotModal } from '../components/ShotModal';
import { navigate } from '../lib/router';
import { percent, seconds, shortText, timecode } from '../lib/format';
import { shotLabel, errorLabel } from '../lib/zh';
import type { Asset, Compliance, Overview, Project, Shot } from '../lib/types';

const SCENE: Record<string, string> = {
  talk_show: '/scenes/scene-interview.jpg',
  standup: '/scenes/scene-standup.jpg',
  challenge: '/scenes/scene-game.jpg',
  skit: '/scenes/scene-skit.jpg'
};

export function OverviewPage({ projectId, project, onProjectChange }: {
  projectId: number;
  project: Project | null;
  onProjectChange: (p: Project) => void;
}): React.ReactElement {
  const { notify, meta } = useApp();
  const m = useMeta();
  const { data, loading, error, reload } = useAsync<Overview>(() => api.overview(projectId, episodeParam || undefined), [projectId]);
  const { data: assets } = useAsync<Asset[]>(() => api.assets(projectId), [projectId]);
  const [filterEngine, setFilterEngine] = useState<'all' | 'muse_api' | 'comfy_h3'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'empty' | 'generated' | 'locked'>('all');
  const episodeParam = Number(new URLSearchParams(window.location.search).get('ep') ?? 0);
  const [search, setSearch] = useState('');
  const [activeShot, setActiveShot] = useState<number | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!data || selectedSegment != null) return;
    const primary = [...data.compliance].sort((a, b) => b.duration_ms - a.duration_ms)[0];
    if (primary) setSelectedSegment(primary.segment_id);
  }, [data, selectedSegment]);

  useEvents(projectId, (event) => {
    if (['task.success', 'task.failed', 'task.preview', 'compose.success'].includes(event.type)) {
      window.setTimeout(() => { reload(); }, 240);
    }
  });

  const posterMap = useMemo(() => {
    const byId = new Map<number, Asset>();
    for (const a of assets ?? []) byId.set(a.id, a);
    const resolvePoster = (asset: Asset, depth = 0): number | undefined => {
      const meta = asset.meta as { poster_asset_id?: number; source_asset_id?: number };
      if (meta?.poster_asset_id) return meta.poster_asset_id;
      if (meta?.source_asset_id && depth < 2) {
        const src = byId.get(meta.source_asset_id);
        if (src) return resolvePoster(src, depth + 1);
      }
      return undefined;
    };
    const map = new Map<number, number>();
    for (const a of assets ?? []) {
      if (a.asset_type !== 'video') continue;
      const poster = resolvePoster(a);
      if (poster) map.set(a.id, poster);
    }
    return map;
  }, [assets]);

  const shots = data?.shots ?? [];
  const filtered = shots.filter((s) => {
    if (filterEngine !== 'all' && s.render_engine !== filterEngine) return false;
    if (filterStatus === 'empty' && s.status !== 'empty') return false;
    if (filterStatus === 'generated' && !['generated', 'reviewed', 'locked'].includes(s.status)) return false;
    if (filterStatus === 'locked' && !s.locked) return false;
    if (search && !(s.shot_code + (s.text_clean ?? '') + (s.speaker_name ?? '')).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalMs = data?.stats.duration_ms ?? 0;
  const capSec = data?.project.segment_cap_sec ?? 300;
  const currentSegment = data?.compliance.find((c) => c.segment_id === selectedSegment) ?? data?.compliance[0] ?? null;
  const overCap = Boolean(currentSegment?.exceed);
  const nearCap = Boolean(currentSegment?.near_cap);
  const taskTotal = useMemo(() => {
    const t = (data?.stats.tasks ?? {}) as { total?: Record<string, number> };
    return Object.values(t.total ?? {}).reduce((n, v) => n + Number(v), 0);
  }, [data]);
  const taskSuccess = useMemo(() => {
    const t = (data?.stats.tasks ?? {}) as { total?: Record<string, number> };
    return (t.total?.success ?? 0);
  }, [data]);
  const cloudCount = shots.filter((s) => s.render_engine === 'muse_api').length;

  const batchRender = async () => {
    setBusy('batch');
    try {
      const res = await api.renderAll(projectId, { segment_id: selectedSegment ?? undefined, force: true });
      notify('已提交 ' + res.submitted + ' 个镜头的渲染任务', 'success');
      reload();
    } catch (err) {
      const e = err as ApiError;
      const d = e.details as { exceed_sec?: number; split_hint?: string } | null;
      notify(e.code === 'SEGMENT_DURATION_EXCEED' ? '本段超限 ' + (d?.exceed_sec ?? '') + ' 秒，已阻断提交：' + (d?.split_hint ?? '') : e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const addShot = async () => {
    if (!selectedSegment) { notify('先选择一个环节', 'error'); return; }
    try {
      const shot = await api.createShot(selectedSegment, {
        lines: ['（新增镜头）在这里写台词，支持（笑）（停顿半秒）。'],
        camera: 'medium_shot',
        render_engine: 'comfy_h3'
      });
      notify('已新增镜头 ' + shot.shot_code, 'success');
      reload();
      setActiveShot(shot.id);
    } catch (err) {
      notify((err as ApiError).message, 'error');
    }
  };

  if (loading && !data) return <div className="panel"><Skeleton rows={5} height={56} /></div>;
  if (error && !data) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;
  if (!data) return <></>;

  const styleLabel = m?.styles.find((s) => s.id === data.project.visual_style)?.label ?? data.project.visual_style;

  return (
    <>
      {(((data as unknown as { episodes?: Array<{ id: number; seq: number; title: string }> })?.episodes) ?? []).length > 0 && (
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <span className="hint">分期</span>
          <Chip on={!episodeParam} onClick={() => navigate('/project/' + projectId + '/overview')}>全部</Chip>
          {(((data as unknown as { episodes?: Array<{ id: number; seq: number; title: string }> })?.episodes) ?? []).map((ep) => (
            <Chip key={ep.id} on={episodeParam === ep.id} onClick={() => navigate('/project/' + projectId + '/overview?ep=' + ep.id)}>
              {ep.title}
            </Chip>
          ))}
        </div>
      )}

      {/* 英雄区：超大时间码 + 容量环 + 300 秒红线 */}
      <section className="hero">
        <div className="hero-main">
          <div className="hero-eyebrow">
            <Icon name="film" size={13} /> 微综艺总览 · {styleLabel} · {data.segments.length} 个环节
          </div>
          <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
            <div>
              <div className="hero-timecode">
                {timecode(totalMs)}
                <span className="unit">/ 成片时长</span>
              </div>
            </div>
            <div className="spacer" />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Pill tone="gold">{data.project.privacy_mode ? '隐私模式' : '双引擎'}</Pill>
              <Pill tone="jade">{data.shots.length} 镜头</Pill>
              {data.stats.exceed > 0 && <Pill tone="down">{data.stats.exceed} 段超限</Pill>}
            </div>
          </div>

          <div className="hero-rule">
            <div className="hero-rail">
              <div
                className={'hero-rail-fill ' + (overCap ? 'over' : '')}
                style={{ width: percent(currentSegment?.duration_ms ?? 0, capSec * 1000) + '%' }}
              />
              <div className="hero-rail-mark" style={{ left: 'calc(' + percent(280_000, capSec * 1000) + '% )' }} />
            </div>
            <div className="hero-rule-text">
              硬规则：单段 ≤ {timecode(capSec * 1000)}（{capSec} 秒）· 当前段 {seconds(currentSegment?.duration_ms ?? 0, 0)}s
              {overCap ? ' · 超限 ' + currentSegment?.exceed_sec + 's' : ' · 剩余 ' + Math.max(0, currentSegment?.remaining_sec ?? 0) + 's'}
            </div>
          </div>

          <div className="hero-meta">
            <span>当前环节 <b>{currentSegment?.title ?? '—'}</b></span>
            <span>镜头 <b>{currentSegment?.shots ?? 0}</b></span>
            <span>已生成 <b>{data.stats.generated}</b> / {data.stats.shots}</span>
            <span>锁定 <b>{data.stats.locked}</b></span>
            <span>合成引擎 <b style={{ color: data.runtime.ffmpeg ? 'var(--up)' : 'var(--down)' }}>{data.runtime.ffmpeg ? '正常' : '缺失'}</b></span>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <Button kind="primary" icon="play" onClick={batchRender} disabled={busy === 'batch' || overCap} title={overCap ? '本段已超 300 秒' : undefined}>
              {busy === 'batch' ? '提交中…' : '批量渲染本段'}
            </Button>
            <Button icon="plus" onClick={addShot}>新增镜头</Button>
            <Button icon="script" onClick={() => navigate('/project/' + projectId + '/agent')}>智能体生成台本</Button>
            <div className="spacer" />
            <Button kind="ghost" icon="export" onClick={() => navigate('/project/' + projectId + '/export')}>合成导出</Button>
          </div>
        </div>

        <div className="hero-ring">
          <Ring
            used={currentSegment?.duration_ms ?? 0}
            cap={capSec * 1000}
            near={nearCap}
            exceed={overCap}
            label={'段容量 ' + (currentSegment?.title ?? '')}
            center={
              <>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, lineHeight: 1, color: overCap ? 'var(--down)' : nearCap ? 'var(--warn)' : 'var(--gold-light)' }}>
                  {seconds(currentSegment?.duration_ms ?? 0, 0)}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', marginLeft: 3 }}>/{capSec}s</span>
                </div>
                <div style={{ fontSize: 11, color: overCap ? 'var(--down)' : nearCap ? 'var(--warn)' : 'var(--up)' }}>
                  {overCap ? '超限 ' + currentSegment?.exceed_sec + 's' : nearCap ? '接近上限' : '合规'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>段容量（TTS 反推）</div>
              </>
            }
          />
        </div>

        <div className="hero-scene">
          <img src={SCENE[data.project.variety_type] ?? SCENE.talk_show} alt="场景参考" />
        </div>
      </section>

      {/* 画幅与出海 */}
      <Panel title="画幅与出海" sub="画幅决定镜头渲染与成片尺寸；语言决定配音音色与字幕（翻译后需重新渲染/合成）">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
            <span className="hint" style={{ width: 56 }}>画幅</span>
            {[
              { id: '16:9', label: '16:9 横屏' },
              { id: '9:16', label: '9:16 竖屏' },
              { id: '1:1', label: '1:1 方形' },
              { id: '4:5', label: '4:5 社媒' }
            ].map((a) => (
              <Button
                key={a.id}
                size="small"
                kind={data.project.aspect_ratio === a.id ? 'primary' : undefined}
                onClick={async () => {
                  try {
                    await api.patchProject(projectId, { aspect_ratio: a.id });
                    notify('画幅已切换为 ' + a.label + '，重新渲染/合成就按新画幅出片', 'success');
                    reload();
                  } catch (err) { notify(String((err as Error).message), 'error'); }
                }}
              >{a.label}</Button>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
            <span className="hint" style={{ width: 56 }}>语言</span>
            {[
              { id: 'zh', label: '中文' },
              { id: 'en', label: '英语' },
              { id: 'es', label: '西班牙语' },
              { id: 'ja', label: '日语' },
              { id: 'ko', label: '韩语' },
              { id: 'pt', label: '葡萄牙语' }
            ].map((l) => (
              <Chip key={l.id} on={(data.project as unknown as { language?: string }).language === l.id} onClick={async () => {
                if (l.id === 'zh') {
                  try { await api.restoreProjectLanguage(projectId); notify('已恢复中文', 'success'); reload(); }
                  catch (err) { notify(String((err as Error).message), 'error'); }
                  return;
                }
                notify('正在翻译台词为' + l.label + '…', 'info');
                try {
                  const r = await api.localizeProject(projectId, l.id);
                  notify('已本地化 ' + r.translated + '/' + r.total + ' 句，重新渲染后配音与字幕即为' + l.label, 'success');
                  reload();
                } catch (err) { notify(String((err as Error).message), 'error'); }
              }}>{l.label}</Chip>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
            <span className="hint" style={{ width: 56 }}>成片</span>
            <Toggle on={Boolean((data.project as unknown as { auto_compose?: number }).auto_compose)} onChange={async (v) => {
              try { await api.patchProject(projectId, { auto_compose: v }); notify(v ? '已开启自动成片：渲染队列排空后自动合成' : '已关闭自动成片', 'success'); reload(); }
              catch (err) { notify(String((err as Error).message), 'error'); }
            }} />
            <span className="hint">自动成片（队列排空后自动合成并登记导出，不再需要手动点合成）</span>
          </div>
          <div className="hint">出海流程：选语言 → 台词翻译落库 → 重新渲染（配音换目标语言音色）→ 重新合成（字幕换目标语言）。原中文台词保留，可随时切回。</div>
        </div>
      </Panel>

      {/* KPI */}
      <div className="kpi-grid">
        <div className="kpi accent">
          <div className="kpi-label"><Icon name="film" size={13} /> 镜头总数</div>
          <div className="kpi-value">{data.stats.shots}<small>个</small></div>
          <div className="kpi-foot">环节 {data.stats.segments} · 云端 {cloudCount} / 本地 {data.stats.shots - cloudCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label"><Icon name="check" size={13} /> 已生成</div>
          <div className="kpi-value">{data.stats.generated}<small>个</small></div>
          <div className="kpi-foot">完成率 {data.stats.shots ? Math.round((data.stats.generated / data.stats.shots) * 100) : 0}%</div>
        </div>
        <div className="kpi">
          <div className="kpi-label"><Icon name="clock" size={13} /> 段时长合规</div>
          <div className="kpi-value" style={{ color: data.stats.exceed ? 'var(--down)' : 'var(--up)' }}>
            {data.compliance.filter((c) => c.status === 'ok').length}<small>/{data.compliance.length}</small>
          </div>
          <div className="kpi-foot">{data.stats.exceed ? data.stats.exceed + ' 段超限' : data.stats.near_cap ? data.stats.near_cap + ' 段接近上限' : '全部合规'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label"><Icon name="task" size={13} /> 任务成功率</div>
          <div className="kpi-value">{taskTotal ? Math.round((taskSuccess / taskTotal) * 100) : 0}<small>%</small></div>
          <div className="kpi-foot">共 {taskTotal} 个任务 · 失败 {((data.stats.tasks as { total?: Record<string, number> }).total?.failed ?? 0)} 个</div>
        </div>
      </div>

      {/* 筛选 */}
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="chips">
          <Chip on={filterEngine === 'all'} onClick={() => setFilterEngine('all')}>全部引擎</Chip>
          <Chip on={filterEngine === 'muse_api'} tone="gold" icon="cloud" onClick={() => setFilterEngine('muse_api')}>云端生成</Chip>
          <Chip on={filterEngine === 'comfy_h3'} tone="jade" icon="monitor" onClick={() => setFilterEngine('comfy_h3')}>本地生成</Chip>
        </div>
        <div className="chips">
          <Chip on={filterStatus === 'all'} onClick={() => setFilterStatus('all')}>全部状态</Chip>
          <Chip on={filterStatus === 'empty'} onClick={() => setFilterStatus('empty')}>待生成</Chip>
          <Chip on={filterStatus === 'generated'} onClick={() => setFilterStatus('generated')}>已生成</Chip>
          <Chip on={filterStatus === 'locked'} onClick={() => setFilterStatus('locked')}>已锁定</Chip>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 6 }}>
          <Icon name="search" size={14} />
          <input className="input" style={{ width: 230 }} placeholder="搜索编号 / 台词 / 角色" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button size="small" icon="refresh" onClick={reload}>刷新</Button>
        </div>
      </div>

      {/* 镜头表 */}
      <Panel
        noBody
        title={'镜头表 · ' + filtered.length + ' / ' + shots.length}
        sub="点击任意行打开镜头详情（提示词 / 情绪 / 引擎 / 候选 / 口型）"
        right={
          <div className="row" style={{ gap: 8 }}>
            <Button size="small" icon="plus" onClick={addShot}>新增</Button>
            <Button size="small" icon="play" onClick={batchRender} disabled={overCap}>批量渲染</Button>
          </div>
        }
      >
        {shots.length === 0 ? (
          <EmptyState
            title="当前项目还没有镜头"
            desc="先在「智能体」用一句话创意生成台本，或在「台本编辑」粘贴 Markdown 台本并解析。"
            action={<Button kind="primary" icon="agent" onClick={() => navigate('/project/' + projectId + '/agent')}>去生成台本</Button>}
          />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 96 }}>编号</th>
                  <th style={{ width: 92 }}>缩略图</th>
                  <th style={{ width: 64 }}>机位</th>
                  <th style={{ width: 132 }}>引擎</th>
                  <th>台词</th>
                  <th style={{ width: 86 }}>时长</th>
                  <th style={{ width: 108 }}>状态</th>
                  <th style={{ width: 120 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className={s.error_code ? 'failed' : ''} onClick={() => setActiveShot(s.id)} style={{ cursor: 'pointer' }}>
                    <td><span style={{ color: 'var(--gold-light)', fontSize: 12 }}>{shotLabel(s.segment_seq, s.seq)}</span></td>
                    <td>
                      <div className="thumb">
                        {(() => {
                          const rendered = Boolean(s.preview_asset_id);
                          return (
                            <>
                              <img
                                src={SCENE[data.project.variety_type] ?? SCENE.talk_show}
                                alt=""
                                style={{ opacity: rendered ? 0.62 : 0.3, filter: rendered ? 'none' : 'grayscale(0.6)' }}
                              />
                              <div className="ph">{s.segment_seq ? '第' + s.segment_seq + '段' : '—'}</div>
                              <span
                                className="thumb-dot"
                                style={{ background: s.render_engine === 'muse_api' ? 'var(--gold)' : 'var(--jade)' }}
                                title={rendered ? '已有产物' : '待生成'}
                              />
                            </>
                          );
                        })()}
                      </div>
                    </td>
                    <td><span className="cam">{m?.constants.cameras.find((c) => c.id === s.camera)?.label ?? s.camera}</span></td>
                    <td><EngineTag engine={s.render_engine} /></td>
                    <td className="line-cell">
                      <div className="line-text">{shortText(s.text_clean || s.lines.join(' ') || s.visual_prompt || '（空镜）', 46)}</div>
                      <div className="line-tags">
                        {s.speaker_name && <span className="tag">{s.speaker_name}</span>}
                        {s.emotion && <span className="tag">{m?.emotions.find((e) => e.id === s.emotion)?.label ?? s.emotion}</span>}
                        {s.lipsync_required && <span className="tag">口型对齐</span>}
                        {s.privacy && <span className="tag" style={{ color: 'var(--jade)' }}>涉敏</span>}
                      </div>
                    </td>
                    <td><span className="mono">{timecode(s.duration_ms, true)}</span></td>
                    <td><StatusPill status={s.status} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ gap: 4 }}>
                        <Button size="small" onClick={() => setActiveShot(s.id)}>详情</Button>
                        <Button size="small" kind={s.locked ? 'ghost' : 'default'} icon={s.locked ? 'lock' : 'check'} onClick={async () => { await api.lockShot(s.id, !s.locked); notify(s.locked ? '已解锁' : '已锁定', 'success'); reload(); }} />
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8}><EmptyState title="当前筛选下还没有镜头" desc="换一个筛选条件，或新增镜头。" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* 段时长合规面板（300 秒硬约束） */}
      <Panel
        noBody
        title="段时长合规检查"
        sub="时长以 TTS 真实产物反推，非人工估算 · 红色虚线为 300 秒硬红线"
        right={<Pill tone="warn">硬规则：单段 ≤ 05:00（300 秒）</Pill>}
      >
        {data.compliance.map((c) => {
          const pct = percent(c.duration_ms, capSec * 1000);
          return (
            <div key={c.segment_id} className="cap-row" onClick={() => setSelectedSegment(c.segment_id)} style={{ cursor: 'pointer', background: c.segment_id === currentSegment?.segment_id ? 'rgba(212,184,126,.05)' : undefined }}>
              <div className="cap-name">{c.title}<small>{m?.constants.segment_types.find((s) => s.id === data.segments.find((x) => x.id === c.segment_id)?.segment_type)?.label ?? ''} · {c.shots} 镜头</small></div>
              <div className="cap-rail">
                <div className={'cap-fill ' + (c.exceed ? 'over' : '')} style={{ width: Math.min(100, pct) + '%' }} />
                <div className="cap-mark" style={{ left: 'calc(' + percent(280_000, capSec * 1000) + '%)' }} />
              </div>
              <div className="cap-read">
                <span>{c.duration_sec}s</span>
                {c.exceed ? <Pill tone="down">超限 {c.exceed_sec}s</Pill> : c.near_cap ? <Pill tone="warn">接近上限</Pill> : <Pill tone="up">合规</Pill>}
              </div>
            </div>
          );
        })}
        {data.compliance.length === 0 && <EmptyState title="还没有环节" desc="解析台本后会自动生成环节与镜头。" />}
      </Panel>

      {data.issues.length > 0 && (
        <Panel title={'质检提醒 · ' + data.issues.length} sub="由质检 Agent 产出，点击进入质检中心">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.issues.slice(0, 5).map((i) => (
              <div key={i.id} className={i.level === 'error' ? 'danger-block' : 'warn-block'} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--gold-light)' }}>{errorLabel(i.code)}</span>
                <span style={{ flex: 1 }}>{i.message}</span>
                <Button size="small" kind="ghost" onClick={() => navigate('/project/' + projectId + '/qa')}>处理</Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <ShotModal
        shotId={activeShot}
        open={activeShot != null}
        compliance={data.compliance.find((c) => c.segment_id === (shots.find((s) => s.id === activeShot)?.segment_id)) ?? null}
        onClose={() => setActiveShot(null)}
        onChanged={() => { reload(); }}
      />
    </>
  );
}

