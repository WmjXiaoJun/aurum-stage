import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\db\\index.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('auto_compose')) {
  s = s.replace('{ table: \'round_shot\', column: \'lang\', ddl: "ALTER TABLE round_shot ADD COLUMN lang TEXT" }',
    '{ table: \'round_shot\', column: \'lang\', ddl: "ALTER TABLE round_shot ADD COLUMN lang TEXT" },\n  { table: \'project\', column: \'auto_compose\', ddl: "ALTER TABLE project ADD COLUMN auto_compose INTEGER NOT NULL DEFAULT 0" }');
  fs.writeFileSync(p, s);
  console.log('migration added');
} else console.log('already');
