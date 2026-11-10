import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
db.prepare("update round_shot set render_engine='comfy_h3', status='empty', error_code=null where id=1125").run();
db.prepare("update render_task set status='canceled' where shot_id=1125 and status in ('pending','assigned')").run();
console.log('switched');
