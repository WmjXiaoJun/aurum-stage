import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function patchFile(rel, fn) { const p = W + rel; let s = fs.readFileSync(p, 'utf8'); const out = fn(s); if (out !== s) { fs.writeFileSync(p, out); console.log('patched', rel); } else console.log('nochange', rel); }

patchFile('lib\\api.ts', (s) => {
  if (s.includes('rebuildEngineering')) return s;
  return s.replace(
    "  characterLibrary: () => request<Array<Record<string, unknown>>>('/characters'),",
    "  characterLibrary: () => request<Array<Record<string, unknown>>>('/characters'),\n  engineering: (id: number) => request<{ version: number; status: string; body: Record<string, unknown>; history: Array<Record<string, unknown>> }>('/projects/' + id + '/engineering'),\n  rebuildEngineering: (id: number, body: Record<string, unknown> = {}) => request<Record<string, unknown>>('/projects/' + id + '/engineering/rebuild', { method: 'POST', body: JSON.stringify(body) }),\n  cloneEngineering: (id: number, body: Record<string, unknown>) => request<{ project_id: number; engineering: Record<string, unknown> }>('/projects/' + id + '/engineering/clone', { method: 'POST', body: JSON.stringify(body) }),\n  abstractEngineering: (id: number) => request<{ template_key: string }>('/projects/' + id + '/engineering/abstract', { method: 'POST', body: '{}' }),"
  );
});

patchFile('App.tsx', (s) => {
  if (s.includes('EngineeringPage')) return s;
  return s.replace("import { ScriptPage } from './pages/Script';", "import { ScriptPage } from './pages/Script';\nimport { EngineeringPage } from './pages/Engineering';")
    .replace("      case 'timeline': return <TimelinePage projectId={projectId} />;", "      case 'timeline': return <TimelinePage projectId={projectId} />;\n      case 'engineering': return <EngineeringPage projectId={projectId} />;");
});

patchFile('components\\Layout.tsx', (s) => {
  if (s.includes("key: 'engineering'")) return s;
  return s.replace("  { key: 'timeline', label: '时间轴', icon: 'timeline' },", "  { key: 'timeline', label: '时间轴', icon: 'timeline' },\n  { key: 'engineering', label: '工程文件', icon: 'script' },");
});
