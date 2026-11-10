import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\scripts\\expand-to-45.mjs";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("select api_keys from llm_provider where provider='deepseek' limit 1", "select api_keys from llm_provider where provider_key='deepseek' limit 1");
fs.writeFileSync(p, s);
console.log('provider fixed');
