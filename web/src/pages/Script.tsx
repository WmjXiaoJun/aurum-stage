import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync, useMeta } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { seconds, shortText } from '../lib/format';
import { shotLabel } from '../lib/zh';
import type { Shot } from '../lib/types';

const DEMO = `# AI 圆桌派 第 1 期

## 开场片花
【空镜】赛博霓虹城市夜景推镜，字幕光斑扫过
【花字】这一期，我们聊点真话

## 第一轮 · 今天聊什么
【主持人·阿哲】欢迎来到节目，今天我们只聊一件具体的事。
【嘉宾·林小满】（笑）我先说结论，能替掉的是体力活，替不掉的是判断。
【主持人·阿哲】（停顿半秒）这句话可以当标题了。
`;

interface PreviewResult {
  report: Record<string, unknown>;
  estimated_segments: Array<{ title: string; segment_type: string; shots: number; estimate_ms: number }>;
}

export function ScriptPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify, meta } = useApp();
  const m = useMeta();
  const { data, loading, error, reload } = useAsync(() => api.scripts(projectId), [projectId]);
  const [scriptId, setScriptId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [tab, setTab] = useState<'structure' | 'tags'>('structure');

  useEffect(() => {
    const latest = (data ?? [])[0];
    if (!latest) return;
    setScriptId(latest.id);
    api.getScript(latest.id)
      .then((res) => { setText(res.script.raw_md); setShots(res.shots); })
      .catch((err) => notify((err as ApiError).message, 'error'));
  }, [data, notify]);

  const save = async (): Promise<number | null> => {
    setSaving(true);
    try {
      const saved = await api.saveScript(projectId, text);
      setScriptId(saved.id);
      notify('台本已保存（v' + saved.version + '）', 'success');
      reload();
      return saved.id;
    } catch (err) {
      notify((err as ApiError).message, 'error');
      return null;
    } finally { setSaving(false); }
  };

  const runPreview = async () => {
    try {
      const res = await api.parsePreview(projectId, text);
      setPreview(res as unknown as PreviewResult);
      notify('解析预览完成：' + res.estimated_segments.length + ' 个环节', 'success');
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  const parse = async () => {
    setParsing(true);
    try {
      const id = scriptId ?? (await save());
      if (!id) return;
      const res = await api.parseScript(id, { use_llm: true });
      setShots(res.shots);
      notify('解析完成：' + res.compliance.length + ' 个环节，' + res.shots.length + ' 个镜头' + (res.created_characters.length ? '，自动补建角色 ' + res.created_characters.join('、') : ''), 'success');
      reload();
    } catch (err) {
      const e = err as ApiError;
      notify(e.code + ' · ' + e.message, 'error');
    } finally { setParsing(false); }
  };

  if (loading && !text) return <div className="panel"><Skeleton rows={4} height={80} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  const grouped = shots.reduce<Record<string, Shot[]>>((acc, s) => {
    const key = s.segment_title ?? '未分组';
    (acc[key] = acc[key] ?? []).push(s);
    return acc;
  }, {});

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">M1 · 综艺台本引擎</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>台本编辑与结构化解析</h1>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          <Button onClick={runPreview} icon="search">解析预览</Button>
          <Button onClick={save} icon="check" disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          <Button kind="primary" icon="sparkle" onClick={parse} disabled={parsing}>{parsing ? '解析中…' : '解析并落库'}</Button>
        </div>
      </div>

      {!text && (
        <Panel title="还没有台本" sub="可以直接粘贴 Markdown，或载入一段示例">
          <EmptyState
            title="从一段台本开始"
            desc="支持 【角色】、角色：台词、## 环节标题、（笑）（停顿半秒）等表演标签。"
            action={<Button kind="primary" icon="script" onClick={() => setText(DEMO)}>载入示例台本</Button>}
          />
        </Panel>
      )}

      {text && (
        <div className="split">
          <Panel
            noBody
            title="台本原文"
            sub="左侧手写台本，右侧实时结构化；手工改过的镜头在重新解析时会被保留"
            right={<Pill>{text.length} 字</Pill>}
          >
            <div style={{ padding: 12 }}>
              <textarea
                className="textarea editor"
                style={{ width: '100%' }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                placeholder="粘贴台本…"
              />
            </div>
          </Panel>

          <Panel
            noBody
            title="结构化视图"
            sub={preview ? '解析预览（未落库）' : '已落库镜头'}
            right={
              <div className="chips">
                <Chip on={tab === 'structure'} onClick={() => setTab('structure')}>结构</Chip>
                <Chip on={tab === 'tags'} onClick={() => setTab('tags')}>表演标签速查</Chip>
              </div>
            }
          >
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 640, overflow: 'auto' }}>
              {tab === 'tags' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(m?.tag_cheatsheet ?? []).map((t) => (
                    <div key={t.write} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ color: 'var(--gold-light)' }}>{t.write}</div>
                      <div className="hint">{t.alias}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{t.result.split('·').slice(1).join('·').trim() || t.result}</div>
                    </div>
                  ))}
                  <div className="hint" style={{ marginTop: 6 }}>抽象词改写建议：</div>
                  {(m?.abstract_to_performable ?? []).map((a) => (
                    <div key={a.bad} className="row" style={{ gap: 8, fontSize: 11.5 }}>
                      <span style={{ color: 'var(--down)' }}>{a.bad}</span>
                      <Icon name="chevron" size={12} />
                      <span style={{ color: 'var(--up)' }}>{a.good}</span>
                    </div>
                  ))}
                </div>
              ) : preview ? (
                <>
                  <div className="row" style={{ gap: 8 }}>
                    <Pill tone="gold">{String(preview.report.used_llm ? '模型结构化' : '规则解析')}</Pill>
                    <Pill tone="jade">{preview.estimated_segments.length} 环节</Pill>
                    <Pill>{preview.estimated_segments.reduce((n, s) => n + s.shots, 0)} 镜头</Pill>
                  </div>
                  {preview.estimated_segments.map((s) => (
                    <div key={s.title} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                      <div className="row"><b style={{ color: 'var(--text-1)', fontSize: 12.5 }}>{s.title}</b><div className="spacer" /><span className="mono hint">{seconds(s.estimate_ms, 1)}s</span></div>
                      <div className="hint">{s.shots} 个镜头 · {m?.constants.segment_types.find((x) => x.id === s.segment_type)?.label}</div>
                    </div>
                  ))}
                  {((preview.report.warnings as Array<{ message: string; level: string }> | undefined) ?? []).slice(0, 8).map((w, i) => (
                    <div key={i} className={w.level === 'error' ? 'danger-block' : 'warn-block'} style={{ fontSize: 11.5 }}>{w.message}</div>
                  ))}
                </>
              ) : Object.keys(grouped).length === 0 ? (
                <EmptyState title="还没有结构化结果" desc="点击右上角「解析并落库」把台本拆成环节 / 轮次 / 镜头。" />
              ) : (
                Object.entries(grouped).map(([segmentTitle, list]) => (
                  <div key={segmentTitle}>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <b style={{ color: 'var(--text-1)', fontSize: 12.5 }}>{segmentTitle}</b>
                      <div className="spacer" />
                      <span className="mono hint">{list.length} 镜头 · {seconds(list.reduce((n, s) => n + s.duration_ms, 0), 1)}s</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {list.map((s) => (
                        <div key={s.id} className="row" style={{ gap: 8, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8, background: '#11161d' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{shotLabel(s.segment_seq, s.seq)}</span>
                          <span className="tag">{s.speaker_name ?? '空镜'}</span>
                          <span style={{ flex: 1, color: 'var(--text-1)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {shortText(s.text_clean || s.visual_prompt || '', 52)}
                          </span>
                          {s.emotion && <span className="tag">{m?.emotions.find((e) => e.id === s.emotion)?.label}</span>}
                          <span className="mono hint">{(s.duration_ms / 1000).toFixed(1)}s</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
