// GitHub 链接解析的离线回归（不联网）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubRef, mirrorUrl, DEFAULT_MIRROR } from '../src/github-parse.js';

test('parseGitHubRef：常见链接形式', () => {
  const cases = [
    ['https://github.com/derpyu520/qq-bridge', 'derpyu520', 'qq-bridge', ''],
    ['https://github.com/derpyu520/qq-bridge/', 'derpyu520', 'qq-bridge', ''],
    ['github.com/derpyu520/qq-bridge', 'derpyu520', 'qq-bridge', ''],
    ['https://github.com/derpyu520/qq-bridge.git', 'derpyu520', 'qq-bridge', ''],
    ['https://github.com/NapNeko/NapCatQQ', 'NapNeko', 'NapCatQQ', ''],
  ];
  for (const [text, owner, repo, path] of cases) {
    const r = parseGitHubRef(text);
    assert.ok(r, `应能解析: ${text}`);
    assert.equal(r.owner, owner, text);
    assert.equal(r.repo, repo, text);
    assert.equal(r.path, path, text);
  }
});

test('parseGitHubRef：带路径的链接', () => {
  const r1 = parseGitHubRef('https://github.com/a/b/releases/tag/v1.0.0');
  assert.equal(r1.owner, 'a');
  assert.equal(r1.repo, 'b');
  assert.equal(r1.path, '/releases/tag/v1.0.0');

  const r2 = parseGitHubRef('https://github.com/a/b/blob/main/README.md');
  assert.equal(r2.path, '/blob/main/README.md');

  const r3 = parseGitHubRef('https://github.com/a/b/issues/3');
  assert.equal(r3.path, '/issues/3');
});

test('parseGitHubRef：链接前后的文字不影响', () => {
  const r = parseGitHubRef('看看这个 https://github.com/foo/bar 挺有意思的');
  assert.ok(r);
  assert.equal(r.owner, 'foo');
  assert.equal(r.repo, 'bar');
});

test('parseGitHubRef：保留路径要拒绝（不是用户名）', () => {
  const bad = [
    'https://github.com/settings/tokens',
    'https://github.com/orgs/foo/repositories',
    'https://github.com/notifications',
    'https://github.com/explore',
    'https://github.com/sponsors/x',
  ];
  for (const t of bad) {
    assert.equal(parseGitHubRef(t), null, `应拒绝: ${t}`);
  }
});

test('parseGitHubRef：非 GitHub 链接返回 null', () => {
  assert.equal(parseGitHubRef('https://gitlab.com/a/b'), null);
  assert.equal(parseGitHubRef('https://gist.github.com/a/b'), null, 'gist 不算');
  assert.equal(parseGitHubRef('https://example.com/github.com/a/b'), null);
  assert.equal(parseGitHubRef(''), null);
  assert.equal(parseGitHubRef(null), null);
});

test('parseGitHubRef：大小写与下划线/点号允许', () => {
  const r = parseGitHubRef('https://github.com/My_User/my.repo-name');
  assert.ok(r);
  assert.equal(r.owner, 'My_User');
  assert.equal(r.repo, 'my.repo-name');
});

test('parseGitHubRef：问号和锚点被排除', () => {
  const r = parseGitHubRef('https://github.com/a/b?tab=readme#top');
  assert.equal(r.repo, 'b');
  assert.equal(r.path, '');
});

test('mirrorUrl：默认套 gh-proxy 前缀', () => {
  const u = 'https://opengraph.githubassets.com/1/a/b';
  assert.equal(mirrorUrl(u), 'https://gh-proxy.com/' + u);
  assert.equal(mirrorUrl(u, 'https://gh-proxy.com'), 'https://gh-proxy.com/' + u, '末尾无斜杠也补上');
});

test('mirrorUrl：空镜像则直连', () => {
  const u = 'https://opengraph.githubassets.com/1/a/b';
  assert.equal(mirrorUrl(u, ''), u);
  assert.equal(mirrorUrl(u, null), u);
  assert.equal(mirrorUrl(u, '   '), u);
});

test('DEFAULT_MIRROR 是 gh-proxy', () => {
  assert.ok(DEFAULT_MIRROR.includes('gh-proxy.com'));
});
