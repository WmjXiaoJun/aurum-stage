const base = 'http://127.0.0.1:8787/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = await fetch(base + '/projects/1/agents/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source_text: '三个连续创业者聊为什么九成 AI 产品死在 Demo 阶段：他们在融资、招人、定义需求上三次翻车，最后用一周做出能卖的东西。',
    goal: 'AI 圆桌派 · 第 2 期企划',
    target_sec: 180,
    auto_run: true
  })
}).then((r) => r.json());
console.log('run', run.id, run.status, run.stage);
for (let i = 0; i < 60; i++) {
  await sleep(700);
  const st = await fetch(base + '/agents/runs/' + run.id).then((r) => r.json());
  if (['ready', 'applied', 'failed'].includes(st.status)) {
    console.log('done', st.status, st.stages.map((s) => s.stage + ':' + s.status).join(' '));
    break;
  }
}
process.exit(0);
