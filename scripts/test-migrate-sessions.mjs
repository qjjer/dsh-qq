// 会话迁移工具的纯函数回归（不碰到真实 sessions 目录）
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { encodeWorkspaceDir, rewriteSessionCwd } from '../scripts/migrate-sessions.mjs';

test('encodeWorkspaceDir：路径编码成 DSH 目录名', () => {
  assert.equal(encodeWorkspaceDir('D:\\65383\\Documents\\dsh'), '--D-65383-Documents-dsh--');
  assert.equal(encodeWorkspaceDir('D:\\dsh'), '--D-dsh--');
  assert.equal(encodeWorkspaceDir('D:/dsh'), '--D-dsh--');
  assert.equal(encodeWorkspaceDir('C:\\Users\\me\\proj'), '--C-Users-me-proj--');
  // 尾部斜杠要去掉
  assert.equal(encodeWorkspaceDir('D:\\dsh\\'), '--D-dsh--');
  assert.equal(encodeWorkspaceDir('D:\\dsh/'), '--D-dsh--');
});

test('encodeWorkspaceDir：QQ 桥接 agents 目录也能正确编码', () => {
  const p = 'D:\\65383\\Documents\\dsh\\qq-bridge-enhanced-v1.1.2\\state\\agents';
  assert.equal(
    encodeWorkspaceDir(p),
    '--D-65383-Documents-dsh-qq-bridge-enhanced-v1.1.2-state-agents--'
  );
});

/** 造一个最小的 session 文件 */
function makeSession(cwd, extraLines = []) {
  const first = JSON.stringify({ type: 'session', version: 4, id: 'session-test', cwd, createdAt: 1 });
  const lines = [first, ...extraLines];
  return zlib.zstdCompressSync(Buffer.from(lines.join('\n'), 'utf8'));
}

test('rewriteSessionCwd：cwd 被正确改写', () => {
  const buf = makeSession('D:\\65383\\Documents\\dsh');
  const r = rewriteSessionCwd(buf, 'D:\\65383\\Documents\\dsh', 'D:\\dsh');
  assert.equal(r.changed, true);
  assert.equal(r.before, 'D:\\65383\\Documents\\dsh');
  assert.equal(r.after, 'D:\\dsh');

  // 解压回来确认首行
  const raw = zlib.zstdDecompressSync(r.buffer).toString('utf8');
  const first = JSON.parse(raw.split('\n')[0]);
  assert.equal(first.cwd, 'D:\\dsh');
  // 其它字段没被破坏
  assert.equal(first.type, 'session');
  assert.equal(first.version, 4);
  assert.equal(first.id, 'session-test');
});

test('rewriteSessionCwd：cwd 已经是新路径则不动', () => {
  const buf = makeSession('D:\\dsh');
  const r = rewriteSessionCwd(buf, 'D:\\65383\\Documents\\dsh', 'D:\\dsh');
  assert.equal(r.changed, false);
  assert.equal(r.buffer, buf, '未改动时应原样返回同一个 buffer');
});

test('rewriteSessionCwd：非 session 首行不处理', () => {
  const buf = zlib.zstdCompressSync(Buffer.from(JSON.stringify({ type: 'other', cwd: 'x' }), 'utf8'));
  const r = rewriteSessionCwd(buf, 'x', 'y');
  assert.equal(r.changed, false);
});

test('rewriteSessionCwd：首个 JSON 坏掉时不抛错', () => {
  const buf = zlib.zstdCompressSync(Buffer.from('not json at all', 'utf8'));
  const r = rewriteSessionCwd(buf, 'a', 'b');
  assert.equal(r.changed, false);
});

test('rewriteSessionCwd：多行内容完整保留', () => {
  const messages = [
    JSON.stringify({ type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '第一行\n含换行' }] } }),
    JSON.stringify({ type: 'assistant/message', seq: 2, data: { content: '回复' } }),
    JSON.stringify({ type: 'tool/result', seq: 3, data: { output: '结果' } }),
  ];
  const buf = makeSession('D:\\old', messages);
  const r = rewriteSessionCwd(buf, 'D:\\old', 'D:\\new');
  assert.equal(r.changed, true);

  const raw = zlib.zstdDecompressSync(r.buffer).toString('utf8');
  const lines = raw.split('\n');
  assert.equal(lines.length, 4, '应该是 4 行（session + 3 条消息）');
  // 后三行逐字一致
  assert.equal(lines[1], messages[0]);
  assert.equal(lines[2], messages[1]);
  assert.equal(lines[3], messages[2]);
});

test('rewriteSessionCwd：cwd 含中文/空格时也能处理', () => {
  const buf = makeSession('D:\\我的 项目\\dsh');
  const r = rewriteSessionCwd(buf, 'D:\\我的 项目\\dsh', 'E:\\新 位置');
  assert.equal(r.changed, true);
  const raw = zlib.zstdDecompressSync(r.buffer).toString('utf8');
  assert.equal(JSON.parse(raw.split('\n')[0]).cwd, 'E:\\新 位置');
});

test('rewriteSessionCwd：往返后仍是合法 zstd', () => {
  const buf = makeSession('D:\\a');
  const r = rewriteSessionCwd(buf, 'D:\\a', 'D:\\b');
  assert.equal(r.buffer.slice(0, 4).toString('hex'), '28b52ffd', 'zstd magic 必须保留');
});

test('rewriteSessionCwd：不属于旧工作区的会话不改写', () => {
  // 真实场景：sessions/ 里混着 Temp 目录的测试会话，
  // 无差别改写会把它们也指到新路径 —— 那是破坏无关数据。
  const buf = makeSession('C:\\Users\\me\\AppData\\Local\\Temp\\probe');
  const r = rewriteSessionCwd(buf, 'D:\\65383\\Documents\\dsh', 'D:\\dsh');
  assert.equal(r.changed, false, 'Temp 会话不该被改写');
  assert.equal(r.buffer, buf);
});

test('rewriteSessionCwd：旧路径的子目录也算命中', () => {
  const buf = makeSession('D:\\65383\\Documents\\dsh\\sub\\deep');
  const r = rewriteSessionCwd(buf, 'D:\\65383\\Documents\\dsh', 'D:\\dsh');
  assert.equal(r.changed, true);
  const raw = zlib.zstdDecompressSync(r.buffer).toString('utf8');
  assert.equal(JSON.parse(raw.split('\n')[0]).cwd, 'D:\\dsh');
});

test('rewriteSessionCwd：路径前缀相似但不是子目录时不命中', () => {
  // D:\\65383\\Documents\\dsh-other 不是 D:\\65383\\Documents\\dsh 的子目录
  const buf = makeSession('D:\\65383\\Documents\\dsh-other');
  const r = rewriteSessionCwd(buf, 'D:\\65383\\Documents\\dsh', 'D:\\dsh');
  assert.equal(r.changed, false);
});

test('rewriteSessionCwd：大小写与分隔符差异仍算命中', () => {
  const buf = makeSession('d:/65383/documents/dsh');
  const r = rewriteSessionCwd(buf, 'D:\\65383\\Documents\\dsh', 'D:\\dsh');
  assert.equal(r.changed, true);
});
