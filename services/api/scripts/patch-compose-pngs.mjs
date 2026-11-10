import fs from 'node:fs';
const C = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\compose.ts";
let s = fs.readFileSync(C, 'utf8');
s = s.replace("      const rendered = items.map((it) => ({ text: it.text, style: it.style, start_ms: it.start_ms, end_ms: it.end_ms }));",
`      const rendered: Array<{ path: string; start_ms: number; end_ms: number }> = [];
      for (let i = 0; i < items.length; i++) {
        const hzPath = objectPath('assets', baseKey + '/huazi/' + i + '.png');
        const ok = await renderHuazi(items[i].text, items[i].style, hzPath);
        if (ok) rendered.push({ path: hzPath, start_ms: items[i].start_ms, end_ms: items[i].end_ms });
      }`);
fs.writeFileSync(C, s);
console.log('compose rendered pngs');
