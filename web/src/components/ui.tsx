import React, { useEffect } from 'react';
import { Icon, type IconName } from './Icon';
import { useApp } from '../lib/store';
import type { Engine, ShotStatus, TaskStatus } from '../lib/types';

export function Panel({ title, sub, right, children, bodyStyle, noBody }: {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  bodyStyle?: React.CSSProperties;
  noBody?: boolean;
}): React.ReactElement {
  return (
    <section className="panel">
      {(title || right) && (
        <header className="panel-head">
          <div>
            <div className="panel-title">{title}</div>
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          <div className="spacer" />
          {right}
        </header>
      )}
      {noBody ? children : <div className="panel-body" style={bodyStyle}>{children}</div>}
    </section>
  );
}

export function Button({ children, kind = 'default', size, icon, onClick, disabled, title, type = 'button' }: {
  children?: React.ReactNode;
  kind?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'small';
  icon?: IconName;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}): React.ReactElement {
  const cls = ['btn', kind !== 'default' ? kind : '', size ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Icon name={icon} size={size === 'small' ? 13 : 14} />}
      {children}
    </button>
  );
}

export function Chip({ children, on, onClick, tone, icon }: {
  children: React.ReactNode;
  on?: boolean;
  onClick?: () => void;
  tone?: 'gold' | 'jade';
  icon?: IconName;
}): React.ReactElement {
  return (
    <button type="button" className={['chip', on ? 'on' : '', tone === 'jade' ? 'jade' : ''].filter(Boolean).join(' ')} onClick={onClick}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  );
}

export function Pill({ children, tone, dot }: { children: React.ReactNode; tone?: 'up' | 'warn' | 'down' | 'gold' | 'jade' | null; dot?: boolean }): React.ReactElement {
  return <span className={['pill', tone ?? ''].filter(Boolean).join(' ')}>{dot && <i className="dot" />}{children}</span>;
}

export function EngineTag({ engine }: { engine: Engine | string }): React.ReactElement {
  return (
    <span className={'engine ' + (engine === 'muse_api' ? 'cloud' : 'local')}>
      <Icon name={engine === 'muse_api' ? 'cloud' : 'monitor'} size={15} />
      {engine === 'muse_api' ? '云端生成' : '本地生成'}
    </span>
  );
}

const SHOT_STATUS_TONE: Record<ShotStatus, 'up' | 'warn' | 'down' | 'gold' | null> = {
  empty: null, queued: 'warn', rendering: 'warn', generated: 'up', reviewed: 'up', locked: 'gold'
};
const SHOT_STATUS_TEXT: Record<ShotStatus, string> = {
  empty: '待生成', queued: '排队中', rendering: '渲染中', generated: '已生成', reviewed: '已确认', locked: '已锁定'
};

export function StatusPill({ status }: { status: ShotStatus }): React.ReactElement {
  return <Pill tone={SHOT_STATUS_TONE[status]} dot>{SHOT_STATUS_TEXT[status]}</Pill>;
}

const TASK_STATUS_TONE: Record<TaskStatus, 'up' | 'warn' | 'down' | null> = {
  pending: null, assigned: 'warn', running: 'warn', success: 'up', failed: 'down', timeout: 'down', canceled: null, blocked: 'down'
};

export function TaskPill({ status }: { status: TaskStatus }): React.ReactElement {
  const text: Record<TaskStatus, string> = {
    pending: '排队', assigned: '已派发', running: '执行中', success: '成功', failed: '失败', timeout: '超时', canceled: '已取消', blocked: '已阻断'
  };
  return <Pill tone={TASK_STATUS_TONE[status]} dot>{text[status]}</Pill>;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }): React.ReactElement {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }): React.ReactElement {
  return (
    <button type="button" className={'toggle ' + (on ? 'on' : '')} onClick={() => onChange(!on)} style={{ background: 'transparent', border: 'none', padding: 0 }}>
      <span className="track"><span className="knob" /></span>
      {label && <span style={{ color: on ? 'var(--text-1)' : 'var(--text-3)', fontSize: 12 }}>{label}</span>}
    </button>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div className="modal-title">{title}</div>
          <div className="spacer" />
          <button type="button" className="btn icon ghost" onClick={onClose} aria-label="关闭"><Icon name="x" size={16} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Toasts(): React.ReactElement {
  const { toasts, dismiss } = useApp();
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind} onClick={() => dismiss(t.id)}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
            <Icon name={t.kind === 'error' ? 'warn' : t.kind === 'success' ? 'check' : 'sparkle'} size={15} className={t.kind === 'error' ? '' : ''} />
            <span style={{ whiteSpace: 'pre-wrap' }}>{t.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ rows = 5, height = 56 }: { rows?: number; height?: number }): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ height, opacity: 1 - i * 0.08 }} />)}
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="state-wrap">
      <div className="state-icon"><Icon name="film" size={24} /></div>
      <div className="state-title">{title}</div>
      {desc && <div className="state-desc">{desc}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div className="state-wrap">
      <div className="state-icon" style={{ color: 'var(--down)', borderColor: 'rgba(225,91,80,.4)' }}><Icon name="warn" size={24} /></div>
      <div className="state-title">加载失败</div>
      <div className="state-desc">{message}</div>
      {onRetry && <Button kind="primary" icon="refresh" onClick={onRetry}>重试</Button>}
    </div>
  );
}

export function Ring({ used, cap, near, exceed, center, label }: {
  used: number;
  cap: number;
  near?: boolean;
  exceed?: boolean;
  center?: React.ReactNode;
  label?: string;
}): React.ReactElement {
  const size = 196;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const ratio = cap > 0 ? Math.min(1, used / cap) : 0;
  const color = exceed ? 'var(--down)' : near ? 'var(--warn)' : 'var(--gold)';
  return (
    <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} role="img" aria-label={label ?? '段容量'}>
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={exceed ? '#8e2f27' : near ? '#c07a1e' : 'var(--gold-deep)'} />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="url(#ringGrad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - ratio)}
        transform={'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'}
        style={{ transition: 'stroke-dashoffset 220ms ease-out' }}
      />
      <foreignObject x="0" y="0" width={size} height={size}>
        <div style={{ width: size, height: size, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          {center}
        </div>
      </foreignObject>
    </svg>
  );
}

export function Meter({ value, total, over }: { value: number; total: number; over?: boolean }): React.ReactElement {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="meter">
      <i style={{ width: pct + '%', background: over ? 'linear-gradient(90deg,#8e2f27,var(--down))' : undefined }} />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void }): React.ReactElement {
  return (
    <div className="chips">
      {options.map((o) => (
        <Chip key={o.id} on={value === o.id} onClick={() => onChange(o.id)}>{o.label}</Chip>
      ))}
    </div>
  );
}
