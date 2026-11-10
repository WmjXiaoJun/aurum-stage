/** 修正 2D/3D 风格：提示词加风格锚定后重渲染并重新合成 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const API = 'http://127.0.0.1:8787/api/v1';
const OUT = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/templates';
const DB = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db';
const STYLE_PROMPT = {
  anime_2d: '2d anime style, cel shading, flat colors, clean lineart, anime host',
  cgi_3d: 'stylized 3d render, pixar style cartoon, glossy materials, 3d character'
};
async function api(p, init) {
  const res = await fetch(API + p, init);
  const text = await res.text();
  if (!res.ok) throw new Error(p + ' -> ' + res.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}
const db = new DatabaseSync(DB);
for (const [projectId, style] of [[31, 'anime_2d'], [32, 'cgi_3d']]) {
  const ov = await api('/projects/' + projectId + '/overview');
  console.log('project', projectId, style, 'shots', ov.shots.length);
  for (const s of ov.shots) {
    const prompt = STYLE_PROMPT[style] + ', ' + String(s.visual_prompt ?? 'variety show studio');
    await api('/shots/' + s.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visual_prompt: prompt }) });
  }
  const taskIds = [];
  const shots = (await api('/projects/' + projectId + '/overview')).shots;
  for (const s of shots) {
    const dag = await api('/shots/' + s.id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
    taskIds.push(...dag.task_dag.map((t) => t.task_id));
  }
  console.log('tasks', taskIds.length);
  const deadline = Date.now() + 25 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const list = await api('/projects/' + projectId + '/tasks');
    const mine = list.filter((t) => taskIds.includes(t.id));
    if (mine.length && mine.every((t) => ['success', 'failed', 'canceled', 'timeout'].includes(t.status))) break;
  }
  const composed = await api('/projects/' + projectId + '/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bgm: false }) });
  const m = /assets\/(\d+)\/raw/.exec(String(composed.video_url ?? ''));
  if (!m) { console.log('no url'); continue; }
  const assetId = Number(m[1]);
  const buf = Buffer.from(await fetch(API + '/assets/' + assetId + '/raw').then((r) => r.arrayBuffer()));
  const dst = path.join(OUT, 'tonight_show_' + style + '.mp4');
  fs.writeFileSync(dst, buf);
  db.prepare("insert into compose_export (project_id, segment_id, task_id, status, duration_ms, video_asset_id, subtitle_asset_id, ass_asset_id, manifest, error_code, error_msg, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(projectId, null, null, '成片', Math.round(Number(composed.duration_sec) * 1000), assetId, null, null, JSON.stringify({ template: 'tonight_show', style, rerendered: true }), null, null, new Date().toISOString());
  console.log('saved', dst, composed.duration_sec + 's');
}
process.exit(0);
