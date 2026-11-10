import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const rows = db.prepare('select id from round_shot where project_id = 45 and preview_asset_id is null order by id').all();
console.log('pending', rows.length);
let ok = 0;
for (const r of rows) {
  const res = await fetch('http://127.0.0.1:8787/api/v1/shots/' + r.id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
  if (res.ok) ok++; else console.log('fail', r.id, res.status);
  if (ok % 20 === 0) console.log('submitted', ok);
}
console.log('done', ok);
