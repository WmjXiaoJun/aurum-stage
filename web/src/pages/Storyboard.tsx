import React, { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAsync, useMeta } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, EngineTag, Panel, Pill, Skeleton } from '../components/ui';
import { ShotModal } from '../components/ShotModal';
import { shortText, timecode } from '../lib/format';
import { shotLabel } from '../lib/zh';
import type { Shot } from '../lib/types';

const SCENE: Record<string, string> = {
  talk_show: '/scenes/scene-interview.jpg',
  standup: '/scenes/scene-standup.jpg',
  challenge: '/scenes/scene-game.jpg',
  skit: '/scenes/scene-skit.jpg'
};

export function StoryboardPage({ projectId }: { projectId: number }): React.ReactElement {
  const m = useMeta();
  const { data, loading, error, reload } = useAsync(() => api.shots(projectId), [projectId]);
  const { data: assets } = useAsync(() => api.assets(projectId), [projectId]);
  const { data: overview } = useAsync(() => api.overview(projectId), [projectId]);
  const [active, setActive] = useState<number | null>(null);
  const [segmentId, setSegmentId] = useState<number | 'all'>('all');

  const posterMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of assets ?? []) {
      const poster = (a.meta as { poster_asset_id?: number })?.poster_asset_id;
      if (a.asset_type === 'video' && poster) map.set(a.id, poster);
    }
    return map;
  }, [assets]);

  const shots = (data ?? []).filter((s) => segmentId === 'all' || s.segment_id === segmentId);
  const grouped = shots.reduce<Record<string, Shot[]>>((acc, s) => {
    const key = s.segment_title ?? '未分组';
    (acc[key] = acc[key] ?? []).push(s);
    return acc;
  }, {});
  const scene = SCENE[overview?.project.variety_type ?? 'talk_show'];

  if (loading && !data) return <div className="panel"><Skeleton rows={3} height={120} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">M3 · 分镜视图</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>分镜卡片</h1>
        </div>
        <div className="spacer" />
        <Button icon="refresh" onClick={reload}>刷新</Button>
      </div>

      <div className="chips">
        <Chip on={segmentId === 'all'} onClick={() => setSegmentId('all')}>全部环节</Chip>
        {(overview?.segments ?? []).map((seg) => (
          <Chip key={seg.id} on={segmentId === seg.id} onClick={() => setSegmentId(seg.id)}>{seg.title}</Chip>
        ))}
      </div>

      {shots.length === 0 ? (
        <Panel><EmptyState title="暂无分镜" desc="先在台本页解析出镜头。" /></Panel>
      ) : (
        Object.entries(grouped).map(([title, list]) => (
          <Panel key={title} title={title} sub={list.length + ' 个镜头 · ' + timecode(list.reduce((n, s) => n + s.duration_ms, 0))} right={<Pill tone="jade">{list.filter((s) => s.status !== 'empty').length} 已生成</Pill>}>
            <div className="story-grid">
              {list.map((s) => {
                const poster = s.preview_asset_id ? posterMap.get(s.preview_asset_id) : undefined;
                return (
                  <div key={s.id} className="story-card" onClick={() => setActive(s.id)}>
                    <div className="story-cover">
                      <img src={poster ? '/api/v1/assets/' + poster + '/raw' : scene} alt={s.shot_code} style={{ opacity: poster ? 1 : 0.5 }} />
                      <span className="badge"><Pill tone={s.render_engine === 'muse_api' ? 'gold' : 'jade'}>{s.render_engine === 'muse_api' ? '云端' : '本地'}</Pill></span>
                      <span className="dur">{timecode(s.duration_ms, true)}</span>
                    </div>
                    <div className="story-meta">
                      <div className="row" style={{ gap: 6 }}>
                        <span className="code">{shotLabel(s.segment_seq, s.seq)}</span>
                        <div className="spacer" />
                        <span className="cam">{m?.constants.cameras.find((c) => c.id === s.camera)?.label}</span>
                      </div>
                      <div className="line">{shortText(s.text_clean || s.visual_prompt || '（空镜）', 24)}</div>
                      <div className="row" style={{ gap: 6 }}>
                        <EngineTag engine={s.render_engine} />
                        {s.emotion && <span className="tag">{m?.emotions.find((e) => e.id === s.emotion)?.label}</span>}
                        {s.lipsync_required && <span className="tag">口型对齐</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        ))
      )}

      <ShotModal
        shotId={active}
        open={active != null}
        compliance={overview?.compliance.find((c) => c.segment_id === (data ?? []).find((s) => s.id === active)?.segment_id) ?? null}
        onClose={() => setActive(null)}
        onChanged={reload}
      />
    </>
  );
}
