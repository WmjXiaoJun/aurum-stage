/** 首次演示数据增强：渲染若干镜头并合成一段，让总览页有真实产物（不影响功能正确性） */
const base = process.env.AURUM_API ?? 'http://127.0.0.1:8787/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, init) {
  const res = await fetch(base + path, init);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}
const H = { 'Content-Type': 'application/json' };

const projects = await api('/projects');
const demo = (projects.body ?? []).find((p) => p.name.includes('圆桌派')) ?? projects.body?.[0];
if (!demo) { console.log('没有可增强的项目'); process.exit(0); }

const ov = await api('/projects/' + demo.id + '/overview');
const shots = (ov.body.shots ?? []).filter((s) => (s.lines ?? []).length > 0).slice(0, 6);
console.log('渲染镜头：' + shots.map((s) => s.shot_code).join(', '));
for (const s of shots) {
  const res = await api('/shots/' + s.id + '/render', { method: 'POST', headers: H, body: JSON.stringify({ candidates: 3 }) });
  console.log('  submit', s.shot_code, res.status);
}

for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const tasks = await api('/tasks?project_id=' + demo.id);
  const running = (tasks.body ?? []).filter((t) => ['pending', 'assigned', 'running'].includes(t.status)).length;
  if (i % 6 === 0) console.log('  等待任务…剩余', running);
  if (running === 0) break;
}

const segments = (await api('/projects/' + demo.id + '/segments')).body ?? [];
const target = segments.find((s) => s.seq === 2) ?? segments[0];
const compose = await api('/projects/' + demo.id + '/compose', { method: 'POST', headers: H, body: JSON.stringify({ segment_id: target?.id, bgm: true }) });
console.log('合成：', compose.status, compose.body.mode, compose.body.duration_sec + 's', compose.body.video_url ?? '');
const final = await api('/projects/' + demo.id + '/overview');
console.log('完成：镜头', final.body.stats.shots, '已生成', final.body.stats.generated, '总时长', (final.body.stats.duration_ms / 1000).toFixed(1) + 's');
process.exit(0);
