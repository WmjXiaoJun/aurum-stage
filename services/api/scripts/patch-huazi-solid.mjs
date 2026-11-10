import fs from 'node:fs';
const P = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\huazi.ts";
let h = fs.readFileSync(P, 'utf8');
h = h.replace("     -webkit-text-stroke:4px \${p.stroke};\n     background:linear-gradient(180deg,\${p.fill1} 0%,\${p.fill2} 62%,\${p.fill1} 100%);\n     -webkit-background-clip:text;background-clip:text;color:transparent;",
  "     -webkit-text-stroke:5px \${p.stroke};\n     color:\${p.fill2};");
fs.writeFileSync(P, h);
const F = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\media\\\\ffmpeg.ts";
let f = fs.readFileSync(F, 'utf8');
f = f.replace("colorkey=0x00b140:0.24:0.00", "colorkey=0x00b140:0.14:0.02");
fs.writeFileSync(F, f);
console.log('solid fill + tighter key');
