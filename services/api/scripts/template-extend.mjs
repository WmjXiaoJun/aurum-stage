/** 把三种风格的模板项目补到 4 镜，重新合成并入库、落盘 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const API = 'http://127.0.0.1:8787/api/v1';
const DB = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db';
const OUT = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/templates';
const PROJECTS = [
  { id: 30, style: 'photoreal' },
  { id: 31, style: 'anime_2d' },
  { id: 32, style: 'cgi_3d' }
];
const LINES = [
  '今天我们不聊大词，就聊聊这档节目到底想让你记住什么。',
  '灯光、机位、台词，所有细节都只为了一件事：让你愿意看到最后。'
];
async function api(p, init) {
  const res = await fetch(API + p, init);
  const text = await res.text();
  if (!res.ok) throw new Error(p + ' -> ' + res.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}
const db = new DatabaseSync(DB);
for (const proj of PROJECTS) {
  const ov = await api('/projects/' + proj.id + '/overview');
  const seg = ov.segments[0];
  const existing = ov.shots.length;
  console.log('project', proj.id, 'shots', existing);
  const newShots = [];
  if (existing < 4) {
    for (let i = existing; i < 4; i++) {
      const line = LINES[i - 2] ?? LINES[0];
      const shot = await api('/segments/' + seg.id + '/shots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speaker_role_id: 'c_host', speaker_name: '主持人',
          camera: i % 2 === 0 ? 'close_up' : 'medium_shot',
          text_clean: line, lines: [line], render_engine: 'muse_api', visual_style: proj.style,
          visual_prompt: (ov.project.style_prompt || 'variety show studio') + ', ' + (i % 2 === 0 ? 'close-up of the host speaking, cinematic lighting' : 'medium shot of the host, cinematic lighting'),
          duration_ms: 8000, target_duration_ms: 8000
        })
      });
      newShots.push(shot.id);
    }
  }
  const taskIds = [];
  for (const sid of newShots) {
    const dag = await api('/shots/' + sid + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
    taskIds.push(...dag.task_dag.map((t) => t.task_id));
  }
  if (taskIds.length) {
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const list = await api('/projects/' + proj.id + '/tasks');
      const mine = list.filter((t) => taskIds.includes(t.id));
      if (mine.length && mine.every((t) => ['success', 'failed', 'canceled', 'timeout'].includes(t.status))) break;
    }
  }
  const composed = await api('/projects/' + proj.id + '/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bgm: false }) });
  console.log('compose', proj.id, composed.duration_sec + 's');
  const m = /assets\/(\d+)\/raw/.exec(String(composed.video_url ?? ''));
  if (!m) { console.log('no video url'); continue; }
  const assetId = Number(m[1]);
  const buf = Buffer.from(await fetch(API + '/assets/' + assetId + '/raw').then((r) => r.arrayBuffer()));
  const dst = path.join(OUT, 'tonight_show_' + proj.style + '.mp4');
  fs.writeFileSync(dst, buf);
  db.prepare("insert into compose_export (project_id, segment_id, task_id, status, duration_ms, video_asset_id, subtitle_asset_id, ass_asset_id, manifest, error_code, error_msg, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(proj.id, null, null, '成片', Math.round(Number(composed.duration_sec) * 1000), assetId, null, null, JSON.stringify({ template: 'tonight_show', style: proj.style }), null, null, new Date().toISOString());
  console.log('saved', dst, (buf.length / 1024 / 1024).toFixed(1) + 'MB');
}
process.exit(0);
