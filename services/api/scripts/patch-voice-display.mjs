import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\pages\\Characters.tsx";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("value={voiceEngine[c.id] ?? (c.voice ? (String((c.voice as unknown as { engine?: string }).engine ?? 'edge').includes('breeze') ? 'breeze' : 'edge') : 'edge')}",
  "value={voiceEngine[c.id] ?? (c.voice && String((c.voice as unknown as { provider?: string }).provider ?? '').includes('breeze') ? 'breeze' : 'edge')}");
s = s.replace("<dt>音色</dt><dd>{c.voice ? '已绑定' : '未绑定'}</dd>", "<dt>音色</dt><dd>{c.voice ? (String((c.voice as unknown as { provider?: string }).provider ?? '').includes('breeze') ? '本地 Breeze 模型' : '云端 edge') : '未绑定'}</dd>");
fs.writeFileSync(p, s);
console.log('voice display patched');
