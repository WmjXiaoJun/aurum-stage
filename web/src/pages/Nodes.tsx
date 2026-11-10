import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Field, Modal, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { relative } from '../lib/format';
import type { ComfyProbeReport } from '../lib/types';
import { templateLabel, nodeName, tagName } from '../lib/zh';

export function NodesPage(): React.ReactElement {
  const { notify, meta } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.nodes(), []);
  const { data: stats } = useAsync(() => api.schedulerStats(), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ node_key: '', base_url: '', engine_tags: 'h3,lipsync', vram_total_gb: 24, models_loaded: 'minimax_h3,ipadapter_sdxl,musetalk' });
  const [probeUrl, setProbeUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ComfyProbeReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [testImages, setTestImages] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!probeUrl && meta?.providers?.comfy?.base_url) setProbeUrl(meta.providers.comfy.base_url);
  }, [meta, probeUrl]);

  const runProbe = async () => {
    setProbing(true);
    setProbe(null);
    try {
      const report = await api.comfyProbe({ base_url: probeUrl || undefined });
      setProbe(report);
      notify('探测完成：' + report.checkpoints.length + ' 个 checkpoint，已生成模板', 'success');
      reload();
    } catch (err) {
      const e = err as ApiError;
      notify(e.code + ' · ' + e.message, 'error');
    } finally { setProbing(false); }
  };

  const runTest = async () => {
    setTesting(true);
    setTestImages([]);
    setTestStatus('提交中…');
    try {
      const res = await api.comfyTestRun({ template_key: probe?.registered.image_template ?? 'comfy_local_image', steps: 8, width: 512, height: 512 });
      setTestStatus('已提交，等待 ComfyUI 出图…');
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const hist = await api.comfyHistory(res.prompt_id);
        if (hist.status === 'done' && hist.images) {
          setTestImages(hist.images);
          setTestStatus('完成：' + hist.images.length + ' 张');
          notify('本地 ComfyUI 试跑成功', 'success');
          break;
        }
        setTestStatus('已提交，等待 ComfyUI 出图…' + (i + 1) * 1.5 + 's');
      }
    } catch (err) {
      const e = err as ApiError;
      setTestStatus('失败：' + e.message);
      notify(e.code + ' · ' + e.message, 'error');
    } finally { setTesting(false); }
  };

  const create = async () => {
    try {
      await api.createNode({
        node_key: form.node_key,
        base_url: form.base_url,
        engine_tags: form.engine_tags.split(',').map((s) => s.trim()).filter(Boolean),
        vram_total_gb: Number(form.vram_total_gb),
        vram_free_gb: Number(form.vram_total_gb),
        models_loaded: form.models_loaded.split(',').map((s) => s.trim()).filter(Boolean)
      });
      notify('节点已登记（Agent 启动后开始心跳）', 'success');
      setOpen(false);
      reload();
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  if (loading && !data) return <div className="panel"><Skeleton rows={3} height={96} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">10.4 · GPU 节点与选点</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>算力节点</h1>
          <div className="hint" style={{ marginTop: 4 }}>选点规则：以空闲显存为主、队列长度为辅；本地生成单机串行；心跳超过 30 秒未到即判离线并回收任务。</div>
        </div>
        <div className="spacer" />
        <Button icon="refresh" onClick={reload}>刷新</Button>
        <Button kind="primary" icon="plus" onClick={() => setOpen(true)}>登记节点</Button>
      </div>

      <Panel
        title="本地渲染服务探测与模板生成"
        sub="读取你机器上已安装的模型与节点，自动生成可直接使用的工作流模板"
        right={<div className="row" style={{ gap: 8 }}>
          <Pill tone={probe?.reachable ? 'up' : null} dot>{probe?.reachable ? '已连通' : '未探测'}</Pill>
          <Button size="small" kind="primary" icon="search" onClick={runProbe} disabled={probing}>{probing ? '探测中…' : '探测本地渲染服务'}</Button>
          <Button size="small" icon="play" onClick={runTest} disabled={testing || !probe?.reachable}>{testing ? '试跑中…' : '试跑一帧'}</Button>
        </div>}
      >
        <div className="row" style={{ gap: 10 }}>
          <span className="hint" style={{ flex: '0 0 auto' }}>本地渲染服务地址</span>
          <input className="input" style={{ flex: 1 }} value={probeUrl} onChange={(e) => setProbeUrl(e.target.value)} placeholder="本机默认端口 8188" />
          <span className="hint">默认端口 8188，可在系统设置里修改</span>
        </div>

        {probe && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            <div className="kv">
              <dt>可用模型</dt><dd>{probe.checkpoints.length} 个已识别</dd>
              <dt>采样算法</dt><dd>{probe.samplers.length} 种可用</dd>
              <dt>已生成模板</dt><dd>{probe.registered.image_template ? templateLabel(probe.registered.image_template) : '—'}{probe.registered.video_template ? ' + ' + templateLabel(probe.registered.video_template) : ''}{probe.registered.node_key ? ' · 已登记本地节点' : ''}</dd>
            </div>
            <div className="chips">
              <Pill tone={probe.features.ipadapter ? 'up' : null}>角色锚定 {probe.features.ipadapter ? '可用' : '未安装'}</Pill>
              <Pill tone={probe.features.svd ? 'up' : null}>首帧驱动视频 {probe.features.svd ? '可用' : '未安装'}</Pill>
              <Pill tone={probe.features.wan ? 'up' : null}>万相视频 {probe.features.wan ? '可用' : '—'}</Pill>
              <Pill tone={probe.features.hunyuan ? 'up' : null}>混元视频 {probe.features.hunyuan ? '可用' : '—'}</Pill>
              <Pill tone={probe.features.video_combine ? 'gold' : null}>视频直出 {probe.features.video_combine ? '可用' : '—'}</Pill>
            </div>
            {probe.notes.length > 0 && <div className="warn-block">{probe.notes.map((n) => <div key={n}>· {n}</div>)}</div>}
            <div className="hint">模板已写入「模板库」：{templateLabel(probe.registered.image_template)}（静帧 / 角色锚定）{probe.registered.video_template ? '、' + templateLabel(probe.registered.video_template) + '（首帧驱动视频）' : ''}。之后镜头会带着这套工作流去本地渲染。</div>
          </div>
        )}

        {testStatus && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="hint">{testStatus}</div>
            {testImages.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {testImages.map((src) => <img key={src} src={src} alt="comfy test" style={{ width: 200, borderRadius: 8, border: '1px solid var(--border)' }} />)}
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className="grid-3">
        {(data ?? []).map((n) => {
          const tags = (n.engine_tags as string[]) ?? [];
          const models = (n.models_loaded as string[]) ?? [];
          return (
            <Panel key={String(n.id)} title={<div className="row" style={{ gap: 8 }}><Icon name="node" size={15} /><span>{nodeName(String(n.node_key))}</span></div>} sub={'本地算力节点'} right={<Pill tone={n.status === 'online' ? 'up' : 'down'} dot>{n.status === 'online' ? '在线' : '离线'}</Pill>}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="chips">{tags.map((t) => <span key={t} className="tag">{tagName(t)}</span>)}</div>
                <div className="kv">
                  <dt>显存</dt><dd>{Number(n.vram_free_gb ?? 0)} / {Number(n.vram_total_gb ?? 0)} 吉字节</dd>
                  <dt>队列</dt><dd className="mono">{Number(n.queue_len ?? 0)}</dd>
                  <dt>心跳</dt><dd>{n.last_heartbeat ? relative(String(n.last_heartbeat)) : '—'}</dd>
                  <dt>模型</dt><dd style={{ fontSize: 11.5 }}>{models.length > 0 ? models.length + ' 个已加载' : '—'}</dd>
                </div>
                <div className="meter"><i style={{ width: (Number(n.vram_total_gb ?? 1) > 0 ? (Number(n.vram_free_gb ?? 0) / Number(n.vram_total_gb ?? 1)) * 100 : 0) + '%' }} /></div>
              </div>
            </Panel>
          );
        })}
        {(data ?? []).length === 0 && <Panel><EmptyState title="还没有 GPU 节点" desc="在 GPU 机器上启动 services/agent 即可自动注册，也可以在这里手动登记便于查看。" /></Panel>}
      </div>

      <Panel title="调度器运行态" sub="队列积压 / 运行中任务 / 本地渲染模式">
        {(() => {
          const s = (stats ?? {}) as { running?: unknown[]; simulate?: { comfy?: boolean; muse_failure_rate?: number } };
          return (
            <div className="row wrap" style={{ gap: 10 }}>
              <Pill tone="gold">执行中 {s.running?.length ?? 0} 个</Pill>
              <Pill tone={s.simulate?.comfy ? 'warn' : 'up'} dot>本地渲染 {s.simulate?.comfy ? '模拟模式' : '真实直连'}</Pill>
              <Pill>云端失败演练比例 {Math.round((s.simulate?.muse_failure_rate ?? 0) * 100)}%</Pill>
            </div>
          );
        })()}
      </Panel>

      <Modal open={open} title="登记 GPU 节点" onClose={() => setOpen(false)} footer={<><Button kind="ghost" onClick={() => setOpen(false)}>取消</Button><Button kind="primary" onClick={create}>登记</Button></>}>
        <div className="grid-2">
          <Field label="节点名称"><input className="input" value={form.node_key} onChange={(e) => setForm({ ...form, node_key: e.target.value })} placeholder="例如：一号节点" /></Field>
          <Field label="渲染服务地址"><input className="input" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="内网地址与端口" /></Field>
        </div>
        <Field label="能力标签（用逗号分隔）"><input className="input" value={form.engine_tags} onChange={(e) => setForm({ ...form, engine_tags: e.target.value })} placeholder="本地生成, 口型对齐" /></Field>
        <Field label="显存总量（吉字节）"><input className="input" type="number" value={form.vram_total_gb} onChange={(e) => setForm({ ...e.target.value ? { ...form, vram_total_gb: Number(e.target.value) } : form })} /></Field>
      </Modal>
    </>
  );
}
