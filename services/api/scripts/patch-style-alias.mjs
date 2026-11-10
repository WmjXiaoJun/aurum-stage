import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\domain\\engineering-service.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("const styleMap: Record<string, string> = { realistic: 'photoreal', '2d': 'anime_2d', '3d': 'cgi_3d', comic: 'comic' };",
  "const styleMap: Record<string, string> = { realistic: 'photoreal', photoreal: 'photoreal', '2d': 'anime_2d', anime_2d: 'anime_2d', '3d': 'cgi_3d', cgi_3d: 'cgi_3d', comic: 'comic' };");
fs.writeFileSync(p, s);
console.log('aliases ok');
