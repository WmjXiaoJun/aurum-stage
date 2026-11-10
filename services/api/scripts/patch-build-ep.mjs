import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\scripts\\build-episodes.mjs";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("    const row = db.prepare('select * from asset where id = ?').get(res.video_asset_id ?? 0);",
  "    const m = String(res.video_url ?? '').match(/assets\\/(\\d+)\\/raw/);\n    const vid = m ? Number(m[1]) : Number(res.video_asset_id ?? 0);\n    const row = db.prepare('select * from asset where id = ?').get(vid) ?? db.prepare(\"select * from asset where project_id = ? and asset_type='video' and object_key like ? order by id desc limit 1\").get(project.id, '%export/seg' + seg.id + '/%');");
fs.writeFileSync(p, s);
console.log('asset lookup fixed');
