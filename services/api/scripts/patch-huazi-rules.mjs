import fs from 'node:fs';
const H = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\huazi.ts";
let h = fs.readFileSync(H, 'utf8');
// 字号/位置规则：短句大、长句小；左右交替避开人脸中线
h = h.replace("const size = text.length > 7 ? 118 : text.length > 5 ? 132 : 150;", "const size = text.length > 6 ? 104 : text.length > 4 ? 124 : 146;");
h = h.replace("if (clean.length < 2 || clean.length > 7) continue;", "if (clean.length < 2 || clean.length > 8) continue;");
fs.writeFileSync(H, h);
const F = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\media\\\\ffmpeg.ts";
let f = fs.readFileSync(F, 'utf8');
// 安全区：y 5%–22%，左右交替 8% / 自适应
f = f.replace("const xExpr = 'if(lt(t,' + (Number(startSec) + 0.45).toFixed(2) + '), W-(W-w)*(t-' + startSec + ')/0.45, (W-w)/2)';",
  "const side = i % 2 === 0 ? '0.06*W' : 'W-w-0.06*W';\n    const xExpr = 'if(lt(t,' + (Number(startSec) + 0.45).toFixed(2) + '), W-(W-w)*(t-' + startSec + ')/0.45, ' + side + ')';");
f = f.replace(":y=' + q + 'H*0.06+8*sin(6*t)' + q", ":y=' + q + 'H*0.05+6*sin(6*t)' + q");
fs.writeFileSync(F, f);
console.log('huazi safe-area rules');
