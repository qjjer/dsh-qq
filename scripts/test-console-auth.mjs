// 控制台短密码登录的纯函数回归
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, validatePasswordStrength,
  createSessionStore, createLoginLimiter, readCookie, buildSessionCookie
} from '../src/console-auth.js';

test('validatePasswordStrength：拦截弱密码', () => {
  assert.equal(validatePasswordStrength('abc').ok, false, '太短');
  assert.equal(validatePasswordStrength('12345678').ok, false, '纯数字');
  assert.equal(validatePasswordStrength('aaaaaaaa').ok, false, '单字符重复');
  assert.equal(validatePasswordStrength('a'.repeat(201)).ok, false, '过长');
  assert.equal(validatePasswordStrength('mySecret2026').ok, true);
});

test('hashPassword / verifyPassword：正确密码通过，错误密码拒绝', () => {
  const stored = hashPassword('correct horse battery');
  assert.equal(stored.algo, 'scrypt');
  assert.ok(stored.salt && stored.hash);
  assert.equal(verifyPassword('correct horse battery', stored), true);
  assert.equal(verifyPassword('wrong password here', stored), false);
  assert.equal(verifyPassword('', stored), false);
  // 同密码不同 salt → 不同 hash
  const other = hashPassword('correct horse battery');
  assert.notEqual(stored.hash, other.hash, 'salt 应不同');
  assert.equal(verifyPassword('correct horse battery', other), true);
});

test('verifyPassword：损坏的存储返回 false 而非抛错', () => {
  assert.equal(verifyPassword('x', null), false);
  assert.equal(verifyPassword('x', {}), false);
  assert.equal(verifyPassword('x', { salt: 'abc' }), false);
});

test('SessionStore：签发的 Cookie 可验证，篡改后失效', () => {
  let t = 1000;
  const store = createSessionStore({ ttlMs: 10000, now: () => t, secret: 'unit-test-secret' });
  const s = store.issue();
  assert.ok(s.cookie.includes('.'));
  assert.equal(store.verify(s.cookie), true);
  // 篡改 id
  assert.equal(store.verify('deadbeef.' + s.cookie.split('.')[1]), false);
  // 篡改 mac
  assert.equal(store.verify(s.cookie.slice(0, -1) + 'x'), false);
  // 空/畸形
  assert.equal(store.verify(''), false);
  assert.equal(store.verify('nodot'), false);
});

test('SessionStore：过期后失效', () => {
  let t = 1000;
  const store = createSessionStore({ ttlMs: 1000, now: () => t, secret: 'k' });
  const s = store.issue();
  assert.equal(store.verify(s.cookie), true);
  t = 1000 + 1001; // 过期
  assert.equal(store.verify(s.cookie), false);
});

test('SessionStore：revokeAll 让所有会话失效', () => {
  const store = createSessionStore({ ttlMs: 100000, secret: 'k' });
  const a = store.issue();
  const b = store.issue();
  assert.equal(store.verify(a.cookie), true);
  assert.equal(store.verify(b.cookie), true);
  store.revokeAll();
  assert.equal(store.verify(a.cookie), false);
  assert.equal(store.verify(b.cookie), false);
  assert.equal(store.size(), 0);
});

test('LoginLimiter：连续失败后锁定', () => {
  let t = 0;
  const lim = createLoginLimiter({ maxFailures: 3, windowMs: 60000, now: () => t });
  assert.equal(lim.allowed('1.2.3.4').ok, true);
  lim.recordFailure('1.2.3.4');
  lim.recordFailure('1.2.3.4');
  assert.equal(lim.allowed('1.2.3.4').ok, true, '还没到阈值');
  lim.recordFailure('1.2.3.4'); // 第 3 次 → 锁定
  const blocked = lim.allowed('1.2.3.4');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
  // 其他 IP 不受影响
  assert.equal(lim.allowed('5.6.7.8').ok, true);
  // 窗口过后解锁
  t = 61000;
  assert.equal(lim.allowed('1.2.3.4').ok, true);
});

test('LoginLimiter：成功清零', () => {
  let t = 0;
  const lim = createLoginLimiter({ maxFailures: 3, windowMs: 60000, now: () => t });
  lim.recordFailure('1.2.3.4');
  lim.recordFailure('1.2.3.4');
  lim.recordSuccess('1.2.3.4');
  lim.recordFailure('1.2.3.4');
  assert.equal(lim.allowed('1.2.3.4').ok, true, '成功一次后计数重置');
});

test('readCookie：解析取值为空的边界', () => {
  assert.equal(readCookie('a=1; b=2', 'b'), '2');
  assert.equal(readCookie('a=1; b=hello%20world', 'b'), 'hello world');
  assert.equal(readCookie('a=1', 'missing'), '');
  assert.equal(readCookie('', 'a'), '');
  assert.equal(readCookie(null, 'a'), '');
});

test('buildSessionCookie：属性正确', () => {
  const c = buildSessionCookie({ name: 's', value: 'abc', maxAgeMs: 7000, secure: true });
  assert.ok(c.includes('HttpOnly'));
  assert.ok(c.includes('SameSite=Strict'));
  assert.ok(c.includes('Secure'));
  assert.ok(c.includes('Max-Age=7'));
  // 非 https 不加 Secure
  const c2 = buildSessionCookie({ name: 's', value: 'abc', maxAgeMs: 7000, secure: false });
  assert.ok(!c2.includes('Secure'));
});
