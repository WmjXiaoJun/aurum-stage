import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\ffmpeg.ts";
let lines = fs.readFileSync(p, 'utf8').split('\n');
const idx = lines.findIndex((l) => l.includes('overlay=x='));
if (idx >= 0) {
  lines.splice(idx, 2);
  lines.splice(idx, 0,
    "    const q = String.fromCharCode(39);",
    "    const endSec = (it.start_ms / 1000 + dur).toFixed(2);",
    "    const filt = '[' + key + ']overlay=x=' + q + xExpr + q + ':y=' + q + yExpr + q + ':enable=' + q + 'between(t,' + startSec + ',' + endSec + ')' + q;",
    "    chains.push(prev + filt + next);"
  );
  fs.writeFileSync(p, lines.join('\n'));
  console.log('rewritten', idx + 1);
} else console.log('not found');
