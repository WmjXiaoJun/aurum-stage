import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\projects.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("from '../domain/mappers.js'")) {
  s = s.replace("import { composeProject, listExports, recordExport } from '../adapters/compose.js';", "import { composeProject, listExports, recordExport } from '../adapters/compose.js';\nimport { mapSegment, mapShot } from '../domain/mappers.js';\nimport { listEpisodes } from '../domain/episode-service.js';");
  fs.writeFileSync(p, s);
  console.log('imports added');
} else console.log('has imports');
