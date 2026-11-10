import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/engine/script-parser.js';

const MD = `# 测试圆桌

## 开场片花
【空镜】赛博城市夜景推镜
【花字】这一期聊点真话

## 第一轮 · 具体的人
【主持人·阿哲】今天只聊一件具体的事。
【嘉宾·林小满】（笑）我先说结论，能替掉的是体力活。
【徐不器】（停顿半秒）我不同意。

## 收尾
【主持人·阿哲】下期见。
`;

test('台本解析：环节 / 镜头 / 空镜 / 花字', () => {
  const result = parseScript(MD, { projectId: 1, varietyType: 'talk_show', visualStyle: 'photoreal' });
  assert.equal(result.structured.global.title, '测试圆桌');
  assert.equal(result.structured.segments.length, 3);

  const opening = result.structured.segments[0];
  assert.equal(opening.segment_type, 'opening_flash');
  assert.equal(opening.rounds.length, 1);
  assert.equal(opening.rounds[0].camera, 'empty_shot');
  assert.equal(opening.rounds[0].lines.length, 0, '空镜不应有台词');
  assert.ok(opening.rounds.some((r) => r.overlays.some((o) => o.type === 'flower')), '花字应转成 flower overlay');
  assert.ok(opening.rounds[0].overlays.some((o) => o.type === 'title_card'));

  const talk = result.structured.segments[1];
  assert.equal(talk.segment_type, 'talk_round');
  assert.equal(talk.rounds.length, 3);
  const [first, second, third] = talk.rounds;
  assert.ok(first && second && third, '应有 3 个镜头');
  assert.equal(first.speaker_name, '阿哲');
  assert.equal(second.speaker_name, '林小满');
  assert.equal(second.emotion, 'friendly_smile');
  assert.equal(third.speaker_name, '徐不器');
  assert.ok((third.emotion_instruction ?? '').length > 0, '每个镜头都应有可执行的情绪指令');
  assert.ok((third.performance_tags ?? []).some((t) => t.tag === 'pause'), '停顿标签应保留在 performance_tags');
  assert.ok((talk.rounds[0].target_duration_ms ?? 0) >= 1200);
});

test('机位推断：短句特写、长句中景、无台词空镜', () => {
  const result = parseScript(MD, { projectId: 1, varietyType: 'talk_show', visualStyle: 'photoreal' });
  const rounds = result.structured.segments[1].rounds;
  const head = rounds[0];
  assert.ok(head, '应有首个镜头');
  assert.ok(['close_up', 'medium_close_up'].includes(head.camera));
  assert.equal(head.lipsync_required, true, '特写说话人应触发 lip-sync');
});

test('角色绑定：传入角色表时命中 role_id', () => {
  const result = parseScript(MD, {
    projectId: 1,
    varietyType: 'talk_show',
    visualStyle: 'photoreal',
    characters: [{ role_id: 'c_host', name: '阿哲' }]
  });
  assert.equal(result.structured.segments[1].rounds[0].speaker_role_id, 'c_host');
});

test('内嵌 JSON 台本可直接解析', () => {
  const json = JSON.stringify({
    global: { title: '直接结构化' },
    segments: [{ segment_id: 's_01', segment_type: 'talk_round', title: '一轮', default_engine: 'comfy_h3', rounds: [{ round_id: 'r1', camera: 'medium_shot', lines: ['你好'], visual_prompt: '演播厅' }] }]
  });
  const result = parseScript('说明\n\n```json\n' + json + '\n```\n', { projectId: 1, varietyType: 'talk_show', visualStyle: 'photoreal' });
  assert.equal(result.report.source, 'embedded_json');
  assert.equal(result.structured.segments.length, 1);
});

test('空台本给出阻断错误而非静默成功', () => {
  const result = parseScript('   ', { projectId: 1, varietyType: 'talk_show', visualStyle: 'photoreal' });
  assert.equal(result.structured.segments.length, 0);
  assert.ok(result.report.errors.some((e) => e.code === 'SCRIPT_EMPTY'));
});
