import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\ffmpeg.ts";
let s = fs.readFileSync(p, 'utf8');
const bad = s.slice(s.indexOf("    chains.push(prev + '[' + key + ']overlay"), s.indexOf("    prev = next;"));
const good = "    const enable = \"between(t,\" + (it.start_ms / 1000).toFixed(2) + \",\" + (it.end_ms / 1000).toFixed(2) + \")\";\n    chains.push(prev + '[' + key + ']overlay=x=(W-w)/2:y=H*0.14:enable=' + \"'\" + enable + \"'\" + next);\n";
if (bad) {
  s = s.replace(bad, good);
  fs.writeFileSync(p, s);
  console.log('repaired');
} else console.log('pattern missing');
