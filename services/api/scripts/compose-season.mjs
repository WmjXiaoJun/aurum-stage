import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const API = 'http://127.0.0.1:8787/api/v1';
const FF = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe';
const db = new DatabaseSync(DATA + '/aurum.db');
const project = db.prepare("select * from project where name like '玄枢%第一季' order by id desc limit 1").get();
const episodes = db.prepare('select * from season_episode where project_id = ? order by seq').all(project.id);
const outDir = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/season1';
fs.mkdirSync(outDir, { recursive: true });
async function api(path, init) { const r = await fetch(API + path, init); const t = await r.text(); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + t.slice(0, 120)); return t ? JSON.parse(t) : null; }
for (const ep of episodes) {
  const segs = db.prepare('select * from segment where episode_id = ? order by seq').all(ep.id);
  const files = [];
  for (const seg of segs) {
    const res = await api('/projects/' + project.id + '/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment_id: seg.id, bgm: true }) });
    const row = db.prepare('select * from asset where id = ?').get(res.video_asset_id ?? 0) ?? db.prepare("select * from asset where project_id = ? and asset_type='video' and source='compose' order by id desc limit 1").get(project.id);
    if (row) files.push(DATA + '/storage/assets/' + row.object_key);
    console.log('segment', seg.id, 'huazi', res.manifest?.huazi, '->', row?.object_key);
  }
  if (!files.length) continue;
  const list = outDir + '/ep' + ep.seq + '.txt';
  fs.writeFileSync(list, files.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
  const out = outDir + '/ep' + ep.seq + '-' + ep.visual_style + '.mp4';
  execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'ignore' });
  console.log('EPISODE', ep.seq, ep.visual_style, out, fs.statSync(out).size);
}
console.log('DONE');
process.exit(0);
