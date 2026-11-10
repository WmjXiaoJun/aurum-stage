import React, { useState } from 'react';
import { Icon, type IconName } from './Icon';
import { navigate } from '../lib/router';
import { useApp, useEvents } from '../lib/store';
import { Pill, Toggle } from './ui';
import type { Project } from '../lib/types';

interface NavItem { key: string; label: string; icon: IconName }

const GLOBAL_NAV: NavItem[] = [
  { key: '/projects', label: '项目库', icon: 'dashboard' },
  { key: '/characters', label: '角色库', icon: 'user' },
  { key: '/templates', label: '模板库', icon: 'template' },
  { key: '/models', label: '模型设置', icon: 'model' },
  { key: '/nodes', label: 'GPU 节点', icon: 'node' },
  { key: '/settings', label: '系统设置', icon: 'settings' }
];

const PROJECT_NAV: NavItem[] = [
  { key: 'overview', label: '项目总览', icon: 'dashboard' },
  { key: 'script', label: '台本', icon: 'script' },
  { key: 'storyboard', label: '分镜', icon: 'storyboard' },
  { key: 'timeline', label: '时间轴', icon: 'timeline' },
  { key: 'engineering', label: '工程文件', icon: 'script' },
  { key: 'skills', label: '剧本工坊', icon: 'sparkle' },
  { key: 'characters', label: '角色', icon: 'user' },
  { key: 'tasks', label: '任务', icon: 'task' },
  { key: 'agent', label: '智能体', icon: 'agent' },
  { key: 'qa', label: '质检', icon: 'qa' },
  { key: 'export', label: '成片导出', icon: 'export' }
];

export function Layout({ children, project, active, onPrivacyChange }: {
  children: React.ReactNode;
  project?: Project | null;
  active: string;
  onPrivacyChange?: (v: boolean) => void;
}): React.ReactElement {
  const { meta, wsOpen } = useApp();
  const [composeBanner, setComposeBanner] = useState<{ url: string; duration: number } | null>(null);
  useEvents(project?.id ?? null, (event) => {
    if (event.type === 'compose.success') {
      const payload = event.payload as { video_url?: string; duration_sec?: number };
      setComposeBanner({ url: String(payload?.video_url ?? ''), duration: Number(payload?.duration_sec ?? 0) });
    }
  });
  const ffmpegOn = Boolean((meta?.runtime as Record<string, unknown> | undefined)?.ffmpeg);
  const crumbs = project ? ['项目', project.name, PROJECT_NAV.find((n) => n.key === active)?.label ?? ''] : [GLOBAL_NAV.find((n) => n.key === active)?.label ?? '工作台'];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">玄</div>
          <div>
            <div className="brand-name">玄枢・AURUM</div>
            <div className="brand-sub">AI 微综艺智造中枢</div>
          </div>
        </div>

        <div className="nav-group">工作台</div>
        {GLOBAL_NAV.slice(0, 1).map((item) => (
          <div key={item.key} className={'nav-item ' + (active === item.key ? 'active' : '')} onClick={() => navigate(item.key)}>
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </div>
        ))}

        {project && (
          <>
            <div className="nav-group">当前项目</div>
            {PROJECT_NAV.map((item) => (
              <div
                key={item.key}
                className={'nav-item ' + (active === item.key ? 'active' : '')}
                onClick={() => navigate('/project/' + project.id + '/' + item.key)}
              >
                <Icon name={item.icon} size={16} />
                <span>{item.label}</span>
              </div>
            ))}
          </>
        )}

        <div className="nav-group">平台</div>
        {GLOBAL_NAV.slice(1).map((item) => (
          <div key={item.key} className={'nav-item ' + (active === item.key ? 'active' : '')} onClick={() => navigate(item.key)}>
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </div>
        ))}

        <div className="spacer" />
        <div style={{ padding: '10px 10px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <Pill tone={ffmpegOn ? 'up' : 'warn'} dot>{ffmpegOn ? '合成引擎就绪' : '合成引擎缺失'}</Pill>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Pill tone={wsOpen ? 'jade' : null} dot>{wsOpen ? '实时通道在线' : '实时通道离线'}</Pill>
          </div>
          <div className="hint" style={{ fontSize: 10.5 }}>{meta?.product.version ? meta.product.version + ' 版 · ' + meta.product.design : '连接中…'}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 && <Icon name="chevron" size={12} />}
                {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
              </React.Fragment>
            ))}
          </div>
          <div className="topbar-right">
            {project && (
              <>
                <Pill tone="gold">{(project.aspect_ratio === '9:16' ? '竖屏' : project.aspect_ratio === '16:9' ? '横屏' : project.aspect_ratio === '1:1' ? '方形' : '社媒竖版') + ' · ' + project.fps + ' 帧'}</Pill>
                <div className="row" style={{ gap: 6 }}>
                  <Toggle on={project.privacy_mode} onChange={(v) => onPrivacyChange?.(v)} label="隐私模式" />
                </div>
              </>
            )}
            <button type="button" className="btn small" onClick={() => navigate('/projects')}>
              <Icon name="dashboard" size={13} /> 项目列表
            </button>
          </div>
        </header>
        <main className="content">
          {composeBanner && (
            <div style={{ position: 'sticky', top: 0, zIndex: 20, marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(90deg, rgba(212,184,126,.18), rgba(20,26,35,.92))', border: '1px solid var(--gold)', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ color: 'var(--gold-light)', fontWeight: 600 }}>成片已生成</span>
              <span className="hint">{composeBanner.duration ? composeBanner.duration + ' 秒' : ''} · 自动合成完成，已登记到导出记录</span>
              <span style={{ flex: 1 }} />
              {composeBanner.url && <a className="btn small" href={composeBanner.url} target="_blank" rel="noreferrer">播放</a>}
              {composeBanner.url && <a className="btn small" href={composeBanner.url} download>下载</a>}
              <button type="button" className="btn small" onClick={() => setComposeBanner(null)}>关闭</button>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
