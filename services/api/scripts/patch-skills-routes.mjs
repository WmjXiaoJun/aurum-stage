import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\index.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('registerSkillRoutes')) {
  s = s.replace("import { registerEngineeringRoutes } from './engineering.js';", "import { registerEngineeringRoutes } from './engineering.js';\nimport { registerSkillRoutes } from './skills.js';");
  s = s.replace("  await registerEngineeringRoutes(scope);", "  await registerEngineeringRoutes(scope);\n  await registerSkillRoutes(scope);");
  fs.writeFileSync(p, s);
  console.log('skills registered');
} else console.log('already');
