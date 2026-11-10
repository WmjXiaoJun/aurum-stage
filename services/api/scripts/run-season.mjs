import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const API = 'http://127.0.0.1:8787/api/v1';
const db = new DatabaseSync(DATA + '/aurum.db');
const FF = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe';
const project = db.prepare("select * from project where name like '玄枢%第一季' order by id desc limit 1").get();
const projectId = project.id;
const episodes = db.prepare('select * from season_episode where project_id = ? order by seq').all(projectId);
const chars = db.prepare('select * from character_asset where project_id = ? and is_active = 1').all(projectId);
console.log(JSON.stringify({ projectId, episodes: episodes.map(e => e.id), chars: chars.map(c => c.id) }));

async function api(path, init) {
  const r = await fetch(API + path, init);
  const t = await r.text();
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + t.slice(0, 120));
  return t ? JSON.parse(t) : null;
}

// 1) 角色：生成立绘（自动音色后台）
for (const c of chars) {
  try { await api('/characters/' + c.id + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modes: ['portrait'], count: 1, style: 'photoreal' }) }); }
  catch (e) { console.log('art fail', c.id, String(e).slice(0, 80)); }
  try { await api('/characters/' + c.id + '/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: 'breeze' }) }); } catch {}
}
console.log('characters ready');

// 2) 提交渲染
const shots = db.prepare("select s.*, e.seq as ep_seq from round_shot s join segment g on g.id = s.segment_id join season_episode e on e.id = g.episode_id where s.project_id = ? order by e.seq, g.seq, s.seq").all(projectId);
for (const s of shots) {
  try { await api('/shots/' + s.id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) }); }
  catch (e) { console.log('render submit fail', s.id, String(e).slice(0, 100)); }
}
console.log('submitted', shots.length);

// 3) 等渲染完成（最多 70 分钟）
const deadline = Date.now() + 70 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 15000));
  const rows = db.prepare('select id, status, preview_asset_id from round_shot where project_id = ?').all(projectId);
  const done = rows.filter(r => r.preview_asset_id).length;
  const failed = rows.filter(r => r.status === 'failed').length;
  console.log('rendered', done + '/' + rows.length, 'failed', failed);
  if (done + failed >= rows.length) break;
}

// 4) 逐期合成：每期两条段，先分段合成再拼接
const outDir = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/season1';
fs.mkdirSync(outDir, { recursive: true });
for (const ep of episodes) {
  const segs = db.prepare('select * from segment where episode_id = ? order by seq').all(ep.id);
  const files = [];
  for (const seg of segs) {
    const res = await api('/projects/' + projectId + '/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment_id: seg.id, bgm: true }) });
    const row = db.prepare('select * from asset where id = ?').get(res.video_asset_id);
    if (row) files.push(DATA + '/storage/assets/' + row.object_key);
  }
  if (files.length === 0) { console.log('ep', ep.seq, 'no files'); continue; }
  const list = outDir + '/ep' + ep.seq + '.txt';
  fs.writeFileSync(list, files.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
  const out = outDir + '/ep' + ep.seq + '-' + ep.visual_style + '.mp4';
  execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'ignore' });
  console.log('EPISODE', ep.seq, ep.visual_style, out, fs.statSync(out).size);
}
console.log('DONE');
process.exit(0);
