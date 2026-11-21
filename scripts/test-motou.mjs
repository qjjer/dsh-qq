// 摸头指令解析的离线回归（不联网）
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQQ, parseMotouCommand } from '../src/motou.js';

test('normalizeQQ：只收 5~12 位数字', () => {
  assert.equal(normalizeQQ('1669147530'), '1669147530');
  assert.equal(normalizeQQ(1669147530), '1669147530');
  assert.equal(normalizeQQ('1234'), null, '4 位太短');
  assert.equal(normalizeQQ('1234567890123'), null, '13 位太长');
  assert.equal(normalizeQQ('0123456'), null, '不能以 0 开头');
  assert.equal(normalizeQQ('abc'), null);
  assert.equal(normalizeQQ(''), null);
  assert.equal(normalizeQQ(null), null);
});

test('parseMotouCommand：@ 段优先', () => {
  const event = {
    message: [
      { type: 'text', data: { text: '摸头 ' } },
      { type: 'at', data: { qq: '1669147530' } },
    ],
  };
  assert.equal(parseMotouCommand(event, '摸头'), '1669147530');
});

test('parseMotouCommand：正文里写 QQ 号', () => {
  assert.equal(parseMotouCommand({ message: [] }, '摸头 1234567890'), '1234567890');
  assert.equal(parseMotouCommand({ message: [] }, 'rua 1669147530'), '1669147530');
  assert.equal(parseMotouCommand({ message: [] }, 'petpet 3429076619'), '3429076619');
});

test('parseMotouCommand：@all 不能用', () => {
  const event = { message: [{ type: 'at', data: { qq: 'all' } }] };
  assert.equal(parseMotouCommand(event, '摸头'), null);
});

test('parseMotouCommand：不是摸头指令返回 null', () => {
  const empty = { message: [] };
  assert.equal(parseMotouCommand(empty, '你好啊'), null);
  assert.equal(parseMotouCommand(empty, ''), null);
  assert.equal(parseMotouCommand(empty, '摸头杀是什么梗'), null, '指令词后面必须能拿到 QQ 号');
  assert.equal(parseMotouCommand(empty, '今天摸头了'), null, '不在开头不算');
  // 只在开头才触发（避免聊天里随便提到就发图）
  assert.equal(parseMotouCommand(empty, '我觉得摸头 1234567890'), null);
});

test('parseMotouCommand：指令词变体', () => {
  const empty = { message: [] };
  for (const word of ['摸头', '摸摸头', 'petpet', 'PETPET', 'rua']) {
    assert.equal(parseMotouCommand(empty, `${word} 1234567890`), '1234567890', `${word} 应能触发`);
  }
});
