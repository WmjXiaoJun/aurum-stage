/**
 * 端到端冒烟脚本：node scripts/smoke.mjs
 * 覆盖：项目创建 → 智能体流水线 → 落地 → 渲染 DAG → 段时长硬约束 → 合成导出
 */
const base = process.env.AURUM_API ?? 'http://127.0.0.1:8787/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  const res = await fetch(base + path, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
  return { status: res.status, body };
}
const H = { 'Content-Type': 'application/json' };

async function main() {
  const health = await api('/health');
  console.log('1. health           ', health.status, health.body.ffmpeg ? 'ffmpeg=on' : 'ffmpeg=off');

  const proj = await api('/projects', {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: 'AI 微综艺 · 创业者的第 101 次复盘', variety_type: 'talk_show', visual_style: 'photoreal' })
  });
  console.log('2. create project   ', proj.status, 'id=' + proj.body.id);
  const pid = proj.body.id;

  const run = await api('/projects/' + pid + '/agents/run', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      source_text: '三个连续创业者聊为什么九成 AI 产品死在 Demo 阶段：他们在融资、招人、定义需求上三次翻车，最后用一周做出了能卖的东西。',
      target_sec: 180, auto_run: true
    })
  });
  console.log('3. agent run start  ', run.status, 'run=' + run.body.id);

  let stages = '';
  for (let i = 0; i < 60; i++) {
    await sleep(600);
    const st = await api('/agents/runs/' + run.body.id);
    stages = st.body.stages.map((s) => s.stage + ':' + s.status).join(' ');
    if (['ready', 'applied', 'failed'].includes(st.body.status)) {
      console.log('4. agent pipeline   ', st.body.status, '|', stages);
      break;
    }
  }

  const apply = await api('/agents/runs/' + run.body.id + '/apply', { method: 'POST', headers: H, body: '{}' });
  console.log('5. apply to project ', apply.status, JSON.stringify(apply.body).slice(0, 200));

  const ov = await api('/projects/' + pid + '/overview');
  console.log('6. overview         ', 'segments=' + ov.body.segments.length, 'shots=' + ov.body.shots.length,
    'duration=' + (ov.body.stats.duration_ms / 1000).toFixed(1) + 's');
  console.log('   compliance       ', ov.body.compliance.map((c) => c.title + '=' + c.duration_sec + 's/' + c.status).join(' | '));

  const target = ov.body.shots.find((s) => s.lines.length > 0);
  const render = await api('/shots/' + target.id + '/render', { method: 'POST', headers: H, body: JSON.stringify({ candidates: 3 }) });
  console.log('7. render submit    ', render.status, JSON.stringify(render.body).slice(0, 220));
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const tasks = await api('/shots/' + target.id + '/tasks');
    if (tasks.body.every((t) => ['success', 'failed', 'blocked', 'canceled'].includes(t.status))) {
      console.log('8. task dag         ', tasks.body.map((t) => t.task_type + ':' + t.status).join(' → '));
      break;
    }
  }
  const detail = await api('/shots/' + target.id);
  console.log('9. shot artifacts   ', 'status=' + detail.body.shot.status,
    'tts=' + detail.body.shot.tts_duration_ms + 'ms',
    'video=' + detail.body.shot.preview_asset_id,
    'lipsync=' + detail.body.shot.lipsync_asset_id,
    'candidates=' + detail.body.audio_candidates.length);

  const segs = await api('/projects/' + pid + '/segments');
  const compose = await api('/projects/' + pid + '/compose', { method: 'POST', headers: H, body: JSON.stringify({ segment_id: segs.body[0].id }) });
  console.log('10. compose          ', compose.status, compose.body.mode, compose.body.duration_sec + 's',
    compose.body.video_url ?? '(manifest only)');

  // 300 秒硬约束
  const segId = segs.body[0].id;
  const longLine = Array.from({ length: 40 }, (_, i) => '压测段时长硬约束的台词编号' + i + '，验证超过三百秒是否阻断提交。').join('');
  for (let i = 0; i < 6; i++) {
    await api('/segments/' + segId + '/shots', {
      method: 'POST', headers: H,
      body: JSON.stringify({ lines: [longLine], speaker_role_id: 'c_host', speaker_name: '阿哲', render_engine: 'comfy_h3' })
    });
  }
  const comp = await api('/projects/' + pid + '/compliance');
  console.log('11. cap check        ', comp.body.items.map((c) => c.title + '=' + c.duration_sec + 's/' + c.status).join(' | '));
  const shots = await api('/projects/' + pid + '/shots?segment_id=' + segId);
  const last = shots.body[shots.body.length - 1];
  const blocked = await api('/shots/' + last.id + '/render', { method: 'POST', headers: H, body: '{}' });
  console.log('12. blocked render   ', blocked.status, blocked.body.error ? blocked.body.error.code : 'NOT BLOCKED');
  process.exit(0);
}

main().catch((e) => { console.error('SMOKE FAILED', e); process.exit(1); });
