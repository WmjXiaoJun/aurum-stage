const r = await fetch('http://127.0.0.1:8787/api/v1/projects/45/skills/variety-storyboard/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: '严格每镜 2–5 秒（不得出现 6 秒），每段 ≤15 秒；lines_sec 必须 ≤ 镜头时长；景别只用 特写/近景/中景/全景/空镜。' }) });
const j = await r.json();
console.log(j.status, (j.gates||[]).map(g => (g.pass?'PASS':'FAIL') + ':' + g.label + ' ' + g.detail).join(' | '));
