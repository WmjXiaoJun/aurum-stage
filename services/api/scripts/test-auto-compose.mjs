/** 自动成片验证：两镜渲染完 → 自动排队合成 → 导出登记 */
const API = 'http://127.0.0.1:8787/api/v1';
async function api(p, init) { const r = await fetch(API + p, init); const t = await r.text(); if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + t.slice(0, 200)); return t ? JSON.parse(t) : null; }
const applied = await api('/templates/show_tonight_show/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '自动成片测试 · 深夜秀', visual_style: 'photoreal' }) });
const projectId = applied.project_id;
await api('/projects/' + projectId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto_compose: true }) });
console.log('project', projectId, 'auto_compose on');
const shots = await api('/projects/' + projectId + '/shots');
for (const s of shots) await api('/shots/' + s.id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
console.log('submitted', shots.length, 'shots');
const deadline = Date.now() + 25 * 60 * 1000;
let last = '';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10000));
  const tasks = await api('/projects/' + projectId + '/tasks');
  const summary = tasks.map((t) => t.task_type + ':' + t.status).join(' ');
  if (summary !== last) { console.log(summary); last = summary; }
  const exports = await api('/projects/' + projectId + '/exports');
  if (exports.length) { console.log('EXPORT', JSON.stringify(exports[0]).slice(0, 220)); break; }
  const compose = tasks.find((t) => t.task_type === 'compose');
  if (compose && compose.status === 'failed') { console.log('compose failed', compose.error_msg); break; }
}
process.exit(0);
