const keys = ['variety-characters','variety-outline','variety-script','variety-staging','variety-storyboard','variety-art','variety-refs'];
for (const key of keys) {
  const t0 = Date.now();
  const r = await fetch('http://127.0.0.1:8787/api/v1/projects/45/skills/' + key + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: '玄枢深夜秀第一季：三位主持人聊 AI 与综艺导演，三期分别用二维、三维、写实三种画风，要有反转和泪点，单段不超过 300 秒。' }) });
  const j = await r.json();
  const pass = (j.gates || []).filter(g => g.pass).length;
  console.log('==', key, r.status, j.status, pass + '/' + (j.gates || []).length, Math.round((Date.now() - t0) / 1000) + 's');
  if (j.gates) for (const g of j.gates) if (!g.pass) console.log('   FAIL', g.label, g.detail);
}
