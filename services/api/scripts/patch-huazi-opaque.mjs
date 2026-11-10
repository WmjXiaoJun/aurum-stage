import fs from 'node:fs';
const F = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\media\\\\ffmpeg.ts";
let f = fs.readFileSync(F, 'utf8');
f = f.replace("colorkey=0x00b140:0.36:0.06,scale=", "colorkey=0x00b140:0.24:0.00,scale=");
f = f.replace(",format=rgba,fade=t=in:st=0:d=0.28:alpha=1,trim=duration=", ",format=rgba,trim=duration=");
fs.writeFileSync(F, f);
console.log('opacity tuning');
