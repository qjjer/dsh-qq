// bili-parse / bili-render 离线回归（不联网、不读真实配置）
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, formatDuration, renderBiliText, biliCoverUrl } from '../src/bili-render.js';

test('formatCount：万/亿折算与边界', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(9999), '9999');
  assert.equal(formatCount(10000), '1.0万');
  assert.equal(formatCount(12345), '1.2万');
  assert.equal(formatCount(99999), '10.0万');
  assert.equal(formatCount(123456), '12万');
  assert.equal(formatCount(100000000), '1.0亿');
  assert.equal(formatCount(250000000), '2.5亿');
  assert.equal(formatCount(1200000000), '12亿');
  // 异常输入不抛错
  assert.equal(formatCount(-5), '0');
  assert.equal(formatCount('abc'), '0');
  assert.equal(formatCount(null), '0');
});

test('formatDuration：秒与字符串两种输入', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration('01:23'), '1:23');
  assert.equal(formatDuration('1:02:03'), '1:02:03');
  assert.equal(formatDuration(null), '');
});

test('renderBiliText：照参考实现排版（标题/UP主/七项统计/分隔/链接）', () => {
  const meta = {
    id: 'BV1xx411c7mD',
    title: '测试视频', up: '某个UP', duration: 65,
    view: 12345, like: 100, coin: 20, favorite: 30, reply: 5, danmaku: 88, share: 7,
    cover: 'http://i0.hdslb.com/cover.jpg',
  };
  const text = renderBiliText(meta);
  const lines = text.split('\n');

  // 结构：标题、UP主、7 项统计、分隔线、链接 = 11 行
  assert.equal(lines.length, 11, '应为 11 行（9 行内容 + 分隔线 + 链接）');
  assert.ok(lines[0].startsWith('视频标题：'), '第1行是标题');
  assert.ok(lines[0].includes('测试视频'));
  assert.ok(lines[1].startsWith('UP主：'), '第2行是UP主');
  assert.ok(lines[1].includes('某个UP'));
  // 七项统计各自一行
  const stats = ['▶️播放：', '👍点赞：', '💰投币：', '⭐收藏：', '📢弹幕：', '💬评论：', '🔗分享：'];
  stats.forEach((prefix, i) => {
    assert.ok(lines[i + 2].startsWith(prefix), `第${i + 3}行应以「${prefix}」开头，实际：${lines[i + 2]}`);
  });
  // 万折算
  assert.ok(text.includes('1.2万'), '播放量应按万折算');
  // 分隔线与链接
  assert.ok(lines[9].includes('—'), '倒数第2行是分隔线');
  assert.equal(lines[10], 'https://www.bilibili.com/video/BV1xx411c7mD', '最后一行是视频链接');
  // 封面不该进文本
  assert.ok(!text.includes('hdslb.com'), '封面地址不能出现在文本里');
});

test('renderBiliText：没有 id 时不输出链接段', () => {
  const text = renderBiliText({ title: '只有标题' });
  assert.ok(!text.includes('bilibili.com'), '无 id 时不该拼链接');
  assert.ok(!text.includes('——'), '无 id 时不该有分隔线');
});

test('renderBiliText：没有标题返回空串', () => {
  assert.equal(renderBiliText(null), '');
  assert.equal(renderBiliText({}), '');
  assert.equal(renderBiliText({ title: '' }), '');
});

test('biliCoverUrl：协议补全与 http 升级', () => {
  assert.equal(biliCoverUrl({ cover: '//i0.hdslb.com/a.jpg' }), 'https://i0.hdslb.com/a.jpg');
  assert.equal(biliCoverUrl({ cover: 'http://i0.hdslb.com/a.jpg' }), 'https://i0.hdslb.com/a.jpg');
  assert.equal(biliCoverUrl({ cover: 'https://i0.hdslb.com/a.jpg' }), 'https://i0.hdslb.com/a.jpg');
  assert.equal(biliCoverUrl({ cover: '' }), '');
  assert.equal(biliCoverUrl(null), '');
});
