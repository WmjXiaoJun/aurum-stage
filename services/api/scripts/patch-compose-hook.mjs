import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\projects.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('saveEngineering')) {
  s = s.replace("import { localizeProject, restoreChinese } from '../domain/localize-service.js';", "import { localizeProject, restoreChinese } from '../domain/localize-service.js';\nimport { saveEngineering } from '../domain/engineering-service.js';");
  s = s.replace("    const result = await composeProject({ project_id: projectId, segment_id: body.segment_id ?? null, bgm: body.bgm !== false });", "    const result = await composeProject({ project_id: projectId, segment_id: body.segment_id ?? null, bgm: body.bgm !== false });\n    // 生产即模板：出片后自动把工程文件归档为可复刻版本\n    try { saveEngineering(projectId, 'renderable'); } catch { /* 工程归档失败不影响出片 */ }");
  fs.writeFileSync(p, s);
  console.log('hook added');
} else console.log('already');
