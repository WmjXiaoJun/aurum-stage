import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const row = db.prepare("select template_body from workflow_template where template_key='show_tonight_show'").get();
const body = JSON.parse(row.template_body);
console.log('segments', (body.segments ?? []).length);
console.log(JSON.stringify((body.segments ?? [])[0] ?? {}, null, 1).slice(0, 1200));
console.log('cast', JSON.stringify((body.cast ?? []).slice(0,2)).slice(0, 500));
