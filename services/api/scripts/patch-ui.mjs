import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function patchFile(rel, fn) { const p = W + rel; let s = fs.readFileSync(p, 'utf8'); const out = fn(s); if (out !== s) { fs.writeFileSync(p, out); console.log('patched', rel); } else console.log('nochange', rel); }

patchFile('components\\Layout.tsx', (s) => s
  .replace("const GLOBAL_NAV: NavItem[] = [\n  { key: '/projects', label: '项目', icon: 'dashboard' },\n  { key: '/models', label: '模型设置', icon: 'model' },\n  { key: '/nodes', label: 'GPU 节点', icon: 'node' },\n  { key: '/templates', label: '模板库', icon: 'template' },\n  { key: '/settings', label: '系统设置', icon: 'settings' }\n];",
    "const GLOBAL_NAV: NavItem[] = [\n  { key: '/projects', label: '项目库', icon: 'dashboard' },\n  { key: '/characters', label: '角色库', icon: 'user' },\n  { key: '/templates', label: '模板库', icon: 'template' },\n  { key: '/models', label: '模型设置', icon: 'model' },\n  { key: '/nodes', label: 'GPU 节点', icon: 'node' },\n  { key: '/settings', label: '系统设置', icon: 'settings' }\n];")
  .replace("  { key: 'voices', label: '音色资产', icon: 'voice' },\n  { key: 'characters', label: '角色资产', icon: 'user' },\n  { key: 'tasks', label: '任务', icon: 'task' },\n  { key: 'agent', label: '智能体', icon: 'agent' },\n  { key: 'styles', label: '视觉风格', icon: 'style' },\n  { key: 'comic', label: '漫画工作台', icon: 'comic' },\n  { key: 'qa', label: '质检中心', icon: 'qa' },\n  { key: 'export', label: '导出', icon: 'export' }",
    "  { key: 'script', label: '台本', icon: 'script' },\n  { key: 'voices', label: '配音', icon: 'voice' },\n  { key: 'characters', label: '角色', icon: 'user' },\n  { key: 'tasks', label: '任务', icon: 'task' },\n  { key: 'agent', label: '智能体', icon: 'agent' },\n  { key: 'qa', label: '质检', icon: 'qa' },\n  { key: 'export', label: '成片导出', icon: 'export' }")
);

patchFile('App.tsx', (s) => s
  .replace("import { CharactersPage } from './pages/Characters';", "import { CharactersPage } from './pages/Characters';\nimport { CharactersLibraryPage } from './pages/CharactersLibrary';")
  .replace("  const globalPages: Record<string, React.ReactElement> = {", "  if (first === 'characters') { return (<><Layout project={null} active={'/characters'}><CharactersLibraryPage /></Layout><Toasts /></>); }\n\n  const globalPages: Record<string, React.ReactElement> = {")
);
