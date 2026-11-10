import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Field, Modal, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Character } from '../lib/types';
import { ROLE_TYPE_LABEL, ANGLE_LABEL, styleName } from '../lib/zh';
import { navigate } from '../lib/router';

const ROLE_LABEL = ROLE_TYPE_LABEL;
const ART_MODES = [
  { id: 'portrait', label: '概念立绘' },
  { id: 'three_view', label: '三视图' },
  { id: 'expressions', label: '表情包' }
] as const;
const STYLES = [
  { id: 'photoreal', label: '写实真人' },
  { id: 'anime_2d', label: '二维动画' },
  { id: 'cgi_3d', label: '三维动画' },
  { id: 'comic', label: '漫画漫剧' }
];

export function CharactersPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.characters(projectId), [projectId]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', role_type: 'guest', persona: '', prompt_prefix: '', seed: Math.floor(Math.random() * 1000000) });
  const [editing, setEditing] = useState<Character | null>(null);

  const [genFor, setGenFor] = useState<Character | null>(null);
  const [genModes, setGenModes] = useState<string[]>(['portrait']);
  const [genStyle, setGenStyle] = useState('photoreal');
  const [genCount, setGenCount] = useState(1);
  const [genExtra, setGenExtra] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [auditionUrl, setAuditionUrl] = useState<string | null>(null);
  const [auditionBusy, setAuditionBusy] = useState<number | null>(null);
  const [voiceEngine, setVoiceEngine] = useState<Record<number, string>>({});

  const create = async () => {
    try {
      await api.createCharacter(projectId, draft);
      notify('角色已创建', 'success');
      setOpen(false);
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  const uploadRef = async (character: Character, file: File, angle: string) => {
    try {
      const asset = await api.uploadAsset(projectId, file, { type: 'image' });
      await api.addRefImage(character.id, asset.id, angle);
      notify('参考图已加入', 'success');
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  const generate = async () => {
    if (!genFor) return;
    setGenBusy(true);
    try {
      const res = await api.generateCharacterArt(genFor.id, { modes: genModes, count: genCount, style: genStyle, extra_prompt: genExtra });
      notify(res.assets.length ? '已生成 ' + res.assets.length + ' 张角色图' : '没有生成结果，请检查本地渲染服务', res.assets.length ? 'success' : 'error');
      setGenFor(null);
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
    finally { setGenBusy(false); }
  };

  const bindVoice = async (c: Character, engine: string) => {
    try {
      await api.bindCharacterVoice(c.id, { engine, voice_id: engine === 'breeze' ? 'breeze_role_' + c.role_type : 'v_host' });
      notify('已绑定音色：' + (engine === 'breeze' ? '本地 Breeze TTS 2' : '云端 edge-tts'), 'success');
      reload();
    } catch (err) { notify(String((err as Error).message), 'error'); }
  };

  const audition = async (c: Character) => {
    setAuditionBusy(c.id);
    setAuditionUrl(null);
    try {
      const res = await api.auditionCharacter(c.id, {});
      setAuditionUrl(res.url);
      notify('试音完成（' + (res.duration_ms / 1000).toFixed(1) + 's）', 'success');
    } catch (err) { notify((err as ApiError).message, 'error'); }
    finally { setAuditionBusy(null); }
  };

  if (loading && !data) return <div className="panel"><Skeleton rows={3} height={110} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">M2 · 角色工坊（概念图 / 三视图 / 表情 / 试音）</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>角色工坊</h1>
          <div className="hint" style={{ marginTop: 4 }}>用本机 SDXL 生成角色概念图，首张自动成为锚定参考图；后续三视图、表情包都会带着它做一致性约束。</div>
        </div>
        <div className="spacer" />
        <Button icon="user" onClick={() => navigate('/characters')}>角色库</Button>
        <Button kind="primary" icon="plus" onClick={() => setOpen(true)}>新建角色</Button>
      </div>

      {(data ?? []).length === 0 ? (
        <Panel><EmptyState title="还没有角色" desc="新建角色后点「生成形象」，本机渲染服务会出概念立绘、三视图和表情包。" /></Panel>
      ) : (
        <div className="grid-2">
          {(data ?? []).map((c) => {
            const refs = c.ref_images ?? [];
            const cover = refs[0];
            return (
              <Panel
                key={c.id}
                title={<div className="row" style={{ gap: 8 }}><Icon name="user" size={15} />{c.name}</div>}
                sub={(ROLE_TYPE_LABEL[c.role_type] ?? '角色') + ' · 第 ' + c.version + ' 版 · 种子 ' + (c.seed ?? '—')}
                right={<Pill tone={c.lock_seed ? 'gold' : null}>{c.lock_seed ? '固定种子' : '随机种子'}</Pill>}
              >
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ width: 132, flex: '0 0 132px' }}>
                    {cover ? (
                      <img src={'/api/v1/assets/' + cover.asset_id + '/raw'} alt={c.name} style={{ width: 132, height: 176, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                    ) : (
                      <div className="thumb" style={{ width: 132, height: 176, display: 'grid', placeItems: 'center' }}><Icon name="user" size={26} /></div>
                    )}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="hint" style={{ minHeight: 32 }}>{c.persona || '还没有人设描述'}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {refs.slice(0, 8).map((r) => (
                        <div key={r.id} className="thumb" style={{ width: 44, height: 56 }} title={ANGLE_LABEL[r.angle] ?? r.angle}>
                          <img src={'/api/v1/assets/' + r.asset_id + '/raw'} alt={r.angle} />
                        </div>
                      ))}
                      <label className="thumb" style={{ width: 44, height: 56, display: 'grid', placeItems: 'center', cursor: 'pointer' }} title="上传参考图">
                        <Icon name="plus" size={14} />
                        <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadRef(c, f, 'front'); }} />
                      </label>
                    </div>
                    <div className="kv">
                      <dt>参考图</dt><dd>{refs.length} 张</dd>
                      <dt>音色</dt><dd>{c.voice ? (String((c.voice as unknown as { provider?: string }).provider ?? '').includes('breeze') ? '本地 Breeze 模型' : '云端 edge') : '未绑定'}</dd>
                      <dt>授权</dt><dd>{c.authorization_file_hash ? '已登记' : '未登记'}</dd>
                    </div>
                  </div>
                </div>

                <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                  <Button size="small" kind="primary" icon="sparkle" onClick={() => { setGenFor(c); setGenStyle('photoreal'); setGenModes(['portrait']); setGenCount(1); setGenExtra(''); }}>生成形象</Button>
                  <Button size="small" icon="wave" onClick={() => audition(c)} disabled={auditionBusy === c.id}>{auditionBusy === c.id ? '试音中…' : '试音'}</Button>
                  <select className="select" style={{ height: 28, fontSize: 12 }} value={voiceEngine[c.id] ?? (c.voice && String((c.voice as unknown as { provider?: string }).provider ?? '').includes('breeze') ? 'breeze' : 'edge')} onChange={(e) => { setVoiceEngine({ ...voiceEngine, [c.id]: e.target.value }); void bindVoice(c, e.target.value); }}>
                    <option value="breeze">本地 Breeze 音色</option>
                    <option value="edge">云端 edge 音色</option>
                  </select>
                  <Button size="small" icon="edit" onClick={() => setEditing(c)}>编辑</Button>
                  <Button size="small" icon="refresh" onClick={async () => { await api.newCharacterVersion(c.id); notify('已创建新版本（历史镜头仍指向旧版本）', 'success'); reload(); }}>新版本</Button>
                </div>
                {auditionUrl && (
                  <div style={{ marginTop: 8 }}>
                    <audio key={auditionUrl} src={auditionUrl} controls autoPlay style={{ width: '100%' }} />
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      <Modal open={open} title="新建角色" onClose={() => setOpen(false)} footer={<><Button kind="ghost" onClick={() => setOpen(false)}>取消</Button><Button kind="primary" onClick={create}>创建</Button></>}>
        <div className="grid-2">
          <Field label="角色名"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="角色类型">
            <select className="select" value={draft.role_type} onChange={(e) => setDraft({ ...draft, role_type: e.target.value })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        <Field label="人设"><textarea className="textarea" rows={3} value={draft.persona} onChange={(e) => setDraft({ ...draft, persona: e.target.value })} placeholder="例如：三十二岁的访谈主持人，语速慢、爱追问，笑起来有酒窝" /></Field>
        <Field label="形象提示词前缀"><textarea className="textarea" rows={2} value={draft.prompt_prefix} onChange={(e) => setDraft({ ...draft, prompt_prefix: e.target.value })} placeholder="例如：35 岁男性主持人，深色西装，短发，暖色棚灯" /></Field>
        <Field label="固定种子（同角色固定外貌）"><input className="input" type="number" value={draft.seed} onChange={(e) => setDraft({ ...draft, seed: Number(e.target.value) })} /></Field>
      </Modal>

      <Modal open={genFor != null} title={'生成角色形象 · ' + (genFor?.name ?? '')} onClose={() => (genBusy ? null : setGenFor(null))} footer={<><Button kind="ghost" onClick={() => setGenFor(null)} disabled={genBusy}>关闭</Button><Button kind="primary" onClick={generate} disabled={genBusy}>{genBusy ? '生成中…' : '开始生成'}</Button></>}>
        {genFor && (
          <>
            <Field label="画什么">
              <div className="chips">
                {ART_MODES.map((m) => (
                  <Chip key={m.id} on={genModes.includes(m.id)} onClick={() => setGenModes((prev) => prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id])}>{m.label}</Chip>
                ))}
              </div>
            </Field>
            <div className="grid-2">
              <Field label="风格">
                <select className="select" value={genStyle} onChange={(e) => setGenStyle(e.target.value)}>
                  {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="每类张数">
                <div className="chips">
                  {[1, 2, 3, 4].map((n) => <Chip key={n} on={genCount === n} onClick={() => setGenCount(n)}>{n} 张</Chip>)}
                </div>
              </Field>
            </div>
            <Field label="补充描述（可选）"><textarea className="textarea" rows={2} value={genExtra} onChange={(e) => setGenExtra(e.target.value)} placeholder="例如：加一副细框眼镜，浅灰背景" /></Field>
            <div className="hint">生成走本机渲染服务，单张约 20–60 秒；已有参考图时会自动启用角色一致性约束（IP-Adapter）。</div>
          </>
        )}
      </Modal>

      <Modal open={editing != null} title={'编辑角色 · ' + (editing?.name ?? '')} onClose={() => setEditing(null)} footer={<Button kind="primary" onClick={async () => {
        if (!editing) return;
        try {
          await api.patchCharacter(editing.id, { persona: editing.persona, prompt_prefix: editing.prompt_prefix, lock_seed: editing.lock_seed, seed: editing.seed });
          notify('已保存角色', 'success');
          setEditing(null);
          reload();
        } catch (err) { notify((err as ApiError).message, 'error'); }
      }}>保存</Button>}>
        {editing && (
          <>
            <Field label="人设"><textarea className="textarea" rows={3} value={editing.persona ?? ''} onChange={(e) => setEditing({ ...editing, persona: e.target.value })} /></Field>
            <Field label="形象提示词前缀"><textarea className="textarea" rows={2} value={editing.prompt_prefix ?? ''} onChange={(e) => setEditing({ ...editing, prompt_prefix: e.target.value })} /></Field>
            <Field label="固定种子"><input className="input" type="number" value={editing.seed ?? 0} onChange={(e) => setEditing({ ...editing, seed: Number(e.target.value) })} /></Field>
            <div className="hint">当前风格：{styleName((editing as unknown as { visual_style?: string }).visual_style ?? 'photoreal')}</div>
          </>
        )}
      </Modal>
    </>
  );
}
