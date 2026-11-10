import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const rows = db.prepare('select id, status, preview_asset_id from round_shot where id between 1115 and 1120').all();
console.log(rows);
