import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const rows = db.prepare('select id from round_shot where project_id = 45 and preview_asset_id is null order by id').all();
console.log('pending', rows.map(r => r.id));
for (const r of rows) {
  db.prepare("update round_shot set render_engine='comfy_h3', status='empty', error_code=null where id=?").run(r.id);
  db.prepare("update render_task set status='canceled' where shot_id=? and status in ('pending','assigned')").run(r.id);
}
for (const r of rows) {
  const res = await fetch('http://127.0.0.1:8787/api/v1/shots/' + r.id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
  console.log(r.id, res.status);
}
