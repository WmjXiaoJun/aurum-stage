import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const t = db.prepare("select status, task_type, count(*) n from render_task where project_id=45 group by status, task_type").all();
console.log(t);
const running = db.prepare("select id, shot_id, task_type, status, created_at from render_task where project_id=45 and status in ('pending','assigned','running') order by id desc limit 8").all();
console.log(running);
const last = db.prepare("select id, shot_id, task_type, status, error_code from render_task where project_id=45 order by id desc limit 6").all();
console.log(last);
