import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\templates.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("from '../domain/project-service.js'")) {
  s = s.replace("import { mapTemplate } from '../domain/mappers.js';", "import { mapTemplate } from '../domain/mappers.js';\nimport { createProject } from '../domain/project-service.js';");
  fs.writeFileSync(p, s);
  console.log('import patched');
} else console.log('import ok');
