import fs from 'node:fs';
const F = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\media\\\\ffmpeg.ts";
let f = fs.readFileSync(F, 'utf8');
f = f.replace("colorkey=0x00b140:0.42:0.10,despill=type=green:mix=0.6:expand=0.15,scale=", "colorkey=0x00b140:0.36:0.06,scale=");
f = f.replace("'scale=' + Math.round(width * 0.55)", "'scale=' + Math.round(width * 0.86)");
fs.writeFileSync(F, f);
const H = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\media\\\\huazi.ts";
let h = fs.readFileSync(H, 'utf8');
h = h.replace("const clean = cue.text.replace(/^[^：:]{1,8}[：:]/, '').replace(/[，。！？、,.!?“”\"\\s]/g, '');",
  "const raw = cue.text.replace(/^[^：:]{1,8}[：:]/, '');\n    const clean = (raw.split(/[，。！？、,.!?]/)[0] ?? raw).replace(/[“”\"\\s]/g, '');");
fs.writeFileSync(H, h);
console.log('tuned');
