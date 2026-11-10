/** 占位帧生成：无真实渲染产物时给前端一个与黑金视觉一致的分镜海报（SVG） */
import { CAMERA_LABEL, ENGINE_META, STYLE_PRESETS, type Camera, type RenderEngine, type VisualStyleId } from '@aurum/core';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(text: string, perLine: number, maxLines: number): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += perLine) {
    lines.push(chars.slice(i, i + perLine).join(''));
  }
  return lines;
}

export interface PosterInput {
  width: number;
  height: number;
  shot_code: string;
  camera: Camera | string;
  engine: RenderEngine | string;
  style: VisualStyleId | string;
  prompt: string;
  duration_ms: number;
  status?: string;
  segment_title?: string;
}

export function buildPosterSvg(input: PosterInput): string {
  const meta = ENGINE_META[(input.engine as RenderEngine)] ?? ENGINE_META.comfy_h3;
  const style = STYLE_PRESETS[(input.style as VisualStyleId)] ?? STYLE_PRESETS.photoreal;
  const accent = meta.tone === 'gold' ? '#E8D6A8' : '#7FD3CE';
  const accentDeep = meta.tone === 'gold' ? '#A9884F' : '#46A09B';
  const camLabel = CAMERA_LABEL[(input.camera as Camera)] ?? String(input.camera);
  const promptLines = wrap(input.prompt || '分镜占位帧', Math.round(input.width / 46), 4);
  const scale = input.width / 1080;
  const fs = (n: number) => Math.round(n * scale);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + input.width + '" height="' + input.height + '" viewBox="0 0 ' + input.width + ' ' + input.height + '">',
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="#0A0C0F"/><stop offset="55%" stop-color="#131821"/><stop offset="100%" stop-color="#0E1218"/>',
    '</linearGradient>',
    '<radialGradient id="glow" cx="78%" cy="8%" r="70%">',
    '<stop offset="0%" stop-color="' + accent + '" stop-opacity="0.28"/><stop offset="100%" stop-color="' + accent + '" stop-opacity="0"/>',
    '</radialGradient>',
    '<radialGradient id="glow2" cx="10%" cy="105%" r="60%">',
    '<stop offset="0%" stop-color="' + accentDeep + '" stop-opacity="0.22"/><stop offset="100%" stop-color="' + accentDeep + '" stop-opacity="0"/>',
    '</radialGradient>',
    '<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>',
    '<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer></filter>',
    '</defs>',
    '<rect width="100%" height="100%" fill="url(#bg)"/>',
    '<rect width="100%" height="100%" fill="url(#glow)"/>',
    '<rect width="100%" height="100%" fill="url(#glow2)"/>',
    '<rect width="100%" height="100%" filter="url(#grain)" opacity="0.5"/>',
    '<rect x="' + fs(28) + '" y="' + fs(28) + '" width="' + (input.width - fs(56)) + '" height="' + (input.height - fs(56)) + '" fill="none" stroke="' + accent + '" stroke-opacity="0.22" rx="' + fs(10) + '"/>',
    '<text x="' + fs(56) + '" y="' + fs(120) + '" fill="#F4F0E7" font-family="Cascadia Mono, Consolas, monospace" font-size="' + fs(58) + '" letter-spacing="' + fs(4) + '">' + esc(input.shot_code) + '</text>',
    '<text x="' + fs(56) + '" y="' + fs(172) + '" fill="' + accent + '" font-family="Microsoft YaHei UI, sans-serif" font-size="' + fs(26) + '">' + esc(style.label + ' · ' + meta.label) + '</text>',
    '<text x="' + fs(56) + '" y="' + fs(220) + '" fill="#9BA1AC" font-family="Microsoft YaHei UI, sans-serif" font-size="' + fs(22) + '">' + esc(camLabel + ' · ' + (input.duration_ms / 1000).toFixed(1) + 's' + (input.segment_title ? ' · ' + input.segment_title : '')) + '</text>',
    ...promptLines.map((line, i) => '<text x="' + fs(56) + '" y="' + (input.height - fs(150) - (promptLines.length - 1 - i) * fs(46)) + '" fill="#636A76" font-family="Microsoft YaHei UI, sans-serif" font-size="' + fs(24) + '">' + esc(line) + '</text>'),
    '<text x="' + (input.width - fs(56)) + '" y="' + (input.height - fs(60)) + '" text-anchor="end" fill="' + accent + '" font-family="Bebas Neue, Bahnschrift, sans-serif" font-size="' + fs(76) + '">AURUM</text>',
    '</svg>'
  ].join('');
}
