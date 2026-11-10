import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function patchFile(rel, fn) { const p = W + rel; let s = fs.readFileSync(p, 'utf8'); const out = fn(s); if (out !== s) { fs.writeFileSync(p, out); console.log('patched', rel); } else console.log('nochange', rel); }

// 模板：综艺形态排在最前
patchFile('pages\\Templates.tsx', (s) => s.replace(
  "  const { data, loading, error, reload } = useAsync(() => api.templates(type === 'all' ? undefined : type), [type]);",
  "  const { data: rawData, loading, error, reload } = useAsync(() => api.templates(type === 'all' ? undefined : type), [type]);\n  const data = [...(rawData ?? [])].sort((a, b) => (a.template_type === 'variety_show' ? -1 : 0) - (b.template_type === 'variety_show' ? -1 : 0));"
).replace(
  "        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>\n          {(data ?? []).map((t) => (",
  "        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>\n          {data.map((t) => ("
));

// 角色页：加「查看角色库」入口
patchFile('pages\\Characters.tsx', (s) => s.replace(
  "        <Button kind=\"primary\" icon=\"plus\" onClick={() => setOpen(true)}>新建角色</Button>",
  "        <Button icon=\"user\" onClick={() => navigate('/characters')}>角色库</Button>\n        <Button kind=\"primary\" icon=\"plus\" onClick={() => setOpen(true)}>新建角色</Button>"
).replace(
  "import { ROLE_TYPE_LABEL, ANGLE_LABEL, styleName } from '../lib/zh';",
  "import { ROLE_TYPE_LABEL, ANGLE_LABEL, styleName } from '../lib/zh';\nimport { navigate } from '../lib/router';"
));
