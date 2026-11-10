import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\\\index.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('registerEpisodeRoutes')) {
  s = s.replace("import { registerSkillRoutes } from './skills.js';", "import { registerSkillRoutes } from './skills.js';\nimport { registerEpisodeRoutes } from './episodes.js';");
  s = s.replace("  await registerSkillRoutes(scope);", "  await registerSkillRoutes(scope);\n  await registerEpisodeRoutes(scope);");
  fs.writeFileSync(p, s);
  console.log('episode routes registered');
} else console.log('already');
