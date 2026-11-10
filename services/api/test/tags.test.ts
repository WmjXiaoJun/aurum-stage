import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanForTTS, intToChinese, lookupTag, normalizeNumbers, parseLine, isPronounceable } from '@aurum/core';

test('内联表演标签：笑 / 停顿 / 压低声音 / 语速', () => {
  const laugh = parseLine('（笑）欢迎来到节目');
  assert.equal(laugh.tags[0].tag, 'laugh_in');
  assert.equal(laugh.clean_text, '欢迎来到节目');

  const pause = parseLine('欢迎来到（停顿两秒）节目');
  assert.equal(pause.tags[0].tag, 'pause');
  assert.equal(pause.tags[0].value, 2);

  const whisper = parseLine('（压低声音）这句我只说一次');
  assert.equal(whisper.tags[0].tag, 'whisper');

  const speed = parseLine('（加快）三二一开拍');
  assert.equal(speed.tags[0].tag, 'speed');
  assert.equal(speed.tags[0].value, 1.2);
});

test('括号必须配对闭合，不闭合当普通文本（防吞正文）', () => {
  const parsed = parseLine('（我们今天聊一个很长的话题，但括号没有闭合');
  assert.equal(parsed.tags.length, 0);
  assert.equal(parsed.emotion_instruction_extra, '');
  assert.ok(parsed.clean_text.includes('（我们今天聊'));
  assert.ok(parsed.warnings.length > 0);
});

test('未命中标签的括号内容保留为情绪补充（交模型自然语言理解）', () => {
  const parsed = parseLine('（语气要像老朋友聊天）我们开始吧');
  assert.equal(parsed.emotion_instruction_extra, '语气要像老朋友聊天');
  assert.equal(parsed.clean_text, '我们开始吧');
});

test('半停顿与毫秒写法', () => {
  const half = parseLine('嗯（停顿半秒）好');
  assert.equal(half.tags[0].value, 0.5);
  const ms = lookupTag('停顿 800毫秒');
  assert.equal(ms?.tag, 'pause');
  assert.ok(Math.abs(Number(ms?.value) - 0.8) < 0.001);
});

test('数字清洗：年份逐位、百分比语义、普通整数', () => {
  assert.equal(normalizeNumbers('2026年我们做微综艺'), '二零二六年我们做微综艺');
  assert.equal(normalizeNumbers('转化率 35%'), '转化率 百分之三十五');
  assert.equal(intToChinese(300), '三百');
  assert.equal(intToChinese(13), '十三');
});

test('可发音自检：乱码文本触发 TTS_TEXT_INVALID 判定', () => {
  assert.equal(isPronounceable('正常的中文台词').ok, true);
  assert.equal(isPronounceable('※※※※').ok, false);
});

test('cleanForTTS 汇总停顿并输出可朗读文本', () => {
  const res = cleanForTTS('（停顿一秒）第 3 期（笑）我们聊聊 AI');
  assert.ok(res.pause_ms >= 1000);
  assert.ok(!/[0-9]/.test(res.text), '数字应被清洗为中文读法：' + res.text);
  assert.ok(res.text.includes('三'), res.text);
  assert.ok(res.tags.some((t) => t.tag === 'laugh_in'));
});
