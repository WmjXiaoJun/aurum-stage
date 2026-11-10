import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 路由：透传选项
pf(R + 'routes\\skills.ts', (s) => s.replace("    const body = (req.body ?? {}) as { brief?: string };\n    return runDevelopmentPack(projectId, String(body.brief ?? ''));",
  "    const body = (req.body ?? {}) as { brief?: string; withArt?: boolean; withRender?: boolean; render_limit?: number };\n    return runDevelopmentPack(projectId, String(body.brief ?? ''), { withArt: body.withArt, withRender: body.withRender, render_limit: body.render_limit });"));

// 客户端：批量复刻
pf(W + 'lib\\api.ts', (s) => s.includes('batchCloneEngineering') ? s : s.replace("  cloneEngineering: (id: number, body: Record<string, unknown>) =>",
  "  batchCloneEngineering: (id: number, body: Record<string, unknown>) => request<{ created: number[]; count: number }>('/projects/' + id + '/engineering/batch-clone', { method: 'POST', body: JSON.stringify(body) }),\n  cloneEngineering: (id: number, body: Record<string, unknown>) =>"));
