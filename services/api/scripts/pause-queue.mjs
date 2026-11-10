import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const r = db.prepare("update render_task set status='canceled' where project_id=45 and status in ('pending','assigned')").run();
console.log('canceled', r.changes);
