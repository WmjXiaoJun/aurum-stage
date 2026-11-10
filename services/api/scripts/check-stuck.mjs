import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const shots = db.prepare("select s.id, s.shot_code, s.status, s.error_code, s.preview_asset_id, g.episode_id from round_shot s join segment g on g.id=s.segment_id where s.project_id=45 and s.preview_asset_id is null").all();
console.log('pending shots', shots);
const tasks = db.prepare("select id, shot_id, task_type, status, error_code, created_at from render_task where project_id=45 order by id desc limit 10").all();
console.log('tasks', tasks);
