import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const c = db.prepare('select id, name, art_status from character_asset where id = 36').get();
const refs = db.prepare('select angle, count(*) n from character_ref_image where character_id = 36 group by angle').all();
console.log(c, refs);
