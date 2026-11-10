import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync, useMeta } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Field, Modal, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { seconds } from '../lib/format';
import { REF_TYPE_LABEL, humanizeTech, engineName } from '../lib/zh';
import type { Voice } from '../lib/types';

export function VoicesPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const m = useMeta();
  const { data, loading, error, reload } = useAsync(() => api.voices(projectId), [projectId]);
  const { data: characters } = useAsync(() => api.characters(projectId), [projectId]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ voice_id: '', role_id: '', provider: 'indextts2', base_speed: 1, forbidden: '' });
  const [health, setHealth] = useState<Record<number, { ok: boolean; issues: string[] }>>({});

  const create = async () => {
    try {
      await api.createVoice(projectId, draft);
      notify('音色已创建', 'success');
      setOpen(false);
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  const upload = async (voice: Voice, file: File, refType: string) => {
    try {
      const asset = await api.uploadAsset(projectId, file, { type: 'audio' });
      await api.addVoiceRef(voice.id, { asset_id: asset.id, ref_type: refType, note: file.name });
      notify('参考音频已上传', 'success');
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  const check = async (voice: Voice) => {
    try {
      const res = await api.voiceHealth(voice.id);
      setHealth((prev) => ({ ...prev, [voice.id]: res }));
      notify(res.ok ? '参考音频体检通过' : '发现 ' + res.issues.length + ' 个问题', res.ok ? 'success' : 'error');
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  if (loading && !data) return <div className="panel"><Skeleton rows={3} height={100} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">M2 · 音色资产（音色与情感解耦）</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>音色与情绪能力</h1>
        </div>
        <div className="spacer" />
        <Button kind="primary" icon="plus" onClick={() => setOpen(true)}>新建音色</Button>
      </div>

      {(data ?? []).length === 0 ? (
        <Panel><EmptyState title="还没有音色资产" desc="解析台本时系统会按角色自动补建音色，也可以手动创建并上传参考音频（6–15s，无背景噪）。" /></Panel>
      ) : (
        <div className="grid-2">
          {(data ?? []).map((v, index) => {
            const bound = characters?.find((c) => c.role_id === v.role_id);
            const h = health[v.id];
            return (
              <Panel
                key={v.id}
                title={<div className="row" style={{ gap: 8 }}><Icon name="voice" size={15} /><span>{'第 ' + (index + 1) + ' 条音色'}</span></div>}
                sub={(bound?.name ?? '未绑定角色') + ' · ' + engineName(v.provider) + ' · 基准语速 ' + v.base_speed}
                right={<Pill tone={v.is_active ? 'up' : null} dot>{v.is_active ? '启用' : '停用'}</Pill>}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div className="hint" style={{ marginBottom: 6 }}>可用情绪（同一音色，不同情绪，音色不漂移）</div>
                    <div className="chips">
                      {(v.available_emotions ?? []).map((e) => (
                        <span key={e} className="tag">{m?.emotions.find((x) => x.id === e)?.label ?? e}</span>
                      ))}
                    </div>
                  </div>
                  {v.forbidden && <div className="hint">禁用：{v.forbidden}</div>}

                  <div>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <span className="hint">参考音频（{(v.ref_audios ?? []).length} 条）</span>
                      <div className="spacer" />
                      <label className="btn small" style={{ cursor: 'pointer' }}>
                        <Icon name="upload" size={12} /> 上传常规语气
                        <input type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(v, f, 'normal'); }} />
                      </label>
                      <label className="btn small" style={{ cursor: 'pointer', marginLeft: 6 }}>
                        <Icon name="upload" size={12} /> 上传情绪峰值
                        <input type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(v, f, 'emotional_peak'); }} />
                      </label>
                    </div>
                    {(v.ref_audios ?? []).length === 0 ? (
                      <div className="hint">还没有参考音频（建议 ≥2 条：常规语气 + 情绪峰值）</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(v.ref_audios ?? []).map((r) => (
                          <div key={r.id} className="row" style={{ gap: 8, border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}>
                            <span className="tag">{REF_TYPE_LABEL[r.ref_type] ?? '参考音频'}</span>
                            <audio src={'/api/v1/assets/' + r.asset_id + '/raw'} controls style={{ height: 26, flex: 1, minWidth: 0 }} />
                            <span className="mono hint">{r.duration_sec ? seconds(r.duration_sec * 1000) + 's' : '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="row">
                    <Button size="small" icon="qa" onClick={() => check(v)}>参考音频体检</Button>
                    <div className="spacer" />
                    <span className="hint">授权文件：{v.authorization_file_hash ? '已登记' : '未登记'}</span>
                  </div>
                  {h && (
                    h.ok ? <Pill tone="up">体检通过</Pill> : <div className="warn-block">{h.issues.map((i) => <div key={i}>· {humanizeTech(i)}</div>)}</div>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        title="新建音色资产"
        onClose={() => setOpen(false)}
        footer={<><Button kind="ghost" onClick={() => setOpen(false)}>取消</Button><Button kind="primary" onClick={create}>创建</Button></>}
      >
        <div className="grid-2">
          <Field label="音色标识（仅内部使用）"><input className="input" value={draft.voice_id} onChange={(e) => setDraft({ ...draft, voice_id: e.target.value })} placeholder="例如：主持人暖声" /></Field>
          <Field label="绑定角色">
            <select className="select" value={draft.role_id} onChange={(e) => setDraft({ ...draft, role_id: e.target.value })}>
              <option value="">不绑定</option>
              {(characters ?? []).map((c) => <option key={c.role_id} value={c.role_id}>{c.name}（{c.role_id}）</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="配音引擎">
            <select className="select" value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })}>
              <option value="indextts2">本地主力引擎</option>
              <option value="cosyvoice3">本地备用引擎</option>
              <option value="fishspeech">标签化配音引擎</option>
              <option value="drama3">云端配音引擎</option>
            </select>
          </Field>
          <Field label="基准语速"><input className="input mono" type="number" step="0.01" value={draft.base_speed} onChange={(e) => setDraft({ ...draft, base_speed: Number(e.target.value) })} /></Field>
        </div>
        <Field label="禁用情绪 / 音色限制"><input className="input" value={draft.forbidden} onChange={(e) => setDraft({ ...draft, forbidden: e.target.value })} placeholder="沙哑, 哭腔, 过于激动" /></Field>
      </Modal>
    </>
  );
}
