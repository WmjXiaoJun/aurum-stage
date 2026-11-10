import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\scripts\\assemble-final.mjs";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/storage/assets/projects/45/characters', '角色：自动立绘与音色'],",
  "  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/season-overview.png', '第 1 期 · 二维动画'],\n  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/ep2-big.jpg', '第 2 期 · 三维动画'],\n  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/ep3-final.jpg', '第 3 期 · 写实真人'],\n  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/storage/assets/projects/45/characters', '角色：自动立绘与音色'],");
s = s.replace("'-t', '12'", "'-t', '18'");
fs.writeFileSync(p, s);
console.log('stills extended');
