import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const rows = db.prepare("select s.id, s.shot_code, s.preview_asset_id, g.episode_id, g.id seg from round_shot s join segment g on g.id=s.segment_id order by g.episode_id, g.seq, s.seq").all();
for (const r of rows) console.log(r.id, r.shot_code, 'seg', r.seg, 'ep', r.episode_id, r.preview_asset_id ? 'done' : 'pending');
