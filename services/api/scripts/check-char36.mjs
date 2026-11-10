import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
console.log('char cols', db.prepare('pragma table_info(character_asset)').all().map(c => c.name).filter(n => n.includes('art')));
console.log('voice cols', db.prepare('pragma table_info(voice_asset)').all().map(c => c.name).filter(n => n.includes('instr')));
console.log('char 36', db.prepare('select id, name, art_status from character_asset where id = 36').get());
console.log('voice 36', db.prepare("select * from voice_asset where role_id = 'c_cd3d1c' or voice_id like '%36%' order by id desc limit 3").all());
