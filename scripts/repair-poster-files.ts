/** 修复历史 poster 资产：补齐缺失的 SVG 文件（旧版目录未创建导致只写了库没写盘） */
import fs from 'node:fs';
import path from 'node:path';
import { all, get, json } from '../services/api/src/db/index.js';
import { buildPosterSvg } from '../services/api/src/adapters/poster.js';
import { objectPath } from '../services/api/src/adapters/storage.js';
import { COMPOSE_PRESETS } from '@aurum/core';

let fixed = 0;
const posters = all<{ id: number; project_id: number; object_key: string; meta: string }>(
  "SELECT * FROM asset WHERE asset_type = 'image' AND meta LIKE '%poster%'"
);
for (const p of posters) {
  const abs = objectPath('assets', p.object_key);
  if (fs.existsSync(abs)) continue;
  const meta = json<{ shot_id?: number; task_id?: number }>(p.meta, {});
  const shot = meta.shot_id ? get('SELECT * FROM round_shot WHERE id = ?', [meta.shot_id]) : undefined;
  const project = get('SELECT * FROM project WHERE id = ?', [p.project_id]);
  if (!shot || !project) continue;
  const preset = COMPOSE_PRESETS[String(project.aspect_ratio ?? '9:16')] ?? COMPOSE_PRESETS['9:16'];
  const segment = get('SELECT title FROM segment WHERE id = ?', [Number(shot.segment_id)]);
  const svg = buildPosterSvg({
    width: preset.width,
    height: preset.height,
    shot_code: String(shot.shot_code),
    camera: String(shot.camera),
    engine: String(shot.render_engine),
    style: String(shot.visual_style),
    prompt: String(shot.visual_prompt ?? ''),
    duration_ms: Number(shot.duration_ms ?? 0),
    segment_title: String(segment?.title ?? '')
  });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, svg, 'utf8');
  fixed += 1;
}
console.log('补齐海报文件：' + fixed + ' 个');
