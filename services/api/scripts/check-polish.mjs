import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const a = db.prepare("select id, meta from asset where project_id = 41 and asset_type = 'video' order by id desc limit 1").get();
console.log('asset', a?.id, String(a?.meta ?? '').slice(0, 260));
console.log('clone 42', db.prepare('select id, auto_compose from project where id = 42').get());
console.log('exports dir files', db.prepare("select count(*) n from compose_export").get());
