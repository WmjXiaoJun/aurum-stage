import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const rows = db.prepare('select p.id, p.name, p.status, p.aspect_ratio, (select count(*) from round_shot s where s.project_id=p.id) shots, (select count(*) from asset a where a.project_id=p.id) assets from project p order by p.id').all();
for (const r of rows) console.log([r.id, r.name, r.status, r.aspect_ratio, 'shots=' + r.shots, 'assets=' + r.assets].join(' | '));
