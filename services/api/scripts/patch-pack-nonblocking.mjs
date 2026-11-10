import fs from 'node:fs';
const P = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\domain\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }
pf(P + 'development-pack.ts', (s) => {
  if (s.includes('NON_BLOCKING')) return s;
  return s.replace("const CAMERA_MAP:", "const NON_BLOCKING = ['variety-art', 'variety-refs'];\n\nconst CAMERA_MAP:")
    .replace("    if (res.status !== 'passed') {\n      return { ok: false, stopped_at: step.name, steps };\n    }", "    if (res.status !== 'passed' && !NON_BLOCKING.includes(step.key)) {\n      return { ok: false, stopped_at: step.name, steps };\n    }");
});
pf(P + 'skills-service.ts', (s) => s.replace(
  "      const chars = asArray(body.characters) as Array<Record<string, unknown>>;\n      const few = chars.filter((c) => asArray(c.refs).length < 3).map((c) => str(c.name));",
  "      const chars = (asArray(body.characters).length ? asArray(body.characters) : asArray(body.items)) as Array<Record<string, unknown>>;\n      const few = chars.filter((c) => asArray(c.refs).length < 3).map((c) => str(c.name));"
).replace(
  "        { id: 'refs-angles', label: '每角色 ≥3 角度', pass: chars.length > 0 && few.length === 0, detail: few.length ? '不足：' + few.join('、') : '齐全' },",
  "        { id: 'refs-angles', label: '每角色 ≥3 角度', pass: chars.length > 0 && few.length === 0, detail: chars.length === 0 ? '缺少 characters 字段' : few.length ? '不足：' + few.join('、') : '齐全' },"
));
