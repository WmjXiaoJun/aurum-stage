/** 中台集成测试：直接用 Fastify inject，不占端口、不依赖外部服务 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AURUM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-test-'));
process.env.SCHEDULER_ENABLED = 'false';
process.env.AURUM_LOG_LEVEL = 'error';

const { buildApp } = await import('../src/app.js');
const { runSeed } = await import('../src/db/seed.js');
const app = await buildApp();
await runSeed();
await app.ready();

test('health 与 meta 暴露产品常量', async () => {
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  const meta = await app.inject({ method: 'GET', url: '/api/v1/meta' });
  const body = meta.json();
  assert.equal(body.product.name, '玄枢・AURUM');
  assert.equal(body.constants.segment_cap_sec, 300);
  assert.ok(body.styles.length === 4);
  assert.ok(body.error_codes.some((e: { code: string }) => e.code === 'SEGMENT_DURATION_EXCEED'));
});

test('错误信封统一为 {ok:false,error:{code,ui_hint}}', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/projects/999999' });
  assert.equal(res.statusCode, 404);
  const body = res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.ok(body.error.ui_hint.length > 0);
});

test('台本解析 → 环节/镜头落库 → 段时长合规', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    payload: { name: '集成测试项目', variety_type: 'talk_show', visual_style: 'photoreal' }
  });
  const project = created.json();
  const md = '# 测试\n\n## 第一轮\n【阿哲】你好，今天聊综艺。\n【小满】（笑）好呀。\n';
  const script = await app.inject({ method: 'POST', url: '/api/v1/projects/' + project.id + '/scripts', payload: { raw_md: md } });
  const parsed = await app.inject({ method: 'POST', url: '/api/v1/scripts/' + script.json().id + '/parse', payload: { use_llm: false } });
  assert.equal(parsed.statusCode, 200);
  const result = parsed.json();
  assert.ok(result.shots.length >= 2);
  assert.equal(result.compliance.length, 1);

  const overview = await app.inject({ method: 'GET', url: '/api/v1/projects/' + project.id + '/overview' });
  const ov = overview.json();
  assert.equal(ov.stats.segments, 1);
  assert.ok(ov.stats.duration_ms > 0);
  assert.equal(ov.stats.exceed, 0);
});

test('超 300 秒时提交渲染被 SEGMENT_DURATION_EXCEED 阻断（不建任务）', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: '超限项目' } });
  const project = created.json();
  const md = '# 超长\n\n## 长段\n【阿哲】短句。\n';
  const script = await app.inject({ method: 'POST', url: '/api/v1/projects/' + project.id + '/scripts', payload: { raw_md: md } });
  const parsed = await app.inject({ method: 'POST', url: '/api/v1/scripts/' + script.json().id + '/parse', payload: { use_llm: false } });
  const shot = parsed.json().shots[0];
  const longLine = '压测台词'.repeat(400);
  await app.inject({ method: 'PATCH', url: '/api/v1/shots/' + shot.id, payload: { lines: [longLine] } });

  const blocked = await app.inject({ method: 'POST', url: '/api/v1/shots/' + shot.id + '/render', payload: {} });
  assert.equal(blocked.statusCode, 422);
  assert.equal(blocked.json().error.code, 'SEGMENT_DURATION_EXCEED');
  assert.ok(blocked.json().error.details.exceed_sec > 0);

  const tasks = await app.inject({ method: 'GET', url: '/api/v1/tasks?project_id=' + project.id });
  assert.equal(tasks.json().length, 0, '超限不应产生任何任务');
});

test('幂等：同参数重复提交返回同一任务（IDEMPOTENT_REPLAY）', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: '幂等项目' } });
  const project = created.json();
  const md = '# 幂等\n\n## 一轮\n【阿哲】测试幂等键。\n';
  const script = await app.inject({ method: 'POST', url: '/api/v1/projects/' + project.id + '/scripts', payload: { raw_md: md } });
  const parsed = await app.inject({ method: 'POST', url: '/api/v1/scripts/' + script.json().id + '/parse', payload: { use_llm: false } });
  const shot = parsed.json().shots[0];
  const first = await app.inject({ method: 'POST', url: '/api/v1/shots/' + shot.id + '/render', payload: {} });
  const second = await app.inject({ method: 'POST', url: '/api/v1/shots/' + shot.id + '/render', payload: {} });
  assert.equal(first.statusCode, 200);
  assert.ok(second.json().replays.length >= 1, '重复提交应命中幂等键');
});

test('智能体流水线（规则引擎）可从创意产出可落地的台本', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: '智能体项目', variety_type: 'talk_show' } });
  const project = created.json();
  const run = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/' + project.id + '/agents/run',
    payload: { source_text: '三个创业者聊为什么 AI 产品死在 Demo 阶段。', target_sec: 120, auto_run: false }
  });
  const runId = run.json().id;
  for (const stage of ['characters', 'outline', 'script', 'casting', 'storyboard', 'qa']) {
    const step = await app.inject({ method: 'POST', url: '/api/v1/agents/runs/' + runId + '/step', payload: { stage } });
    assert.equal(step.statusCode, 200, '阶段 ' + stage + ' 应成功：' + JSON.stringify(step.json()));
  }
  const applied = await app.inject({ method: 'POST', url: '/api/v1/agents/runs/' + runId + '/apply', payload: {} });
  assert.equal(applied.statusCode, 200);
  assert.ok(applied.json().shots >= 5);

  const overview = await app.inject({ method: 'GET', url: '/api/v1/projects/' + project.id + '/overview' });
  assert.ok(overview.json().stats.shots >= 5);
  assert.ok(overview.json().compliance.every((c: { exceed: boolean }) => !c.exceed));
});

test('关闭 app', async () => {
  await app.close();
});
