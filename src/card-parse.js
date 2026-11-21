// 小程序 / Ark 卡片（json 段）解析 —— 纯函数，只从卡片里抠链接和可读标题
//
// 背景：QQ 发 B 站视频小程序时，消息是 `{type:'json', data:{data:'<转义JSON>'}}`，
// 桥接原来的 segmentsToText 只输出字面量 `[卡片消息]`，把里面的 BV 号丢掉了，
// 所以 B 站解析拿不到链接。
//
// 卡片结构实测（位置分享为例）：
//   { data: '{"app":"com.tencent.map","meta":{"Location.Search":{...}},"prompt":"[位置]..."}' }
//   即 data 字段是**被转义过一次的 JSON 字符串**，要再 parse 一次才拿到 meta。
//
// 这里只做两件事：
//   extractCardUrl(card)  找出卡片里第一个可用链接（B 站优先）
//   cardReadableText(card) 拼一句人能看懂的摘要（拿不到就返回空串）

/** 安全 JSON.parse：失败返回 null，绝不抛。 */
function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * 把 json 段的 data 归一成对象。
 * 兼容三种形状：
 *   1) data 是对象，且带 .data 字符串（NapCat 常见）
 *   2) data 直接是对象（扁平 meta）
 *   3) data 是字符串（需要再 parse）
 */
export function normalizeCardPayload(data) {
  if (!data) return null;
  let cur = data;
  // 最多剥两层字符串（实测就是两层：data.data 是字符串）
  for (let i = 0; i < 3; i++) {
    if (typeof cur === 'string') {
      const parsed = tryParse(cur);
      if (!parsed) return null;
      cur = parsed;
      continue;
    }
    if (cur && typeof cur === 'object' && typeof cur.data === 'string') {
      const parsed = tryParse(cur.data);
      // data 字段析不出来：说明这个卡片是坏的，别把外壳当结果返回
      // （否则调用方会拿一个只有 {data:'坏'} 的对象当有效载荷）。
      if (parsed === null) return null;
      cur = parsed;
      continue;
    }
    break;
  }
  return cur && typeof cur === 'object' ? cur : null;
}

/** 递归收集对象里所有 http(s) 链接（限制层数与数量，防畸形数据卡住）。 */
function collectUrls(node, out = [], depth = 0) {
  if (depth > 6 || out.length >= 20) return out;
  if (typeof node === 'string') {
    const m = node.match(/https?:\/\/[^\s"'<>\\]+/g);
    if (m) for (const u of m) out.push(u.replace(/\\\//g, '/'));
    return out;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectUrls(v, out, depth + 1);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) collectUrls(v, out, depth + 1);
  }
  return out;
}

const BILI_HOST_RE = /(?:bilibili\.com|b23\.tv|bili2233\.cn)/i;

/**
 * 从卡片里提取链接。B 站链接优先；没有 B 站就返回第一个 http(s) 链接。
 * @returns {string} 链接；找不到返回空串
 */
export function extractCardUrl(card) {
  const obj = normalizeCardPayload(card);
  if (!obj) return '';
  const urls = collectUrls(obj);
  const bili = urls.find((u) => BILI_HOST_RE.test(u));
  return bili || urls[0] || '';
}

/**
 * 卡片摘要：优先用卡片自带的 prompt / desc / title，拼成一行人能看的文字。
 * 拿不到有效内容返回空串（调用方据此回落到 `[卡片消息]`）。
 * @returns {string}
 */
export function cardReadableText(card) {
  const obj = normalizeCardPayload(card);
  if (!obj) return '';
  const pick = (...keys) => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const prompt = pick('prompt');
  const desc = pick('desc');
  const title = pick('title');
  const app = pick('app');

  // prompt 形如 "[位置]RealLive And Books"、"【哔哩哔哩】xxx"
  const parts = [];
  if (prompt) parts.push(prompt);
  else if (desc) parts.push(desc);
  else if (title) parts.push(title);

  const url = extractCardUrl(card);
  if (url && !parts.some((p) => p.includes(url))) parts.push(url);

  if (!parts.length && app) parts.push(`[${app}]`);
  return parts.join(' ').slice(0, 300);
}
