import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\domain\\skills-service.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("      const lines = segs.flatMap((s) => asArray(s.rounds).flatMap((r) => asArray((r as Record<string, unknown>).lines)));",
  "      const lines = segs.flatMap((s) => asArray(s.rounds).flatMap((r) => asArray((r as Record<string, unknown>).lines))) as Array<Record<string, unknown>>;");
s = s.replace("      const long = lines.filter((l) => str(l.text).length > 40).length;", "      const long = lines.filter((l) => str(l.text).length > 40).length;");
fs.writeFileSync(p, s);
console.log('cast patched');
