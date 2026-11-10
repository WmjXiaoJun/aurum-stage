import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
console.log(db.prepare('select id, name from project').all());
console.log(db.prepare('select id, seq, title, visual_style from season_episode').all());
