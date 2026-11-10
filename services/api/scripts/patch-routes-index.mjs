import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\index.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("registerEngineeringRoutes")) {
  s = s.replace("import { registerTemplateRoutes } from './templates.js';", "import { registerTemplateRoutes } from './templates.js';\nimport { registerEngineeringRoutes } from './engineering.js';");
  s = s.replace("  await registerTemplateRoutes(scope);", "  await registerTemplateRoutes(scope);\n  await registerEngineeringRoutes(scope);");
  fs.writeFileSync(p, s);
  console.log('registered');
} else console.log('already');
