// B 站视频卡片的文本排版（只负责把元信息排成人能看的文本，不做 IO）
//
// 规格：文本三行 —— 标题 / UP主 / 六个数字。
// 封面不拼进文本，由调用方走图片消息单独发。

/** 数字按「万」折算：1 万以下原样，1 万以上保留一位小数，1 亿以上按亿。 */
export function formatCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '0';
  if (v >= 100000000) {
    const yi = v / 100000000;
    return `${yi >= 10 ? Math.round(yi) : yi.toFixed(1)}亿`;
  }
  if (v >= 10000) {
    const wan = v / 10000;
    return `${wan >= 10 ? Math.round(wan) : wan.toFixed(1)}万`;
  }
  return String(Math.round(v));
}

/** 时长：秒 → m:ss / h:mm:ss。官方接口给的是秒，uapis 有时给字符串，一并兼容。 */
export function formatDuration(input) {
  // 注意 Number(null) === 0、Number('') === 0，会把「没有时长」当成 0 秒。
  // 所以先排除空值，再走数字判断。
  const isEmpty = input === null || input === undefined || input === '';
  let sec = isEmpty ? NaN : Number(input);
  if (!Number.isFinite(sec) || sec < 0) {
    // 兼容 "01:23" / "1:02:03" 这类字符串
    const m = /(?:(\d+):)?(\d+):(\d+)/.exec(String(input ?? ''));
    if (!m) return '';
    sec = (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
  }
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/**
 * 生成卡片文本。**排版照参考实现 [XY]BiliAnalysis 抄**：
 *   视频标题：xxx
 *   UP主：xxx
 *   ▶️播放：x   👍点赞：x  ……（每项一行）
 *   ——————————
 *   https://www.bilibili.com/video/BVxxx
 * 七项统计：播放/点赞/投币/收藏/弹幕/评论/分享。
 */
export function renderBiliText(meta) {
  if (!meta || !meta.title) return '';
  const id = String(meta.id || '').trim();
  const url = id ? `https://www.bilibili.com/video/${id}` : '';
  const lines = [
    `视频标题：${String(meta.title).trim()}`,
    `UP主：${String(meta.up || '未知').trim()}`,
    `▶️播放：${formatCount(meta.view)}`,
    `👍点赞：${formatCount(meta.like)}`,
    `💰投币：${formatCount(meta.coin)}`,
    `⭐收藏：${formatCount(meta.favorite)}`,
    `📢弹幕：${formatCount(meta.danmaku)}`,
    `💬评论：${formatCount(meta.reply)}`,
    `🔗分享：${formatCount(meta.share)}`,
  ];
  if (url) {
    lines.push('——————————', url);
  }
  return lines.join('\n');
}

/** 封面图地址（调用方拿它走图片消息）。没有就返回空串。 */
export function biliCoverUrl(meta) {
  const c = String(meta?.cover ?? '').trim();
  if (!c) return '';
  // 官方接口有时给 http://i0.hdslb.com/... 这里统一升级到 https
  return c.startsWith('//') ? `https:${c}` : c.replace(/^http:\/\//i, 'https://');
}
