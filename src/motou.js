// 摸头 GIF（petpet）生成 —— 纯函数，只负责请求与格式判定
//
// 接口：GET https://uapis.cn/api/v1/image/motou?qq=<QQ号>
// 实测：返回 GIF89a 真动图；非法/不存在 QQ 会拿默认头像兜底（也返回 GIF），
//       只有「完全不传 qq」才 400。所以这里对 qq 先做格式校验，避免白发请求。

import { safeFetchBuffer } from './safe-fetch.js';

const MOTOU_BASE = 'https://uapis.cn/api/v1/image/motou';

/**
 * 校验 QQ 号格式。只接受 5~12 位数字，避免把任意字符串丢给第三方接口。
 * @returns {string|null} 规范化后的 QQ 号，非法返回 null
 */
export function normalizeQQ(input) {
  const s = String(input ?? '').trim();
  if (!/^[1-9]\d{4,11}$/.test(s)) return null;
  return s;
}

/**
 * 生成摸头 GIF。
 * @param {string|number} qq 目标 QQ 号
 * @returns {Promise<Buffer|null>} GIF 字节；失败返回 null
 */
export async function fetchMotouGif(qq) {
  const uin = normalizeQQ(qq);
  if (!uin) return null;
  try {
    const fetched = await safeFetchBuffer(`${MOTOU_BASE}?qq=${encodeURIComponent(uin)}`, 8 * 1024 * 1024);
    const buf = fetched?.buffer ?? fetched;
    if (!Buffer.isBuffer(buf) || buf.length < 1024) return null;
    // 只认 GIF（89a/87a）；接口出错时返回的是 JSON，这里直接挡掉
    if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return null;
    return buf;
  } catch {
    return null;
  }
}

/** 把 GIF 包成 OneBot 图片段（base64://），和项目其它发图路径一致。 */
export function motouImageSegment(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  return { type: 'image', data: { file: 'base64://' + buf.toString('base64') } };
}
/**
 * 从一条群消息里认出「摸头」指令，返回目标 QQ 号。
 * 支持两种写法：
 *   摸头 @某人 / 摸摸头 @某人 / petpet @某人 / rua @某人   （从 at 段取 QQ 号）
 *   摸头 1234567890                                        （正文里直接写 QQ 号）
 * @param {object} event    OneBot 消息事件
 * @param {string} plain   已经去掉 CQ 码的纯文本
 * @returns {string|null}   目标 QQ 号；不是摸头指令返回 null
 */
export function parseMotouCommand(event, plain) {
  const text = String(plain ?? '').trim();
  if (!text) return null;
  // 指令词必须在开头，避免聊天里随便提到「摸头」就触发
  const m = /^(?:摸摸头|摸头|petpet|rua|撸头)\s*/i.exec(text);
  if (!m) return null;
  const rest = text.slice(m[0].length).trim();

  // ① 优先用 at 段（最准，不受昵称里带数字干扰）
  const segs = Array.isArray(event?.message) ? event.message : [];
  const atSeg = segs.find((s) => s?.type === 'at' && s?.data?.qq && String(s.data.qq) !== 'all');
  if (atSeg) {
    const qq = normalizeQQ(atSeg.data.qq);
    if (qq) return qq;
  }

  // ② 正文里直接写 QQ 号
  const numMatch = /(?:^|\s)([1-9]\d{4,11})(?:\s|$)/.exec(rest);
  if (numMatch) return normalizeQQ(numMatch[1]);

  return null;
}
