import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\engineering.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("import { all, json } from '../db/index.js';", "import { all, json } from '../db/index.js';\nimport { badRequest } from '../http/errors.js';");
fs.writeFileSync(p, s);
console.log('done');
