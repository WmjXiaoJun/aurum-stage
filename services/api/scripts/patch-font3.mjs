import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\media\\\\ffmpeg.ts";
const lines = fs.readFileSync(p, 'utf8').split('\n');
const idx = lines.findIndex((l) => l.includes('msyhbd.ttc'));
if (idx < 0) { console.log('line missing'); process.exit(1); }
lines[idx] = "    const draw = 'drawtext=fontfile=' + String.fromCharCode(39) + 'C' + String.fromCharCode(92, 92) + ':/Windows/Fonts/msyhbd.ttc' + String.fromCharCode(39) +";
fs.writeFileSync(p, lines.join('\n'));
console.log('font path rebuilt at', idx + 1);
