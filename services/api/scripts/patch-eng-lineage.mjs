import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\domain\\engineering-service.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('latestEngineering(projectId)?.body')) {
  s = s.replace("  saveEngineering(projectId, 'draft', lineage);\n  const eng = buildEngineering(projectId, 'draft');\n  return { project_id: projectId, engineering: eng };",
    "  saveEngineering(projectId, 'draft', lineage);\n  const stored = latestEngineering(projectId);\n  return { project_id: projectId, engineering: (stored?.body ?? buildEngineering(projectId, 'draft')) as unknown as EngineeringBody };");
  fs.writeFileSync(p, s);
  console.log('patched');
} else console.log('already');
