import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\lib\\api.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('characterLibrary')) {
  s = s.replace("  characters: (id: number) => request<import('./types').Character[]>('/projects/' + id + '/characters'),", "  characters: (id: number) => request<import('./types').Character[]>('/projects/' + id + '/characters'),\n  characterLibrary: () => request<Array<Record<string, unknown>>>('/characters'),\n  applyTemplate: (key: string, body: Record<string, unknown>) => request<{ project_id: number; template_key: string; visual_style: string; aspect: string }>('/templates/' + key + '/apply', { method: 'POST', body: JSON.stringify(body) }),");
  fs.writeFileSync(p, s);
  console.log('api patched');
} else console.log('api ok');
