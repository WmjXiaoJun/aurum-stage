import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSegment, shotEffectiveMs, segmentDuration } from '../src/engine/compliance.js';

const shot = (id: number, ms: number, tts: number | null = null) => ({
  id, segment_id: 1, seq: id, camera: 'medium_shot', tts_duration_ms: tts, duration_ms: ms
});

test('镜头有效时长优先用 TTS 真实时长 + 300ms 呼吸', () => {
  assert.equal(shotEffectiveMs(shot(1, 5000, 4200)), 4500);
  assert.equal(shotEffectiveMs(shot(2, 5000, null)), 5000);
  assert.equal(shotEffectiveMs({ ...shot(3, 0, null), target_duration_ms: 3300 }), 3300);
});

test('段时长 = 各镜头之和 + 镜头间 200ms 留白', () => {
  const total = segmentDuration([shot(1, 3000), shot(2, 2000), shot(3, 1000)]);
  assert.equal(total, 3000 + 2000 + 1000 + 400);
});

test('300 秒硬约束：合规 / 预警 / 超限三态', () => {
  const ok = evaluateSegment({ segment_id: 1, seq: 1, title: 'A', shots: [shot(1, 30_000)] });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.exceed, false);

  const near = evaluateSegment({ segment_id: 2, seq: 2, title: 'B', shots: [shot(1, 290_000)] });
  assert.equal(near.status, 'near');
  assert.equal(near.near_cap, true);

  const exceed = evaluateSegment({ segment_id: 3, seq: 3, title: 'C', shots: [shot(1, 200_000), shot(2, 150_000)] });
  assert.equal(exceed.status, 'exceed');
  assert.equal(exceed.exceed, true);
  assert.ok(exceed.exceed_sec > 49 && exceed.exceed_sec < 51);
  assert.ok(exceed.split_suggestion && exceed.split_suggestion.includes('拆分'));
});

test('超限时给出可执行的拆分位置建议', () => {
  const shots = Array.from({ length: 10 }, (_, i) => shot(i + 1, 45_000));
  const result = evaluateSegment({ segment_id: 9, seq: 1, title: '长段', shots });
  assert.equal(result.exceed, true);
  assert.ok(result.split_suggestion?.includes('镜头之间'));
});
