import React from 'react';
import { useAsync, useMeta } from '../lib/store';
import { Panel, Pill, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { humanizeTech } from '../lib/zh';

export function SettingsPage(): React.ReactElement {
  const m = useMeta();
  const { data: runtime, loading } = useAsync(() => api.schedulerStats(), []);
  const { data: health } = useAsync(() => api.health(), []);

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">系统设置 · 运行态</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>环境与规范</h1>
        </div>
        <div className="spacer" />
        <Pill tone={health?.ffmpeg ? 'up' : 'warn'} dot>{health?.ffmpeg ? 'FFmpeg 就绪' : 'FFmpeg 缺失'}</Pill>
        <Pill tone="gold">{m?.product.name} v{m?.product.version}</Pill>
      </div>

      <div className="split">
        <Panel title="运行态" sub="合成引擎 / 本地渲染模式 / 云端账号池">
          {loading ? <Skeleton rows={2} height={40} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <Pill tone={health?.ffmpeg ? 'up' : 'warn'} dot>合成引擎 {health?.ffmpeg ? '正常' : '缺失'}</Pill>
                <Pill tone={((runtime ?? {}) as { simulate?: { comfy?: boolean } }).simulate?.comfy ? 'warn' : 'up'} dot>
                  本地渲染 {((runtime ?? {}) as { simulate?: { comfy?: boolean } }).simulate?.comfy ? '模拟模式' : '真实直连'}
                </Pill>
                <Pill tone="gold">云端视频 {m?.providers?.muse?.api_key_set ? '已配置密钥' : '未配置密钥'}</Pill>
                <Pill tone={m?.providers?.text?.some((x) => x.enabled) ? 'up' : null} dot>
                  文本模型 {m?.providers?.text?.filter((x) => x.enabled).length ?? 0} 个已启用
                </Pill>
              </div>
              <div className="kv">
                <dt>中台版本</dt><dd>{m?.product.version} 版 · {m?.product.design}</dd>
                <dt>云端视频地址</dt><dd>{m?.providers?.muse?.base_url}</dd>
                <dt>本地渲染地址</dt><dd>{m?.providers?.comfy?.base_url}</dd>
                <dt>调度状态</dt><dd>{runtime ? '调度器运行中' : '调度器未启动'}</dd>
              </div>
            </div>
          )}
        </Panel>
        <Panel title="设计规范" sub="第二十五章「午夜黑金导播大厅」定版">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {[['近黑底', '#0A0C0F'], ['面板底', '#131821'], ['鎏金', '#D4B87E'], ['浅金', '#E8D6A8'], ['青玉', '#46A09B'], ['正向', '#46AF82'], ['警示', '#D99E3E'], ['异常', '#E15B50']].map(([name, hex]) => (
                <span key={name} className="tag" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <i style={{ width: 10, height: 10, borderRadius: 3, background: hex, display: 'inline-block', border: '1px solid rgba(255,255,255,.2)' }} />
                  <span className="mono">{name}</span>
                </span>
              ))}
            </div>
            <div className="kv">
              <dt>字体</dt><dd>Microsoft YaHei UI / Bebas Neue / Cascadia Mono</dd>
              <dt>圆角</dt><dd>control 6 · card 10 · shell 18 · pill 999</dd>
              <dt>网格</dt><dd>8pt（4/6/8/12/14/16/19/24/28/32）</dd>
              <dt>引擎编码</dt><dd>云端=鎏金+cloud · 本地=青玉+monitor（颜色+图标双通道）</dd>
              <dt>四态</dt><dd>有数据 / 空 / 加载骨架 / 异常重试</dd>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="情绪词典" sub="只写可表演的韵律，不写抽象词（第七章）">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th style={{ width: 140 }}>情绪</th><th style={{ width: 90 }}>语速</th><th>情绪指令（直接喂 TTS）</th><th style={{ width: 160 }}>适用</th></tr></thead>
            <tbody>
              {(m?.emotions ?? []).map((e) => (
                <tr key={e.id}>
                  <td><span style={{ color: 'var(--text-1)' }}>{e.label}</span><div className="hint">{e.hint}</div></td>
                  <td className="mono">{e.speed}</td>
                  <td style={{ color: 'var(--text-1)' }}>{e.instruction}</td>
                  <td className="hint">{e.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="常量" sub="前后端同源，禁止组件内硬编码">
        <div className="kv">
          <dt>段时长上限</dt><dd>{m?.constants.segment_cap_sec} 秒（{Math.floor((m?.constants.segment_cap_sec ?? 300) / 60)} 分钟）</dd>
          <dt>预警线</dt><dd>{m?.constants.segment_near_sec} 秒</dd>
          <dt>综艺类型</dt><dd>{(m?.constants.variety_types ?? []).map((v) => v.label).join(' / ')}</dd>
          <dt>机位</dt><dd>{(m?.constants.cameras ?? []).map((c) => c.label).join(' / ')}</dd>
          <dt>引擎</dt><dd>{(m?.constants.engines ?? []).map((e) => e.label).join(' / ')}</dd>
        </div>
      </Panel>
    </>
  );
}
