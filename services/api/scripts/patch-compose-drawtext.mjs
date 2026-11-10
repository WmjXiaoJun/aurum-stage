import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\compose.ts";
let s = fs.readFileSync(p, 'utf8');
const a = s.indexOf('      const rendered: Array<{ path: string');
const b = s.indexOf('      if (rendered.length) {');
if (a >= 0 && b > a) {
  s = s.slice(0, a) + `      const rendered = items.map((it) => ({ text: it.text, style: it.style, start_ms: it.start_ms, end_ms: it.end_ms }));
` + s.slice(b);
  s = s.replace("const ok = await renderHuazi(items[i].text, items[i].style, hzPath);", "");
  fs.writeFileSync(p, s);
  console.log('compose drawtext items');
} else console.log('anchors missing');
