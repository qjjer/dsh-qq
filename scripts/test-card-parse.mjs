// 小程序 / Ark 卡片解析回归（离线，不联网）
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCardPayload, extractCardUrl, cardReadableText } from '../src/card-parse.js';

test('normalizeCardPayload：剥掉 data 字符串那一层', () => {
  const inner = JSON.stringify({ app: 'com.tencent.map', prompt: '[位置]某地' });
  const obj = normalizeCardPayload({ data: inner });
  assert.equal(obj.app, 'com.tencent.map');
  assert.equal(obj.prompt, '[位置]某地');
});

test('normalizeCardPayload：兼容直接给对象 / 直接给字符串', () => {
  assert.equal(normalizeCardPayload({ app: 'x' })?.app, 'x');
  assert.equal(normalizeCardPayload(JSON.stringify({ app: 'y' }))?.app, 'y');
  assert.equal(normalizeCardPayload({ data: '{坏' }), null, '坏 JSON 返回 null');
  assert.equal(normalizeCardPayload(null), null);
  assert.equal(normalizeCardPayload(''), null);
});

test('extractCardUrl：B 站链接优先', () => {
  const inner = JSON.stringify({
    app: 'com.tencent.miniapp_01',
    meta: {
      detail_1: {
        qqdocurl: 'https://www.bilibili.com/video/BV1GJ411x7h7?share_source=qq',
        other: 'https://example.com/foo',
      },
    },
  });
  const url = extractCardUrl({ data: inner });
  assert.ok(url.includes('bilibili.com'), `应优先 B 站链接，实际：${url}`);
  assert.ok(url.includes('BV1GJ411x7h7'));
});

test('extractCardUrl：没有 B 站时返回第一个链接', () => {
  const inner = JSON.stringify({ meta: { x: { url: 'https://example.com/a' } } });
  assert.equal(extractCardUrl({ data: inner }), 'https://example.com/a');
});

test('extractCardUrl：没有链接返回空串', () => {
  assert.equal(extractCardUrl({ data: JSON.stringify({ app: 'x', prompt: 'hi' }) }), '');
  assert.equal(extractCardUrl({}), '');
});

test('extractCardUrl：b23.tv 短链也能认', () => {
  const inner = JSON.stringify({ meta: { x: { u: 'https://b23.tv/AbCdEfG' } } });
  assert.equal(extractCardUrl({ data: inner }), 'https://b23.tv/AbCdEfG');
});

test('cardReadableText：用 prompt 作摘要', () => {
  const inner = JSON.stringify({ app: 'com.tencent.map', prompt: '[位置]RealLive And Books' });
  assert.equal(cardReadableText({ data: inner }), '[位置]RealLive And Books');
});

test('cardReadableText：没有 prompt 时回落 desc / title', () => {
  assert.equal(cardReadableText({ data: JSON.stringify({ desc: '描述文本' }) }), '描述文本');
  assert.equal(cardReadableText({ data: JSON.stringify({ title: '标题文本' }) }), '标题文本');
});

test('cardReadableText：只有 app 时给出占位', () => {
  assert.equal(cardReadableText({ data: JSON.stringify({ app: 'com.tencent.foo' }) }), '[com.tencent.foo]');
});

test('cardReadableText：摘要里带上链接（没被 prompt 覆盖时）', () => {
  const inner = JSON.stringify({
    app: 'x',
    prompt: '看看这个',
    meta: { a: { u: 'https://www.bilibili.com/video/BV1GJ411x7h7' } },
  });
  const text = cardReadableText({ data: inner });
  assert.ok(text.includes('看看这个'));
  assert.ok(text.includes('bilibili.com'), '链接要出现在摘要里，否则 AI 拿不到');
});

test('cardReadableText：空卡片返回空串（调用方回落 [卡片消息]）', () => {
  assert.equal(cardReadableText({}), '');
  assert.equal(cardReadableText(null), '');
  assert.equal(cardReadableText({ data: 'not json' }), '');
});
