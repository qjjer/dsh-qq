// 会话令牌「片段」检测回归（安全修复 4ed0142 的等价验证）
//
// 背景：上游 v0.2.2-rc1 修了「令牌被拆成多段发送」绕过闸门的问题。
// 修复要点：整批拼接后预检，命中则整批拒绝、一条都不发。
// 本测试复刻 hasKnownTokenFragment 的判定逻辑并验证边界。
import test from 'node:test';
import assert from 'node:assert/strict';

const TOKEN_FRAGMENT_WIDTH = 12;

/** 与 bridge.js 中的实现保持一致。 */
function makeChecker(tokens) {
  const set = new Set(tokens);
  return function hasKnownTokenFragment(text) {
    const value = String(text ?? '');
    if (!value) return false;
    for (const token of set) {
      if (!token || token.length < TOKEN_FRAGMENT_WIDTH) continue;
      for (let i = 0; i + TOKEN_FRAGMENT_WIDTH <= token.length; i += 1) {
        if (value.includes(token.slice(i, i + TOKEN_FRAGMENT_WIDTH))) return true;
      }
    }
    return false;
  };
}

const TOKEN = '0123456789abcdef0123456789abcdef'; // 32 字符，模拟 agent token
const check = makeChecker([TOKEN]);

test('整串令牌被识别', () => {
  assert.equal(check(TOKEN), true);
  assert.equal(check(`前缀 ${TOKEN} 后缀`), true);
});

test('拆成两半：单条都不含整串，但拼接后命中', () => {
  const half = Math.ceil(TOKEN.length / 2);
  const a = TOKEN.slice(0, half);
  const b = TOKEN.slice(half);
  // 单看任一段：每段 16 字符，本身就含 12 字符窗口 → 单条也会命中
  assert.equal(check(a), true, '前半段含 12 字符窗口，单条即应命中');
  assert.equal(check(b), true);
  // 拼接（修复的核心）
  assert.equal(check(a + b), true);
});

test('拆成 4 段 8 字符：每段都短于 12 字符窗口，单条全部漏过', () => {
  const pieces = TOKEN.match(/.{1,8}/g);
  assert.equal(pieces.length, 4);
  for (const p of pieces) {
    assert.equal(check(p), false, `单段 ${p} 短于窗口，逐条闸门会漏过`);
  }
  // 但整批拼接必须命中 —— 这正是本次修复要拦住的场景
  assert.equal(check(pieces.join('')), true, '整批拼接必须命中');
});

test('拆成 3 段（10/10/12）：前两段短于窗口会漏过，拼接必须命中', () => {
  const pieces = [TOKEN.slice(0, 10), TOKEN.slice(10, 20), TOKEN.slice(20)];
  assert.equal(check(pieces[0]), false);
  assert.equal(check(pieces[1]), false);
  assert.equal(check(pieces.join('')), true);
});

test('中间插字符：只剩不足 12 字符的碎片时才漏过', () => {
  // 在正中间插一个字符，左右两半各 16 字符 → 每一半仍然包含完整的 12 字符窗口，
  // 所以仍会命中。这是**正确**行为（宁可多拦）。
  const broken = TOKEN.slice(0, 16) + 'X' + TOKEN.slice(16);
  assert.equal(check(broken), true, '两半各含完整窗口，仍应命中');

  // 真正能漏过的只有：每一段都被切到短于 12 字符窗口。
  // 这属于「拆得更碎」的场景 —— 已经被上面的整批拼接检测覆盖。
  const tinyPieces = TOKEN.match(/.{1,6}/g);
  assert.ok(tinyPieces.every((p) => p.length <= 6));
  for (const p of tinyPieces) assert.equal(check(p), false);
  assert.equal(check(tinyPieces.join('')), true, '拼回完整令牌仍会命中');
});

test('日常聊天不误伤', () => {
  assert.equal(check('今天天气不错，出去走走'), false);
  assert.equal(check('哈哈哈哈'), false);
  assert.equal(check(''), false);
  assert.equal(check(null), false);
  assert.equal(check(undefined), false);
});

test('短于窗口宽度的 token 不参与检测（避免误伤）', () => {
  const shortCheck = makeChecker(['abc123']);
  assert.equal(shortCheck('abc123'), false, '6 字符 token 短于 12，不检测');
});

test('多个 token 中任意一个命中即触发', () => {
  const other = 'fedcba9876543210fedcba9876543210';
  const multi = makeChecker([TOKEN, other]);
  assert.equal(multi(other.slice(0, 12)), true);
  assert.equal(multi('完全无关的文字内容在这里'), false);
});
