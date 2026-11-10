import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\pages\\Skills.tsx";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("            ); })\n            {pack.created &&", "            ); })}\n            {pack.created &&");
fs.writeFileSync(p, s);
console.log('fixed');
