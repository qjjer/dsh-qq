// 控制台远程访问（路径前缀 + 域名白名单）的纯函数回归
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePathPrefix, stripPathPrefix, checkConsoleHost } from '../src/console-remote.js';

test('normalizePathPrefix：只接受单段字母数字', () => {
  assert.equal(normalizePathPrefix('admin'), 'admin');
  assert.equal(normalizePathPrefix('/admin'), 'admin');
  assert.equal(normalizePathPrefix('/admin/'), 'admin');
  assert.equal(normalizePathPrefix('  admin  '), 'admin');
  assert.equal(normalizePathPrefix('my-auth_1'), 'my-auth_1');
  // 非法
  assert.equal(normalizePathPrefix(''), '');
  assert.equal(normalizePathPrefix('/'), '');
  assert.equal(normalizePathPrefix('a/b'), '', '不接受多段');
  assert.equal(normalizePathPrefix('中文'), '', '不接受非 ASCII');
  assert.equal(normalizePathPrefix('a'.repeat(33)), '', '超长拒绝');
  assert.equal(normalizePathPrefix(null), '');
});

test('stripPathPrefix：命中剥离，不命中返回 null', () => {
  assert.equal(stripPathPrefix('/admin', 'admin'), '/');
  assert.equal(stripPathPrefix('/admin/', 'admin'), '/');
  assert.equal(stripPathPrefix('/admin/api/status', 'admin'), '/api/status');
  // 不命中
  assert.equal(stripPathPrefix('/', 'admin'), null);
  assert.equal(stripPathPrefix('/api/status', 'admin'), null);
  assert.equal(stripPathPrefix('/administrator', 'admin'), null, '前缀必须整段匹配');
  assert.equal(stripPathPrefix('/adminx/api', 'admin'), null);
  // 没配前缀时原样返回
  assert.equal(stripPathPrefix('/api/status', ''), '/api/status');
});

test('checkConsoleHost：本机回环始终放行', () => {
  for (const host of ['127.0.0.1:3100', 'localhost:3100', '[::1]:3100', '127.0.0.1', 'localhost']) {
    const r = checkConsoleHost({ hostHeader: host, port: 3100, prefixMatched: false, allowRemoteHosts: [] });
    assert.equal(r.ok, true, `${host} 应放行`);
  }
});

test('checkConsoleHost：外部域名必须命中白名单且有前缀', () => {
  const allow = ['qb.example.com'];
  // 带前缀 + 白名单 → 放行
  assert.equal(checkConsoleHost({ hostHeader: 'qb.example.com', port: 3100, prefixMatched: true, allowRemoteHosts: allow }).ok, true);
  // 带端口形式
  assert.equal(checkConsoleHost({ hostHeader: 'qb.example.com:443', port: 3100, prefixMatched: true, allowRemoteHosts: allow }).ok, true);
  // 没前缀 → 拒绝
  assert.equal(checkConsoleHost({ hostHeader: 'qb.example.com', port: 3100, prefixMatched: false, allowRemoteHosts: allow }).ok, false);
  // 不在白名单 → 拒绝（即使有前缀）
  assert.equal(checkConsoleHost({ hostHeader: 'evil.com', port: 3100, prefixMatched: true, allowRemoteHosts: allow }).ok, false);
  // 白名单为空 → 一律拒绝外部
  assert.equal(checkConsoleHost({ hostHeader: 'qb.example.com', port: 3100, prefixMatched: true, allowRemoteHosts: [] }).ok, false);
});

test('checkConsoleHost：大小写不敏感', () => {
  const r = checkConsoleHost({ hostHeader: 'qb.example.com:443', port: 3100, prefixMatched: true, allowRemoteHosts: ['qb.example.com'] });
  assert.equal(r.ok, true);
});

test('checkConsoleHost：DNS rebinding 攻击被挡住', () => {
  // 攻击者用 evil.com 解析到 127.0.0.1，浏览器发 Host: evil.com:3100
  const r = checkConsoleHost({ hostHeader: 'evil.com:3100', port: 3100, prefixMatched: false, allowRemoteHosts: ['qb.example.com'] });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('Host 头不被允许'));
});

test('checkConsoleHost：缺失 Host 头被拒（外部场景）', () => {
  const r = checkConsoleHost({ hostHeader: '', port: 3100, prefixMatched: true, allowRemoteHosts: ['qb.example.com'] });
  assert.equal(r.ok, false);
});
