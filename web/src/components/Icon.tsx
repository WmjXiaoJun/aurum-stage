/** 图标：全站 currentColor 单字重；16px 用小坐标粗路径保证合成层栅格稳定（25.11.2） */
export type IconName =
  | 'dashboard' | 'script' | 'storyboard' | 'timeline' | 'voice' | 'user' | 'task' | 'agent'
  | 'style' | 'comic' | 'model' | 'qa' | 'node' | 'template' | 'export' | 'settings'
  | 'cloud' | 'monitor' | 'play' | 'pause' | 'plus' | 'edit' | 'trash' | 'refresh' | 'check'
  | 'warn' | 'x' | 'chevron' | 'lock' | 'sparkle' | 'upload' | 'download' | 'search' | 'filter'
  | 'dots' | 'clock' | 'wave' | 'mic' | 'film' | 'flame';

const PATHS: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z',
  script: 'M5 3h9l5 5v13H5zM14 3v5h5M8 12h8M8 16h8M8 8h2',
  storyboard: 'M3 5h18v14H3zM8 5v14M16 5v14M3 12h18',
  timeline: 'M3 6h18M3 12h12M3 18h7M17 10v4',
  voice: 'M4 10v4M8 6v12M12 3v18M16 7v10M20 11v2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  task: 'M4 6h4v4H4zM10 8h10M4 14h4v4H4zM10 16h10',
  agent: 'M12 3v3M8 9h8a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3zM9 13h.01M15 13h.01M9 21h6',
  style: 'M12 3l9 18H3zM12 9v6M12 18h.01',
  comic: 'M3 5h8v6H3zM13 5h8v6h-8zM3 13h8v6H3zM13 13h8v6h-8z',
  model: 'M12 3l8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10',
  qa: 'M12 3l9 16H3zM12 9v5M12 16h.01',
  node: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h4v7M7 10v7h7',
  template: 'M4 4h16v5H4zM4 12h7v8H4zM13 12h7v8h-7z',
  export: 'M12 3v12M7 8l5-5 5 5M4 17v4h16v-4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  cloud: 'M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.4A3.8 3.8 0 0 1 18 18z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  play: 'M7 4l12 8-12 8z',
  pause: 'M8 4v16M16 4v16',
  plus: 'M12 4v16M4 12h16',
  edit: 'M4 20h4L20 8l-4-4L4 16z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  refresh: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  check: 'M4 12l5 5L20 6',
  warn: 'M12 3l9 17H3zM12 9v5M12 17h.01',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 5l7 7-7 7',
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  upload: 'M12 20V8M7 13l5-5 5 5M4 4h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5',
  filter: 'M3 5h18l-7 8v6l-4-2v-4z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l4 2',
  wave: 'M2 12h3l2-6 3 12 3-9 2 6 3-3h4',
  mic: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M8 21h8',
  film: 'M3 4h18v16H3zM7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4',
  flame: 'M12 3c3 4 5 5 5 9a5 5 0 0 1-10 0c0-3 2-4 3-6 1 2 2 2 2 2V3z'
};

export function Icon({ name, size = 16, className = '', strokeWidth = 1.8 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? PATHS.dots} />
    </svg>
  );
}

export function EngineIcon({ engine, size = 15 }: { engine: 'muse_api' | 'comfy_h3' | string; size?: number }): React.ReactElement {
  return <Icon name={engine === 'muse_api' ? 'cloud' : 'monitor'} size={size} />;
}
