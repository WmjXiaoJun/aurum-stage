import React, { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp, useAsync } from '../lib/store';
import { Button, Chip, Field, Panel, Pill, Skeleton, ErrorState } from '../components/ui';
import { navigate } from '../lib/router';
import { seconds } from '../lib/format';

interface EngLine { line_id: string; text: string; duration_sec: number; speaker_name?: string; word_anchors: Array<{ word: string; start_sec: number; end_sec: number }>; }
interface EngRound { round_id: string; lines: EngLine[] }
interface EngSegment { segment_id: string; title: string; duration_sec: number; rounds: EngRound[] }
interface EngBody {
  meta: { title: string; version: number; status: string; total_duration_sec: number; segment_count: number; shot_count: number; aspect_ratio: string; visual_style: string; language: string };
  script: { segments: EngSegment[] };
  shots: { shots: Array<{ shot_id: string; scale: string; prompt: string; duration_sec: number; render_engine: string; visual_style: string; lipsync_required: boolean }> };
  tracks: { tracks: Array<{ track_id: string; track_kind: string; text_content: string | null; bind: { line_id: string | null; word_start: number; word_end: number } }> };
  assets: { assets: Array<{ asset_id: string; asset_kind: string; uri: string }> };
  slots: { slots: Array<{ slot_key: string; slot_type: string; current_value: unknown; constraint: Record<string, unknown> }> };
}

const LANG = [['zh', '中文'], ['en', '英语'], ['es', '西班牙语'], ['ja', '日语'], ['ko', '韩语'], ['pt', '葡萄牙语']];
const STYLE = [['realistic', '写实'], ['2d', '二维'], ['3d', '三维'], ['comic', '漫画']];

