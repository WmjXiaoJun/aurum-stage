import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\projects.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace(".map((r) => mapShot(r as never))", ".map((r) => mapShot(r as never, []))");
fs.writeFileSync(p, s);
console.log('fixed');
