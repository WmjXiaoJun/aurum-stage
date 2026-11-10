import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const rows = db.prepare("select template_key, display_name, visual_style from workflow_template where template_type='variety_show' order by id").all();
console.log('variety templates', rows.length);
const dir = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/storage/assets/templates';
for (const r of rows) {
  const f = dir + '/' + r.template_key + '.png';
  console.log(r.template_key, r.display_name, fs.existsSync(f) ? 'cover' : 'NO-COVER');
}
const all = db.prepare("select template_type, count(*) n from workflow_template group by template_type").all();
console.log(all);
