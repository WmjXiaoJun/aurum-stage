import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\huazi.ts";
let s = fs.readFileSync(p, 'utf8');
// 去掉白色高光条
s = s.replace("  .shine{position:absolute;left:0;right:0;top:6%;height:34%;background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,0));mix-blend-mode:screen;border-radius:40%}\n", "");
s = s.replace("<div class=\"shine\" style=\"top:12%\"></div>", "");
// 字号按字数自适应，描边细一点，阴影实一点
s = s.replace("font-size:96px;letter-spacing:2px;", "font-size:' + (text.length > 7 ? 74 : text.length > 5 ? 86 : 100) + 'px;letter-spacing:2px;");
s = s.replace("-webkit-text-stroke:6px \undefined;", "-webkit-text-stroke:4px \undefined;");
s = s.replace("filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}", "filter:drop-shadow(0 4px 6px rgba(0,0,0,.5))}");
s = s.replace("for (let i = 0; i < 10; i++)", "for (let i = 0; i < 8; i++)");
s = s.replace("const d = 10 - i;", "const d = 8 - i;");
s = s.replace("if (clean.length < 3 || clean.length > 12) continue;", "if (clean.length < 2 || clean.length > 8) continue;");
fs.writeFileSync(p, s);
console.log('huazi tuned');
