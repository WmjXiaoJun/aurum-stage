import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { dateTime, seconds } from '../lib/format';
import { humanizeTech } from '../lib/zh';

interface ComposeResult {
  mode: string;
  duration_sec: number;
  video_url: string | null;
  subtitle_url: string;
  ass_url: string;
  warnings: string[];
}

export function ExportPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const { data: overview } = useAsync(() => api.overview(projectId), [projectId]);
  const { data: exportsList, loading, error, reload } = useAsync(() => api.exports(projectId), [projectId]);
  const [segmentId, setSegmentId] = useState<number | null>(null);
  const [bgm, setBgm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  const compose = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.compose(projectId, { segment_id: segmentId, bgm });
      setResult(res);
      notify(res.mode === 'mp4' ? '成片已生成（' + res.duration_sec + 's）' : '已输出字幕与合成清单', res.mode === 'mp4' ? 'success' : 'info');
      reload();
    } catch (err) {
      const e = err as ApiError;
      notify(e.code + ' · ' + e.message + (e.uiHint ? '（' + e.uiHint + '）' : ''), 'error');
    } finally { setBusy(false); }
  };

  if (loading && !exportsList) return <div className="panel"><Skeleton rows={4} height={64} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">M5 · 合成导出</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>成片与素材包</h1>
          <div className="hint" style={{ marginTop: 4 }}>归一化 → 拼接 → 人声+配乐混音 → 字幕花字压制 · 输出 1280×720 H.264/AAC（全链路统一横屏 720p）</div>
        </div>
        <div className="spacer" />
        <Pill tone={overview?.runtime.ffmpeg ? 'up' : 'warn'} dot>{overview?.runtime.ffmpeg ? '合成引擎就绪，可出片' : '合成引擎缺失，仅输出清单'}</Pill>
      </div>

      <Panel title="合成参数" sub="合成入口会再次做段时长硬校验，超限直接拒绝">
        <div className="row wrap" style={{ gap: 12 }}>
          <div className="chips">
            <Chip on={segmentId == null} onClick={() => setSegmentId(null)}>整个项目</Chip>
            {(overview?.segments ?? []).map((s) => (
              <Chip key={s.id} on={segmentId === s.id} onClick={() => setSegmentId(s.id)}>{s.title}</Chip>
            ))}
          </div>
          <div className="spacer" />
          <Chip on={bgm} onClick={() => setBgm(!bgm)} icon="wave">混入配乐</Chip>
          <Button kind="primary" icon="export" onClick={compose} disabled={busy}>{busy ? '合成中…' : '开始合成'}</Button>
        </div>
        {overview && overview.stats.exceed > 0 && (
          <div className="danger-block" style={{ marginTop: 12 }}>当前有 {overview.stats.exceed} 个环节超过 300 秒，合成会被拒绝，请先删减镜头或拆分段落。</div>
        )}
      </Panel>

      <Panel title="成片预览" sub="整片直接在页面内播放，可拖动进度条（服务端已支持分段加载）">
        {(() => {
          const first = (exportsList ?? []).find((e) => e.video_asset_id);
          const assetId = playing ?? (first ? Number(first.video_asset_id) : null) ?? (result?.video_url ? null : null);
          if (assetId) {
            return <video key={assetId} src={'/api/v1/assets/' + assetId + '/raw'} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 620, background: '#000', borderRadius: 12 }} />;
          }
          if (result?.video_url) {
            return <video key={result.video_url} src={result.video_url} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 620, background: '#000', borderRadius: 12 }} />;
          }
          return <div className="hint">还没有可播放的成片，先在下方导出历史里选择一条，或点「开始合成」。</div>;
        })()}
      </Panel>

      {result && (
        <Panel title="本次合成结果" sub={result.mode === 'mp4' ? '已产出可播放成片' : '清单模式：安装合成引擎后可出片'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {result.video_url && (
              <video src={result.video_url} controls style={{ width: '100%', maxHeight: 520, background: '#000', borderRadius: 10 }} />
            )}
            <div className="row" style={{ gap: 10 }}>
              <Pill tone="up">{result.duration_sec}s</Pill>
              {result.video_url && <a className="btn small" href={result.video_url} download><Icon name="download" size={13} /> 下载成片</a>}
              <a className="btn small" href={result.subtitle_url} download><Icon name="download" size={13} /> 下载字幕</a>
              <a className="btn small" href={result.ass_url} download><Icon name="download" size={13} /> 下载花字字幕</a>
            </div>
            {result.warnings.length > 0 && <div className="warn-block">{result.warnings.map((w) => <div key={w}>· {humanizeTech(w)}</div>)}</div>}
          </div>
        </Panel>
      )}

      <Panel noBody title="导出历史" sub="每次合成都会记录导出表与清单">
        {(exportsList ?? []).length === 0 ? (
          <EmptyState title="还没有导出记录" desc="点上方「开始合成」生成第一条成片。" />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th style={{ width: 80 }}>ID</th><th style={{ width: 110 }}>状态</th><th style={{ width: 100 }}>时长</th><th>产物</th><th style={{ width: 170 }}>时间</th></tr></thead>
              <tbody>
                {(exportsList ?? []).map((e) => (
                  <tr key={String(e.id)}>
                    <td><span className="mono">#{String(e.id)}</span></td>
                    <td><Pill tone={e.status === 'mp4' ? 'up' : 'warn'}>{String(e.status)}</Pill></td>
                    <td><span className="mono">{e.duration_ms ? seconds(Number(e.duration_ms), 1) + 's' : '—'}</span></td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        {e.video_asset_id ? (
                          <>
                            <Button size="small" kind={playing === Number(e.video_asset_id) ? 'primary' : undefined} icon="play" onClick={() => setPlaying(Number(e.video_asset_id))}>播放整片</Button>
                            <a className="btn small" href={'/api/v1/assets/' + String(e.video_asset_id) + '/raw'} download>下载</a>
                          </>
                        ) : <span className="hint">清单</span>}
                        {e.subtitle_asset_id ? <a className="btn small" href={'/api/v1/assets/' + String(e.subtitle_asset_id) + '/raw'} target="_blank" rel="noreferrer">字幕</a> : null}
                        {e.ass_asset_id ? <a className="btn small" href={'/api/v1/assets/' + String(e.ass_asset_id) + '/raw'} target="_blank" rel="noreferrer">花字</a> : null}
                        {(() => {
                          try {
                            const man = JSON.parse(String((e as { manifest?: string }).manifest ?? '{}')) as { deliverable?: string };
                            if (!man.deliverable) return null;
                            const name = man.deliverable.split(/[\\/]/).pop();
                            return <span className="hint">已归档：{name}</span>;
                          } catch { return null; }
                        })()}
                        {e.error_msg ? <span className="hint" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{humanizeTech(String(e.error_msg))}</span> : null}
                      </div>
                    </td>
                    <td><span className="hint">{e.created_at ? dateTime(String(e.created_at)) : '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
