import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Field, Modal, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { dateTime } from '../lib/format';
import type { LlmProvider } from '../lib/types';
import { PROVIDER_LABEL, modelLabel, healthLabel } from '../lib/zh';

const PROTOCOLS = [
  { id: 'openai', label: '通用兼容协议' },
  { id: 'google', label: '谷歌协议' },
  { id: 'ollama', label: '本地离线协议' },
  { id: 'custom-openai', label: '自定义网关' }
];

export function ModelsPage(): React.ReactElement {
  const { notify } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.llmProviders(), []);
  const { data: usage } = useAsync(() => api.llmUsage(), []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LlmProvider | null>(null);
  const [form, setForm] = useState({ provider_key: '', display_name: '', protocol: 'openai', base_url: '', api_keys: '', is_default: false });
  const { data: muse, reload: reloadMuse } = useAsync(() => api.museProvider(), []);
  const [museDraft, setMuseDraft] = useState({ api_key: '', base_url: '', model: '', resolution: '' });
  const [museBusy, setMuseBusy] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState<Record<number, string>>({});

  const saveMuse = async () => {
    setMuseBusy('save');
    try {
      await api.saveMuseProvider({
        api_key: museDraft.api_key || undefined,
        base_url: museDraft.base_url || undefined,
        model: museDraft.model || undefined,
        resolution: museDraft.resolution || undefined
      });
      notify('APIMart 云端视频配置已保存', 'success');
      setMuseDraft({ api_key: '', base_url: '', model: '', resolution: '' });
      reloadMuse();
    } catch (err) { notify((err as ApiError).message, 'error'); } finally { setMuseBusy(null); }
  };

  const testMuse = async () => {
    setMuseBusy('test');
    try {
      const res = await api.museHealth();
      notify(res.ok ? 'APIMart 连通性正常：' + res.detail : 'APIMart 未连通：' + res.detail, res.ok ? 'success' : 'error');
      reloadMuse();
    } catch (err) { notify((err as ApiError).message, 'error'); } finally { setMuseBusy(null); }
  };

  const saveProviderKey = async (p: LlmProvider) => {
    const raw = (keyDraft[p.id] ?? '').trim();
    if (!raw) { notify('先粘贴 Key', 'error'); return; }
    try {
      const keys = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      await api.patchLlmProvider(p.id, { api_keys: keys, enabled: true });
      notify(p.display_name + ' 的 Key 已保存（仅中台可见）', 'success');
      setKeyDraft((prev) => ({ ...prev, [p.id]: '' }));
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  const openCreate = () => {
    setForm({ provider_key: '', display_name: '', protocol: 'openai', base_url: 'https://api.openai.com/v1', api_keys: '', is_default: false });
    setOpen(true);
  };

  const submit = async () => {
    try {
      const payload = {
        provider_key: form.provider_key,
        display_name: form.display_name || form.provider_key,
        protocol: form.protocol,
        base_url: form.base_url,
        api_keys: form.api_keys.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        is_default: form.is_default
      };
      if (editing) await api.patchLlmProvider(editing.id, payload);
      else await api.upsertLlmProvider(payload);
      notify('供应商已保存', 'success');
      setOpen(false);
      setEditing(null);
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  if (loading && !data) return <div className="panel"><Skeleton rows={3} height={110} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">26.4 · 多 LLM 适配层（TextBackend）</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>供应商与模型</h1>
          <div className="hint" style={{ marginTop: 4 }}>对话 / 结构化输出 / 视觉理解 / 向量四类能力统一接入；多密钥轮换 + 健康度故障切换；未配置时自动回退本地规则引擎。</div>
        </div>
        <div className="spacer" />
        <Button kind="primary" icon="plus" onClick={openCreate}>新增供应商</Button>
      </div>

      <Panel
        title="云端视频服务（云端通道）"
        sub={muse ? '视频模型 ' + modelLabel(muse.model) + ' · 清晰度 720 · 访问密钥' + (muse.api_key_set ? '已配置' : '未配置') : '加载中…'}
        right={<div className="row" style={{ gap: 8 }}>
          <Pill tone={muse?.api_key_set ? 'up' : 'warn'} dot>{muse?.api_key_set ? '真实调用' : '代理片模式'}</Pill>
          <Button size="small" icon="qa" onClick={testMuse} disabled={museBusy === 'test'}>{museBusy === 'test' ? '测试中…' : '测试连通'}</Button>
          <Button size="small" kind="primary" icon="check" onClick={saveMuse} disabled={museBusy === 'save'}>{museBusy === 'save' ? '保存中…' : '保存配置'}</Button>
        </div>}
      >
        <div className="grid-2">
          <Field label="服务地址"><input className="input" value={museDraft.base_url || muse?.base_url || ''} onChange={(e) => setMuseDraft({ ...museDraft, base_url: e.target.value })} /></Field>
          <Field label="访问密钥（仅存中台，不下发前端）">
            <input className="input" type="password" placeholder={muse?.api_key_set ? '已配置（' + muse.api_key_masked + '），留空则不修改' : '粘贴访问密钥'} value={museDraft.api_key} onChange={(e) => setMuseDraft({ ...museDraft, api_key: e.target.value })} />
          </Field>
          <Field label="视频模型">
            <select className="select" value={museDraft.model || muse?.model || ''} onChange={(e) => setMuseDraft({ ...museDraft, model: e.target.value })}>
              {(muse?.models ?? ['muse-video-ext']).map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
            </select>
          </Field>
          <Field label="输出清晰度">
            <select className="select" value={museDraft.resolution || muse?.resolution || ''} onChange={(e) => setMuseDraft({ ...museDraft, resolution: e.target.value })}>
              <option value="720p">标清 720（当前模型仅支持该档）</option>
            </select>
          </Field>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          调用方式：提交生成任务 → 轮询任务状态（进度实时回传界面）→ 成片自动下载回存素材库。
          未配置访问密钥时，云端镜头会生成「导播代理片」并在素材备注里注明原因，不会伪装成真实产物。
        </div>
      </Panel>

      <div className="grid-2">
        {(data ?? []).map((p) => (
          <Panel
            key={p.id}
            title={<div className="row" style={{ gap: 8 }}><Icon name="model" size={15} />{PROVIDER_LABEL[p.provider_key] ?? p.display_name}</div>}
            sub={(p.protocol === 'openai' ? '通用兼容协议' : p.protocol === 'google' ? '谷歌协议' : p.protocol === 'ollama' ? '本地离线协议' : '自定义网关') + ' · ' + (p.enabled ? '已启用' : '已停用')}
            right={<div className="row" style={{ gap: 6 }}>{p.is_default && <Pill tone="gold">默认</Pill>}<Pill tone={p.enabled ? 'up' : null} dot>{p.enabled ? '启用' : '停用'}</Pill></div>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="kv">
                <dt>状态</dt><dd>{healthLabel(p.health)}{p.last_check ? ' · ' + dateTime(p.last_check) : ''}</dd>
                <dt>密钥</dt><dd>{p.api_keys.length} 个（仅中台持有）</dd>
                <dt>模型</dt><dd>{p.models.length} 个</dd>
              </div>
              <div className="chips">
                {p.models.slice(0, 6).map((m) => <span key={m.model_id} className="tag">{modelLabel(m.model_id)}</span>)}
                {p.models.length === 0 && <span className="hint">点「拉取模型」自动获取可用模型</span>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input mono"
                  style={{ flex: 1, height: 28, fontSize: 11.5 }}
                  type="password"
                  placeholder={p.api_keys.length ? '密钥已配置（' + p.api_keys.length + ' 个），粘贴可覆盖' : '粘贴访问密钥'}
                  value={keyDraft[p.id] ?? ''}
                  onChange={(e) => setKeyDraft({ ...keyDraft, [p.id]: e.target.value })}
                />
                <Button size="small" icon="check" onClick={() => saveProviderKey(p)}>保存密钥</Button>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Button size="small" icon="refresh" onClick={async () => { try { const r = await api.discoverModels(p.id); notify('已获取 ' + r.count + ' 个模型', 'success'); reload(); } catch (err) { notify((err as ApiError).message, 'error'); } }}>拉取模型</Button>
                <Button size="small" icon="qa" onClick={async () => { try { const r = await api.patchLlmProvider(p.id, { enabled: !p.enabled }); void r; notify('已切换启用状态', 'success'); reload(); } catch (err) { notify((err as ApiError).message, 'error'); } }}>{p.enabled ? '停用' : '启用'}</Button>
                <Button size="small" icon="edit" onClick={() => { setEditing(p); setForm({ provider_key: p.provider_key, display_name: p.display_name, protocol: p.protocol, base_url: p.base_url, api_keys: p.api_keys.join('\n'), is_default: p.is_default }); setOpen(true); }}>编辑</Button>
                <div className="spacer" />
                {!p.is_default && <Button size="small" onClick={async () => { await api.patchLlmProvider(p.id, { is_default: true }); notify('已设为默认供应商', 'success'); reload(); }}>设为默认</Button>}
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <Panel noBody title="用量统计（近 7 天）" sub="按供应商 / 模型聚合，失败调用也计入便于排查">
        {(usage ?? []).length === 0 ? <EmptyState title="暂无调用记录" desc="运行一次智能体流水线后这里会有数据。" /> : (
          <table className="table">
            <thead><tr><th>供应商</th><th>模型</th><th style={{ width: 90 }}>调用</th><th style={{ width: 120 }}>输入词元</th><th style={{ width: 120 }}>输出词元</th><th style={{ width: 120 }}>平均延迟</th></tr></thead>
            <tbody>
              {(usage ?? []).map((u, i) => (
                <tr key={i}>
                  <td>{PROVIDER_LABEL[String(u.provider)] ?? '文本模型'}</td>
                  <td>{modelLabel(String(u.model))}</td>
                  <td className="mono">{String(u.calls)}</td>
                  <td className="mono">{String(u.tokens_in ?? 0)}</td>
                  <td className="mono">{String(u.tokens_out ?? 0)}</td>
                  <td className="mono">{String(Math.round(Number(u.avg_latency ?? 0)))}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Modal
        open={open}
        title={editing ? '编辑供应商 · ' + editing.provider_key : '新增供应商'}
        onClose={() => { setOpen(false); setEditing(null); }}
        footer={<><Button kind="ghost" onClick={() => { setOpen(false); setEditing(null); }}>取消</Button><Button kind="primary" onClick={submit}>保存</Button></>}
      >
        <div className="grid-2">
          <Field label="供应商标识（仅内部使用）"><input className="input" value={form.provider_key} onChange={(e) => setForm({ ...form, provider_key: e.target.value })} placeholder="自定义标识" disabled={Boolean(editing)} /></Field>
          <Field label="显示名称"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
        </div>
        <Field label="接入协议">
          <div className="chips">
            {PROTOCOLS.map((p) => <Chip key={p.id} on={form.protocol === p.id} onClick={() => setForm({ ...form, protocol: p.id })}>{p.label}</Chip>)}
          </div>
        </Field>
        <Field label="服务地址" hint="填写兼容协议的接口地址">
          <input className="input" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
        </Field>
        <Field label="访问密钥（一行一个，多密钥自动轮换）">
          <textarea className="textarea" rows={3} value={form.api_keys} onChange={(e) => setForm({ ...form, api_keys: e.target.value })} placeholder="粘贴访问密钥" />
        </Field>
        <div className="row">
          <Chip on={form.is_default} onClick={() => setForm({ ...form, is_default: !form.is_default })}>设为全局默认</Chip>
          <span className="hint">项目级覆盖优先级高于全局默认</span>
        </div>
      </Modal>
    </>
  );
}
