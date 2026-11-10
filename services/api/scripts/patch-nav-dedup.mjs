import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\components\\Layout.tsx";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("  { key: 'script', label: '台本', icon: 'script' },\n", "");
s = s.replace("{ key: 'script', label: '台本编辑', icon: 'script' }", "{ key: 'script', label: '台本', icon: 'script' }");
fs.writeFileSync(p, s);
console.log('nav dedup');
