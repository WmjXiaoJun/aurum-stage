import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\pages\\CharactersLibrary.tsx";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("{(data as LibCharacter[]).map((c) => (", "{(data as unknown as LibCharacter[]).map((c) => (");
fs.writeFileSync(p, s);
console.log('fixed');
