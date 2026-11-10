import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\\\projects.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('episode_id')) {
  s = s.replace("  app.get('/projects/:id/overview', async (req) => {\n    const id = Number((req.params as { id: string }).id);\n    const project = getProject(id);\n    const segments = listSegments(id);\n    const shots = listShots(id);",
`  app.get('/projects/:id/overview', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const episodeId = Number((req.query as { episode_id?: string }).episode_id ?? 0);
    const project = getProject(id);
    const segments = episodeId
      ? all('SELECT * FROM segment WHERE project_id = ? AND episode_id = ? ORDER BY seq', [id, episodeId]).map(mapSegment)
      : listSegments(id);
    const shots = episodeId
      ? all('SELECT s.* FROM round_shot s JOIN segment g ON g.id = s.segment_id WHERE s.project_id = ? AND g.episode_id = ? ORDER BY g.seq, s.seq', [id, episodeId]).map(mapShot)
      : listShots(id);`);
  s = s.replace("    return {\n      project,\n      segments,", "    return {\n      project,\n      episodes: listEpisodes(id),\n      segments,");
  if (!s.includes("listEpisodes")) s = s.replace("import { listSegments, listShots", "import { listEpisodes } from '../domain/episode-service.js';\nimport { listSegments, listShots");
  fs.writeFileSync(p, s);
  console.log('overview episode filter added');
} else console.log('already');
