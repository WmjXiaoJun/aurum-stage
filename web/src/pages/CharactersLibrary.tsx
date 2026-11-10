import React, { useState } from 'react';
import { api } from '../lib/api';
import { useApp, useAsync, useMeta } from '../lib/store';
import { Button, EmptyState, ErrorState, Modal, Panel, Pill, Skeleton } from '../components/ui';
import { navigate } from '../lib/router';
import { styleName } from '../lib/zh';

interface LibCharacter {
  id: number;
  name: string;
  role_type: string;
  project_id: number;
  project_name: string;
  project_style: string;
  cover_url: string | null;
  ref_images?: Array<{ id: number; asset_id: number; angle: string }>;
  seed?: number;
  art_status?: string;
  persona?: string;
  voice?: { provider?: string; voice_id?: string; instruction?: string } | null;
}

const ROLE: Record<string, string> = { host: '主持人', guest: '嘉宾', narrator: '旁白', virtual: '虚拟人', judge: '评委' };
const ANGLE: Record<string, string> = { front: '正面', smile: '微笑', profile: '侧面', full: '全身', expression: '表情' };

export function CharactersLibraryPage(): React.ReactElement {
  const meta = useMeta();
  const { notify } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.characterLibrary(), []);
  const [detail, setDetail] = useState<LibCharacter | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: presets } = useAsync(() => api.voicePresets(), []);
  const [presetId, setPresetId] = useState('laozhou');
  const [voiceBusy, setVoiceBusy] = useState(false);

  if (loading && !data) return <div className="panel"><Skeleton rows={4} height={90} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  const list = (data ?? []) as unknown as LibCharacter[];
  const open = (c: LibCharacter) => { setDetail(c); setBig(c.cover_url); };

  const auditionPreset = async () => {
    if (!detail) return;
    setVoiceBusy(true);
    try {
      const r = await api.auditionCharacter(detail.id, { text: '这一期，我们聊点真的。', preset: presetId });
      const audio = new Audio(r.url);
      void audio.play();
      notify('试听：' + (presets ?? []).find((p) => p.id === presetId)?.label, 'success');
    } catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setVoiceBusy(false); }
  };

  const applyPreset = async () => {
    if (!detail) return;
    setVoiceBusy(true);
    try { await api.bindCharacterVoice(detail.id, { engine: 'breeze', preset: presetId }); notify('已更换音色', 'success'); reload(); }
    catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setVoiceBusy(false); }
  };

  const autoFill = async () => {
    if (!detail) return;
    setBusy(true);
    try { await api.autoCharacter(detail.id); notify('已开始自动补齐：全套形象图 + 音色', 'success'); reload(); }
    catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">资产 · 角色库</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 26, color: 'var(--text-1)', fontWeight: 700 }}>角色库</h1>
          <div className="hint" style={{ marginTop: 4 }}>所有项目的角色集中在这里：立绘、三视图、表情、音色与固定种子；新建角色后自动出图、自动按性别年龄配模型音色。</div>
        </div>
        <div className="spacer" />
        <Pill tone="gold">{list.length} 个角色</Pill>
      </div>

      {list.length === 0 ? (
        <Panel><EmptyState title="还没有角色" desc="进入任一项目 → 角色 → 新建角色，系统会自动生成全套形象与音色。" /></Panel>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))', gap: 14 }}>
          {list.map((c) => (
            <div key={c.id} className="panel" style={{ overflow: 'hidden', cursor: 'pointer' }} onClick={() => open(c)}>
              <div style={{ position: 'relative', height: 250, background: '#06080b' }}>
                {c.cover_url ? (
                  <>
                    <img src={c.cover_url} alt="" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(18px) saturate(1.1)', opacity: 0.55, transform: 'scale(1.15)' }} />
                    <img src={c.cover_url} alt={c.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  </>
                ) : (
                  <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-3)' }}>{c.art_status === 'generating' ? '生成中…' : '还没有形象'}</div>
                )}
                <div style={{ position: 'absolute', left: 8, top: 8, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <Pill tone="gold">{ROLE[c.role_type] ?? '角色'}</Pill>
                  <Pill>{styleName(c.project_style)}</Pill>
                  {c.art_status === 'generating' && <Pill tone="warn">生成中</Pill>}
                </div>
              </div>
              <div style={{ padding: '9px 12px 12px' }}>
                <div style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700 }}>{c.name}</div>
                <div className="hint" style={{ marginTop: 1 }}>{c.project_name}</div>
                <div className="row" style={{ gap: 8, marginTop: 6, fontSize: 11.5, color: 'var(--text-3)' }}>
                  <span>图 <b style={{ color: 'var(--text-1)' }}>{c.ref_images?.length ?? 0}</b></span>
                  <span>音色 <b style={{ color: 'var(--text-1)' }}>{c.voice ? (String(c.voice.provider ?? '').includes('breeze') ? '本地' : '云端') : '—'}</b></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={detail != null} wide title={'角色详情 · ' + (detail?.name ?? '')} onClose={() => setDetail(null)}
        footer={<>
          <Button kind="primary" onClick={autoFill} disabled={busy}>{busy ? '排队中…' : '自动补齐图与音色'}</Button>
          <Button onClick={() => { if (detail) navigate('/project/' + detail.project_id + '/characters'); }}>进入所属项目</Button>
          <Button kind="ghost" onClick={() => setDetail(null)}>关闭</Button>
        </>}>
        {detail && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
            <div style={{ background: '#06080b', borderRadius: 10, overflow: 'hidden', minHeight: 360, display: 'grid', placeItems: 'center' }}>
              {big ? <img src={big} alt={detail.name} style={{ width: '100%', maxHeight: 520, objectFit: 'contain' }} /> : <span className="hint">还没有形象</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ gap: 6 }}>
                <Pill tone="gold">{ROLE[detail.role_type] ?? '角色'}</Pill>
                <Pill>{styleName(detail.project_style)}</Pill>
                {detail.art_status === 'generating' && <Pill tone="warn">生成中</Pill>}
              </div>
              <div className="hint">{detail.persona || '暂无人物小传'}</div>
              <div className="hint">种子 {detail.seed ?? '—'} · 音色 {detail.voice ? (String(detail.voice.provider ?? '').includes('breeze') ? '本地 Breeze 模型' : '云端 edge') : '未绑定'}</div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="hint">更换音色（换完立即用于镜头配音）</div>
                <select className="select" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  {(presets ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <div className="row" style={{ gap: 8 }}>
                  <Button size="small" onClick={auditionPreset} disabled={voiceBusy}>试听</Button>
                  <Button size="small" kind="primary" onClick={applyPreset} disabled={voiceBusy}>应用</Button>
                </div>
                {detail.voice && <div className="hint">当前指导：{String(detail.voice.instruction ?? '—')}</div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8, maxHeight: 300, overflow: 'auto' }}>
                {(detail.ref_images ?? []).map((r) => (
                  <button key={r.id} type="button" onClick={() => setBig('/api/v1/assets/' + r.asset_id + '/raw')} style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: '#06080b', cursor: 'pointer' }} title={ANGLE[r.angle] ?? r.angle}>
                    <img src={'/api/v1/assets/' + r.asset_id + '/raw'} alt={r.angle} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <div className="hint" style={{ marginTop: 12 }}>模型与算力：{meta?.providers?.text?.length ?? 0} 个文本后端 · 云端视频{meta?.providers?.muse?.api_key_set ? '已配置' : '未配置'} · 本地渲染 {meta?.providers?.comfy?.base_url ?? ''}</div>
    </>
  );
}