export function EngineeringPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.engineering(projectId), [projectId]);
  const [tab, setTab] = useState<'script' | 'shots' | 'tracks' | 'json'>('script');
  const [lang, setLang] = useState<string>('');
  const [style, setStyle] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState<Array<{ language: string; visual_style: string }>>([{ language: 'en', visual_style: '2d' }, { language: 'ja', visual_style: '3d' }]);
  const [created, setCreated] = useState<number[]>([]);

  const body = (data?.body ?? null) as EngBody | null;
  const stats = useMemo(() => {
    if (!body) return null;
    const anchors = body.script.segments.reduce((n, s) => n + s.rounds.reduce((m, r) => m + r.lines.reduce((k, l) => k + (l.word_anchors?.length ?? 0), 0), 0), 0);
    return { anchors, tracks: body.tracks.tracks.length, assets: body.assets.assets.length };
  }, [body]);

  if (loading && !data) return <div className="panel"><Skeleton rows={5} height={80} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;
  if (!body) return <div className="panel">工程文件尚未生成</div>;

  const slotValue = (key: string) => body.slots.slots.find((s) => s.slot_key === key)?.current_value;

  const rebuild = async () => {
    setBusy(true);
    try { await api.rebuildEngineering(projectId); notify('工程文件已重建并生成新版本', 'success'); reload(); }
    catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setBusy(false); }
  };

  const clone = async () => {
    setBusy(true);
    try {
      const res = await api.cloneEngineering(projectId, { slots: { language: lang || String(slotValue('language') ?? 'zh'), visual_style: style || String(slotValue('visual_style') ?? 'realistic') } });
      notify('已基于工程复刻新项目', 'success');
      navigate('/project/' + res.project_id + '/overview');
    } catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setBusy(false); }
  };

  const batchClone = async () => {
    setBusy(true);
    try { const r = await api.batchCloneEngineering(projectId, { grid }); setCreated(r.created); notify('批量复刻完成：' + r.count + ' 个项目', 'success'); }
    catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setBusy(false); }
  };

  const abstract = async () => {
    setBusy(true);
    try { const r = await api.abstractEngineering(projectId); notify('已抽象为工程模板：' + r.template_key, 'success'); }
    catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">工程 · 平台版 SVML</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 24, color: 'var(--text-1)', fontWeight: 700 }}>工程文件</h1>
          <div className="hint" style={{ marginTop: 4 }}>生产即模板：台词、分镜、词锚、媒体轨、槽位与渲染配置都在这个文件里；出片即归档，可换料复刻。</div>
        </div>
        <div className="spacer" />
        <Button onClick={rebuild} disabled={busy} icon="refresh">重建工程</Button>
        <a className="btn" href={'/api/v1/projects/' + projectId + '/engineering/download'} download>下载 JSON</a>
        <Button onClick={abstract} disabled={busy}>抽象为模板</Button>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <Pill tone="gold">v{data?.version ?? 0} · {body.meta.status}</Pill>
        <Pill>{body.meta.aspect_ratio} · {body.meta.visual_style}</Pill>
        <Pill>{body.meta.segment_count} 段 / {body.meta.shot_count} 镜</Pill>
        <Pill tone="up">总时长 {seconds(body.meta.total_duration_sec * 1000, 1)}s</Pill>
        <Pill>词锚 {stats?.anchors ?? 0}</Pill>
        <Pill>轨道 {stats?.tracks ?? 0}</Pill>
        <Pill>资产 {stats?.assets ?? 0}</Pill>
      </div>

      <Panel title="可变槽位 · 换料复刻" sub="只改槽位、不动结构：语言与画风会联动台词、镜头与渲染；复刻后血缘指向当前工程">
        <div className="row wrap" style={{ gap: 14, alignItems: 'flex-end' }}>
          <Field label="语言">
            <select className="select" value={lang || String(slotValue('language') ?? 'zh')} onChange={(e) => setLang(e.target.value)}>
              {LANG.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="画面风格">
            <select className="select" value={style || String(slotValue('visual_style') ?? 'realistic')} onChange={(e) => setStyle(e.target.value)}>
              {STYLE.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="出镜人（槽位）">
            <input className="input" value={String(slotValue('host') ?? '当前角色')} readOnly />
          </Field>
          <Button kind="primary" onClick={clone} disabled={busy}>{busy ? '处理中…' : '基于此复刻'}</Button>
        </div>
      </Panel>

      <Panel title="批量复刻 · 槽位矩阵" sub="一次生成多个变体，每个变体独立落项目、独立过 300 秒校验">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grid.map((row, i) => (
            <div key={i} className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
              <Field label={'变体 ' + (i + 1) + ' 语言'}>
                <select className="select" value={row.language} onChange={(e) => setGrid(grid.map((g, gi) => gi === i ? { ...g, language: e.target.value } : g))}>
                  {LANG.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="画面风格">
                <select className="select" value={row.visual_style} onChange={(e) => setGrid(grid.map((g, gi) => gi === i ? { ...g, visual_style: e.target.value } : g))}>
                  {STYLE.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Button size="small" onClick={() => setGrid(grid.filter((_, gi) => gi !== i))}>删除</Button>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <Button size="small" onClick={() => setGrid([...grid, { language: 'en', visual_style: 'realistic' }])}>+ 加一行</Button>
            <Button kind="primary" onClick={batchClone} disabled={busy}>{busy ? '处理中…' : '批量复刻'}</Button>
          </div>
          {created.length > 0 && (
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="hint">已创建：</span>
              {created.map((id) => <a key={id} className="btn small" href={'/project/' + id + '/overview'}>项目 {id}</a>)}
            </div>
          )}
        </div>
      </Panel>

      <div className="chips" style={{ marginBottom: 8 }}>
        <Chip on={tab === 'script'} onClick={() => setTab('script')}>台词与词锚</Chip>
        <Chip on={tab === 'shots'} onClick={() => setTab('shots')}>分镜</Chip>
        <Chip on={tab === 'tracks'} onClick={() => setTab('tracks')}>媒体轨</Chip>
        <Chip on={tab === 'json'} onClick={() => setTab('json')}>原始 JSON</Chip>
      </div>

      {tab === 'script' && (
        <Panel noBody title="台词与词锚" sub="每个词带精确起止时间；花字/B-roll 绑定词区间，改词自动重排">
          <div className="scroll-x" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {body.script.segments.map((seg) => (
              <div key={seg.segment_id}>
                <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                  <b style={{ color: 'var(--gold-light)' }}>{seg.title}</b>
                  <span className="hint">{seconds(seg.duration_sec * 1000, 1)}s</span>
                </div>
                {seg.rounds.map((round) => round.lines.map((line) => (
                  <div key={line.line_id} className="panel" style={{ padding: '10px 12px', marginBottom: 8 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="hint">{line.speaker_name ?? '旁白'}</span>
                      <span style={{ color: 'var(--text-1)' }}>{line.text}</span>
                      <span className="spacer" />
                      <span className="mono hint">{line.duration_sec}s</span>
                    </div>
                    <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
                      {(line.word_anchors ?? []).slice(0, 30).map((w, i) => (
                        <span key={i} className="tag" title={w.start_sec + 's → ' + w.end_sec + 's'}>{w.word}</span>
                      ))}
                    </div>
                  </div>
                )))}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'shots' && (
        <Panel noBody title="分镜" sub="景别 / 提示词 / 引擎 / 时长">
          <div className="scroll-x" style={{ padding: 14 }}>
            <table className="table">
              <thead><tr><th>镜头</th><th>景别</th><th>引擎</th><th>风格</th><th>时长</th><th>提示词</th></tr></thead>
              <tbody>
                {body.shots.shots.map((s) => (
                  <tr key={s.shot_id}>
                    <td className="mono">{s.shot_id}</td>
                    <td>{s.scale}</td>
                    <td>{s.render_engine === 'cloud_muse' ? '云端' : '本地'}</td>
                    <td>{s.visual_style}</td>
                    <td>{s.duration_sec}s</td>
                    <td className="hint" style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.prompt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {tab === 'tracks' && (
        <Panel noBody title="媒体轨（绑词）" sub="花字 / 人名条 / 特效 绑定到台词词区间">
          <div className="scroll-x" style={{ padding: 14 }}>
            <table className="table">
              <thead><tr><th>类型</th><th>文字</th><th>绑定台词</th><th>词区间</th></tr></thead>
              <tbody>
                {body.tracks.tracks.map((t) => (
                  <tr key={t.track_id}>
                    <td>{t.track_kind}</td>
                    <td>{t.text_content ?? '—'}</td>
                    <td className="mono">{t.bind.line_id ?? '—'}</td>
                    <td>{t.bind.word_start} – {t.bind.word_end}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {tab === 'json' && (
        <Panel title="原始 JSON" sub="可读、可 diff、可版本管理">
          <pre className="mono" style={{ margin: 0, maxHeight: 620, overflow: 'auto', fontSize: 11.5, color: 'var(--text-2)' }}>{JSON.stringify(body, null, 2)}</pre>
        </Panel>
      )}
    </>
  );
}
