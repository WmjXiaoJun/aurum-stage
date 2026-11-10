import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\skills.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("import { badRequest } from '../http/errors.js';", "import { badRequest } from '../http/errors.js';\nimport { runDevelopmentPack } from '../domain/development-pack.js';");
fs.writeFileSync(p, s);
console.log('imported');
