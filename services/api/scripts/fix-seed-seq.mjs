import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\scripts\\seed-season.mjs";
let s = fs.readFileSync(p, 'utf8');
s = s.replace(".run(projectId, episodeId, gi + 1, 'talk_round'", ".run(projectId, episodeId, i * 2 + gi + 1, 'talk_round'");
fs.writeFileSync(p, s);
console.log('seq fixed');
