import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAsync, useMeta, useApp } from '../lib/store';
import { Button, EmptyState, ErrorState, Panel, Pill, Skeleton } from '../components/ui';
import { seconds, timecode } from '../lib/format';
import { shotLabel } from '../lib/zh';
import type { TimelineItem, TimelineTrack } from '../lib/types';

const TRACK_ORDER: TimelineTrack[] = ['video', 'subtitle', 'flower', 'audio_voice', 'audio_bgm', 'audio_sfx'];

interface DragState {
  id: number;
  mode: 'move' | 'trim-start' | 'trim-end';
  originX: number;
  start: number;
  end: number;
}

export function TimelinePage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const m = useMeta();
  const { data, loading, error, reload } = useAsync(() => api.timeline(projectId), [projectId]);
  const { data: overview } = useAsync(() => api.overview(projectId), [projectId]);
  const [zoom, setZoom] = useState(12);
  const [selected, setSelected] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<{ id: number; start: number; end: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const laneRef = useRef<HTMLDivElement | null>(null);

  const items = data?.items ?? [];
  const total = Math.max(1000, data?.total_ms ?? 0);
  const width = Math.max(600, (total / 1000) * zoom);
  const capSec = overview?.project.segment_cap_sec ?? 300;
  const selectedItem = items.find((i) => i.id === selected) ?? null;

  const byTrack = useMemo(() => {
    const map = new Map<TimelineTrack, TimelineItem[]>();
    for (const track of TRACK_ORDER) map.set(track, []);
    for (const item of items) {
      const arr = map.get(item.track) ?? [];
      arr.push(item);
      map.set(item.track, arr);
    }
    return map;
  }, [items]);

  const patch = async (id: number, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.patchTimeline(id, body);
      reload();
    } catch (err) { notify(String((err as Error).message), 'error'); }
    finally { setBusy(false); }
  };

  // 拖动：移动 / 左右裁剪
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const deltaMs = Math.round(((e.clientX - drag.originX) / zoom) * 1000);
      if (drag.mode === 'move') {
        const start = Math.max(0, drag.start + deltaMs);
        setGhost({ id: drag.id, start, end: start + (drag.end - drag.start) });
      } else if (drag.mode === 'trim-start') {
        const start = Math.min(Math.max(0, drag.start + deltaMs), drag.end - 500);
        setGhost({ id: drag.id, start, end: drag.end });
      } else {
        const end = Math.max(drag.start + 500, drag.end + deltaMs);
        setGhost({ id: drag.id, start: drag.start, end });
      }
    };
    const onUp = async () => {
      if (ghost) {
        await patch(ghost.id, { start_ms: ghost.start, end_ms: ghost.end });
        notify('已更新时间轴片段', 'success');
      }
      setDrag(null);
      setGhost(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, ghost, zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedItem) return;
      if (e.key === 'Delete') { void remove(selectedItem.id); }
      if (e.key === 'ArrowLeft') { void patch(selectedItem.id, { start_ms: Math.max(0, selectedItem.start_ms - 100), end_ms: Math.max(500, selectedItem.end_ms - 100) }); }
      if (e.key === 'ArrowRight') { void patch(selectedItem.id, { start_ms: selectedItem.start_ms + 100, end_ms: selectedItem.end_ms + 100 }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedItem]);

  const remove = async (id: number) => {
    try { await api.deleteTimeline(id); notify('已删除片段', 'success'); setSelected(null); reload(); }
    catch (err) { notify(String((err as Error).message), 'error'); }
  };

  const split = async () => {
    if (!selectedItem) return;
    const at = Math.min(Math.max(playhead, selectedItem.start_ms + 200), selectedItem.end_ms - 200);
    try { await api.splitTimeline(selectedItem.id, at); notify('已在播放头处拆分', 'success'); reload(); }
    catch (err) { notify(String((err as Error).message), 'error'); }
  };

  const rebuild = async () => {
    try { await api.rebuildTimeline(projectId); notify('时间轴已按镜头重建（锁定片段保留）', 'success'); reload(); }
    catch (err) { notify(String((err as Error).message), 'error'); }
  };

  if (loading && !data) return <div className="panel"><Skeleton rows={6} height={54} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  const assetOf = (item: TimelineItem | null) => (item && item.asset_id ? '/api/v1/assets/' + item.asset_id + '/raw' : null);

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">M3 · 五轨时间轴</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>时间轴</h1>
          <div className="hint" style={{ marginTop: 4 }}>拖动片段改位置，拖两端裁剪；裁剪视频轨会同步镜头时长，合成立即生效。方向键微调 0.1 秒，Delete 删除。</div>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          <span className="hint">缩放</span>
          <input type="range" min={6} max={40} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <span className="mono hint">{zoom}px/s</span>
          <Button icon="refresh" onClick={rebuild} disabled={busy}>重建时间轴</Button>
        </div>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <Pill tone="gold">总时长 {timecode(total)}</Pill>
        <Pill>片段 {items.length}</Pill>
        <Pill tone={total > capSec * 1000 ? 'down' : 'up'}>单段上限 {timecode(capSec * 1000)}</Pill>
        <span className="hint">播放头 {timecode(playhead)} · 视频轨金色=云端 / 青玉=本地</span>
      </div>

      <Panel noBody title="轨道" sub="选中片段后可在下方精确编辑；点击标尺移动播放头">
        {items.length === 0 ? (
          <EmptyState title="时间轴为空" desc="解析台本或提交渲染后，时间轴会自动生成。" />
        ) : (
          <div className="scroll-x">
            <div style={{ minWidth: 140 + width }}>
              <div className="row" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', gap: 8 }}>
                <span style={{ width: 130, flex: '0 0 130px' }} className="hint">轨道</span>
                <div
                  ref={laneRef}
                  style={{ position: 'relative', flex: 1, height: 20, cursor: 'crosshair' }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPlayhead(Math.round(((e.clientX - rect.left) / zoom) * 1000));
                  }}
                >
                  {Array.from({ length: Math.ceil(total / 5000) + 1 }).map((_, i) => (
                    <span key={i} className="mono hint" style={{ position: 'absolute', left: i * 5 * zoom, fontSize: 10, color: 'var(--text-3)' }}>{timecode(i * 5000)}</span>
                  ))}
                  <span style={{ position: 'absolute', left: (capSec * 1000 / 1000) * zoom, top: -6, bottom: -6, width: 2, background: 'var(--down)' }} />
                  <span style={{ position: 'absolute', left: (playhead / 1000) * zoom, top: -4, bottom: -4, width: 2, background: 'var(--gold-light)' }} />
                </div>
              </div>
              {TRACK_ORDER.map((track) => {
                const list = byTrack.get(track) ?? [];
                return (
                  <div key={track} className="track-row">
                    <div className="track-label">
                      <span>{m?.constants.timeline_tracks.find((t) => t.id === track)?.label ?? track}</span>
                      <span className="mono hint">{list.length}</span>
                    </div>
                    <div className="track-lane" style={{ width, position: 'relative' }}>
                      {list.map((item) => {
                        const shownStart = ghost && ghost.id === item.id ? ghost.start : item.start_ms;
                        const shownEnd = ghost && ghost.id === item.id ? ghost.end : item.end_ms;
                        const left = (shownStart / 1000) * zoom;
                        const w = Math.max(8, ((shownEnd - shownStart) / 1000) * zoom);
                        const engine = (item.payload as { engine?: string })?.engine;
                        const cls = ['track-clip', item.track, item.track === 'video' ? (engine === 'muse_api' ? 'cloud' : 'local') : ''].filter(Boolean).join(' ');
                        const payload = item.payload as { text?: string; shot_code?: string };
                        const seg = payload?.shot_code?.match(/S(\d+)-SH(\d+)/);
                        const label = seg ? shotLabel(Number(seg[1]), Number(seg[2])) : String(payload?.text ?? '片段');
                        const isSel = selected === item.id;
                        return (
                          <div
                            key={item.id}
                            className={cls}
                            style={{ left, width: w, borderStyle: item.locked ? 'dashed' : 'solid', outline: isSel ? '2px solid var(--gold-light)' : 'none', cursor: item.locked ? 'not-allowed' : 'grab', userSelect: 'none' }}
                            title={label + ' · ' + seconds(shownEnd - shownStart) + 's'}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setSelected(item.id);
                              if (item.locked) return;
                              const rect = e.currentTarget.getBoundingClientRect();
                              const offset = e.clientX - rect.left;
                              const mode: DragState['mode'] = offset > rect.width - 10 ? 'trim-end' : offset < 10 ? 'trim-start' : 'move';
                              setDrag({ id: item.id, mode, originX: e.clientX, start: item.start_ms, end: item.end_ms });
                            }}
                          >
                            {item.locked ? '🔒 ' : ''}{label.slice(0, 12)}
                            {!item.locked && (
                              <>
                                <span
                                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'rgba(212,184,126,0.35)' }}
                                  onPointerDown={(e) => { e.stopPropagation(); setSelected(item.id); setDrag({ id: item.id, mode: 'trim-start', originX: e.clientX, start: item.start_ms, end: item.end_ms }); }}
                                />
                                <span
                                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'rgba(212,184,126,0.35)' }}
                                  onPointerDown={(e) => { e.stopPropagation(); setSelected(item.id); setDrag({ id: item.id, mode: 'trim-end', originX: e.clientX, start: item.start_ms, end: item.end_ms }); }}
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                      <span style={{ position: 'absolute', left: (playhead / 1000) * zoom, top: 0, bottom: 0, width: 1, background: 'rgba(232,214,168,0.5)', pointerEvents: 'none' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="片段编辑" sub={selectedItem ? '拖动或直接输入毫秒数，改动立即保存并回写镜头时长' : '在上方轨道里点一个片段开始编辑'}>
        {!selectedItem ? (
          <div className="hint">未选中片段。选择后可裁剪、拆分、复制、删除、锁定，视频轨还能直接预览。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="kv">
              <dt>类型</dt><dd>{m?.constants.timeline_tracks.find((t) => t.id === selectedItem.track)?.label ?? selectedItem.track}</dd>
              <dt>范围</dt><dd>{timecode(selectedItem.start_ms)} → {timecode(selectedItem.end_ms)}（{(seconds(selectedItem.end_ms - selectedItem.start_ms))}s）</dd>
              <dt>锁定</dt><dd>{selectedItem.locked ? '已锁定' : '未锁定'}</dd>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="hint">起点(ms)
                <input className="input" style={{ width: 120 }} type="number" value={selectedItem.start_ms} onChange={(e) => patch(selectedItem.id, { start_ms: Math.max(0, Number(e.target.value)), end_ms: selectedItem.end_ms })} />
              </label>
              <label className="hint">终点(ms)
                <input className="input" style={{ width: 120 }} type="number" value={selectedItem.end_ms} onChange={(e) => patch(selectedItem.id, { start_ms: selectedItem.start_ms, end_ms: Math.max(selectedItem.start_ms + 500, Number(e.target.value)) })} />
              </label>
              <Button size="small" onClick={() => patch(selectedItem.id, { start_ms: Math.max(0, selectedItem.start_ms - 100), end_ms: Math.max(500, selectedItem.end_ms - 100) })}>← 0.1s</Button>
              <Button size="small" onClick={() => patch(selectedItem.id, { start_ms: selectedItem.start_ms + 100, end_ms: selectedItem.end_ms + 100 })}>0.1s →</Button>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button size="small" onClick={() => patch(selectedItem.id, { locked: !selectedItem.locked })}>{selectedItem.locked ? '解锁' : '锁定'}</Button>
              <Button size="small" onClick={split}>在播放头拆分</Button>
              <Button size="small" onClick={async () => { try { await api.duplicateTimeline(selectedItem.id); notify('已复制片段', 'success'); reload(); } catch (err) { notify(String((err as Error).message), 'error'); } }}>复制</Button>
              <Button size="small" kind="danger" onClick={() => remove(selectedItem.id)}>删除</Button>
            </div>
            {assetOf(selectedItem) && (selectedItem.track === 'video' || selectedItem.track === 'audio_voice') && (
              <div>
                <div className="hint" style={{ marginBottom: 6 }}>片段预览</div>
                {selectedItem.track === 'video'
                  ? <video key={String(selectedItem.asset_id)} src={assetOf(selectedItem) as string} controls playsInline style={{ width: '100%', maxHeight: 420, background: '#000', borderRadius: 10 }} />
                  : <audio key={String(selectedItem.asset_id)} src={assetOf(selectedItem) as string} controls style={{ width: '100%' }} />}
              </div>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
