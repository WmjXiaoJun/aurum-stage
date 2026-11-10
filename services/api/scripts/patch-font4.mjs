import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\media\\\\ffmpeg.ts";
const lines = fs.readFileSync(p, 'utf8').split('\n');
// 恢复 resolveFont 的 win32 分支
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("String.fromCharCode(92, 92)") && i < 60) {
    lines[i] = "      ? ['C:\\\\Windows\\\\Fonts\\\\msyh.ttc', 'C:\\\\Windows\\\\Fonts\\\\msyhbd.ttc', 'C:\\\\Windows\\\\Fonts\\\\simhei.ttf']";
  }
}
// 花字字体：双反斜杠
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("msyhbd.ttc") && lines[i].includes("String.fromCharCode(39) + 'C")) {
    lines[i] = "    const draw = 'drawtext=fontfile=' + String.fromCharCode(39) + 'C' + String.fromCharCode(92, 92) + ':/Windows/Fonts/msyhbd.ttc' + String.fromCharCode(39) +";
  }
}
fs.writeFileSync(p, lines.join('\n'));
console.log('repaired');
