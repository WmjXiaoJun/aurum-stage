import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const rows = db.prepare("select s.id from round_shot s join segment g on g.id=s.segment_id where s.project_id=45 and s.id in (select s2.id from round_shot s2 join segment g2 on g2.id=s2.segment_id where g2.episode_id in (4,5,6) order by s2.id limit 6)").all();
console.log(rows);
for (const r of rows) {
  db.prepare("update round_shot set status='empty', error_code=null where id=?").run(r.id);
  const res = await fetch('http://127.0.0.1:8787/api/v1/shots/' + r.id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
  console.log(r.id, res.status);
}
