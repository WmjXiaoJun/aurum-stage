import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const s = db.prepare('select id, status, preview_asset_id, error_code, error_msg from round_shot where id=1123').get();
console.log(s);
const a = s.preview_asset_id ? db.prepare('select bucket, object_key from asset where id=?').get(s.preview_asset_id) : null;
console.log(a);
