/** 一个模板三种风格出片：美式深夜秀 × 写实 / 二维 / 三维 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'http://127.0.0.1:8787/api/v1';
const OUT = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/templates';
fs.mkdirSync(OUT, { recursive: true });
const STYLES = [
  { id: 'photoreal', label: '写实', persona: '三十八岁的深夜秀主持人，西装、语速稳、爱抛梗', prefix: 'Chinese male late-night talk show host, navy suit, short black hair, warm studio light' },
  { id: 'anime_2d', label: '二维', persona: '二次元深夜秀主持人，元气、表情夸张、节奏快', prefix: '2d anime talk show host, colorful suit, big expressive eyes, cel shading' },
  { id: 'cgi_3d', label: '三维', persona: '三维卡通深夜秀主持人，圆润造型、光泽材质', prefix: 'stylized 3d cartoon talk show host, glossy materials, pixar style, big smile' }
];

async function api(pathname, init) {
  const res = await fetch(API + pathname, init);
  const text = await res.text();
  if (!res.ok) throw new Error(pathname + ' -> ' + res.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

async function waitTasks(projectId, taskIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const list = await api('/projects/' + projectId + '/tasks');
    const mine = list.filter((t) => taskIds.includes(t.id));
    if (mine.length && mine.every((t) => ['success', 'failed', 'canceled', 'timeout'].includes(t.status))) return mine;
  }
  return [];
}

const summary = [];
for (const st of STYLES) {
  console.log('==== ' + st.label);
  const applied = await api('/templates/show_tonight_show/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visual_style: st.id, name: '深夜秀 · ' + st.label + '版' })
  });
  const projectId = applied.project_id;
  console.log('project', projectId);
  const shots = await api('/projects/' + projectId + '/shots');
  const character = await api('/projects/' + projectId + '/characters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '主持人', role_type: 'host', persona: st.persona, prompt_prefix: st.prefix, seed: 20261108 })
  });
  console.log('character', character.id);
  try {
    const art = await api('/characters/' + character.id + '/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modes: ['portrait'], count: 1, style: st.id })
    });
    console.log('art', art.assets?.length ?? 0);
  } catch (e) { console.log('art failed', String(e).slice(0, 120)); }

  const taskIds = [];
  for (const shot of shots) {
    const dag = await api('/shots/' + shot.id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
    taskIds.push(...dag.task_dag.map((t) => t.task_id));
  }
  console.log('tasks', taskIds.join(','));
  const done = await waitTasks(projectId, taskIds, 20 * 60 * 1000);
  console.log('done', done.map((t) => t.task_type + ':' + t.status).join(' '));
  const composed = await api('/projects/' + projectId + '/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bgm: false }) });
  console.log('compose', composed.duration_sec + 's');
  const final = await api('/projects/' + projectId + '/exports');
  const latest = final[0];
  if (latest?.video_asset_id) {
    const buf = Buffer.from(await fetch(API + '/assets/' + latest.video_asset_id + '/raw').then((r) => r.arrayBuffer()));
    const dst = path.join(OUT, 'tonight_show_' + st.id + '.mp4');
    fs.writeFileSync(dst, buf);
    console.log('saved', dst, (buf.length / 1024 / 1024).toFixed(1) + 'MB');
    summary.push({ style: st.id, project_id: projectId, file: dst });
  }
}
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
