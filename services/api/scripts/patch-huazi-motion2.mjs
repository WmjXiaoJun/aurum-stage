import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\ffmpeg.ts";
let lines = fs.readFileSync(p, 'utf8').split('\n');
const idx = lines.findIndex((l) => l.includes('chains.push(prev +') && l.includes('overlay=x='));
if (idx >= 0) {
  lines[idx] = "    const filt = '[' + key + ']overlay=x=\'' + xExpr + '\':y=\'' + yExpr + '\':enable=\'between(t,' + startSec + ',' + (it.start_ms / 1000 + dur).toFixed(2) + ')\'';\n    chains.push(prev + filt + next);";
  fs.writeFileSync(p, lines.join('\n'));
  console.log('line fixed', idx + 1);
} else console.log('not found');
