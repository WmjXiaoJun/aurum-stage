import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\media\\\\ffmpeg.ts";
let s = fs.readFileSync(p, 'utf8');
const bad = "C\\:/Windows/Fonts/msyhbd.ttc";
const good = String.raw`C\:/Windows/Fonts/msyhbd.ttc`;
if (s.indexOf(bad) >= 0) { s = s.split(bad).join(good); fs.writeFileSync(p, s); console.log('font escaped'); }
else console.log('pattern missing');
