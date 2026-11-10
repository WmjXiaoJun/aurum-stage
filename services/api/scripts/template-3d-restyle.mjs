import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const API = 'http://127.0.0.1:8787/api/v1';
const OUT = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/templates';
const DB = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db';
const PROMPT = '3d animated cartoon, pixar style, exaggerated cartoon proportions, big expressive eyes, smooth plastic skin, colorful stylized lighting, non-photorealistic, animated film still';
async function api(p, init) {
  const res = await fetch(API + p, init);
  const text = await res.text();
  if (!res.ok) throw new Error(p + ' -> ' + res.status + ' ' + text.slice(0, 160));
  return text ? JSON.parse(text) : null;
}
const projectId = 32;
const ov = await api('/projects/' + projectId + '/overview');
for (const s of ov.shots) {
  await api('/shots/' + s.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visual_prompt: PROMPT + ', ' + (s.camera === 'close_up' ? 'close-up of the host speaking' : 'medium shot of the host on the late-night stage') }) });
}
const taskIds = [];
for (const s of ov.shots) {
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
if (m) {
  const assetId = Number(m[1]);
  const buf = Buffer.from(await fetch(API + '/assets/' + assetId + '/raw').then((r) => r.arrayBuffer()));
  const dst = path.join(OUT, 'tonight_show_cgi_3d.mp4');
  fs.writeFileSync(dst, buf);
  const db = new DatabaseSync(DB);
  db.prepare("insert into compose_export (project_id, segment_id, task_id, status, duration_ms, video_asset_id, subtitle_asset_id, ass_asset_id, manifest, error_code, error_msg, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(projectId, null, null, '成片', Math.round(Number(composed.duration_sec) * 1000), assetId, null, null, JSON.stringify({ template: 'tonight_show', style: 'cgi_3d', restyled: true }), null, null, new Date().toISOString());
  console.log('saved', dst, composed.duration_sec + 's');
}
process.exit(0);
