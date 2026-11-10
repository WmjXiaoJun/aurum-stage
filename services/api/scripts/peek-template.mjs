import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const row = db.prepare("select template_key, display_name, template_body from workflow_template where template_key='show_tonight_show'").get();
const body = JSON.parse(row.template_body);
console.log('keys', Object.keys(body));
console.log('script segments', (body.script?.segments ?? []).length, JSON.stringify((body.script?.segments ?? [])[0] ?? {}).slice(0, 700));
