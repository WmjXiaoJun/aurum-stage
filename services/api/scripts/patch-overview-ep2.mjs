import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\\\api\\\\src\\\\routes\\\\projects.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('mapSegment')) {
  s = s.replace("import { composeProject, listExports, recordExport } from '../adapters/compose.js';", "import { composeProject, listExports, recordExport } from '../adapters/compose.js';\nimport { mapSegment, mapShot } from '../domain/mappers.js';\nimport { listEpisodes } from '../domain/episode-service.js';");
  s = s.replace("all('SELECT * FROM segment WHERE project_id = ? AND episode_id = ? ORDER BY seq', [id, episodeId]).map(mapSegment)", "all('SELECT * FROM segment WHERE project_id = ? AND episode_id = ? ORDER BY seq', [id, episodeId]).map((r) => mapSegment(r))");
  s = s.replace("all('SELECT s.* FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.project_id = ? AND g.episode_id = ? ORDER BY g.seq, s.seq', [id, episodeId]).map(mapShot)", "all<Record<string, unknown>>('SELECT s.* FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.project_id = ? AND g.episode_id = ? ORDER BY g.seq, s.seq', [id, episodeId]).map((r) => mapShot(r))");
  fs.writeFileSync(p, s);
  console.log('imports added');
} else console.log('already');
