// B 站链接解析与元信息抓取（纯函数，不做 IO 之外的副作用）
//
// 只导出两个函数：
//   parseBiliLink(text)   从一段文字里认出 BV/av 号；短链先展开再认
//   fetchBiliMeta(id)     拿视频元信息，统一成固定字段
//
// 设计约束：
// - 网络一律走 safe-fetch 的 safeFetch（带 SSRF 防护），不直接 fetch。
// - 失败返回 null（而不是抛错），方便调用方统一降级。
// - 字段固定，不把上游 API 的原始结构漏出去。

import { safeFetch } from './safe-fetch.js';

/** 统一的元信息字段。缺字段也保留键，值给 0/空串，调用方不用再判空。 */
const EMPTY_META = {
  id: '',
  title: '',
  up: '',
  cover: '',
  duration: 0,
  view: 0,
  danmaku: 0,
  reply: 0,
  favorite: 0,
  coin: 0,
  share: 0,
  like: 0,
};

const BV_RE = /BV[0-9A-Za-z]{10}/;
const AV_RE = /av(\d+)/i;
const SHORT_LINK_RE = /(?:https?:\/\/)?(?:b23\.tv|bili2233\.cn)\/[0-9A-Za-z]+/i;

/**
 * 从文本里找出 B 站视频 id。
 * @param {string} text 任意聊天文本
 * @returns {Promise<{kind:'bv'|'av', id:string}|null>}
 *   kind='bv' 时 id 形如 'BV1xx411c7mD'；kind='av' 时 id 形如 'av170001'
 */
export async function parseBiliLink(text) {
  const src = String(text ?? '');
  if (!src.trim()) return null;

  // 1) 短链先展开：b23.tv / bili2233.cn 的路径里没有视频号，必须跟随重定向
  if (SHORT_LINK_RE.test(src)) {
    const short = src.match(SHORT_LINK_RE)[0];
    const url = short.startsWith('http') ? short : `https://${short}`;
    try {
      const res = await safeFetch(url, 1000);
      if (res?.url) {
        const hit = matchId(res.url);
        if (hit) return hit;
      }
    } catch {
      // 短链展开失败就继续用原文匹配（可能原文里还带了完整链接）
    }
  }

  // 2) 直接匹配 BV / av
  return matchId(src);
}

/** 从一段文本里匹配 id（供内部和短链展开后复用）。 */
function matchId(text) {
  const s = String(text ?? '');
  const bv = s.match(BV_RE);
  if (bv) return { kind: 'bv', id: bv[0] };
  const av = s.match(AV_RE);
  if (av) return { kind: 'av', id: `av${av[1]}` };
  return null;
}

/**
 * 抓 B 站视频元信息。
 * 先用 uapis（第三方聚合，字段全、自带封面），失败回落官方 view 接口。
 * @param {string} id 'BV1xx411c7mD' 或 'av170001'
 * @returns {Promise<object|null>} 统一字段对象；彻底失败返回 null
 */
export async function fetchBiliMeta(id) {
  const raw = String(id ?? '').trim();
  if (!raw) return null;
  const isAv = /^av\d+$/i.test(raw);
  const bvid = isAv ? '' : raw;
  const aid = isAv ? raw.replace(/^av/i, '') : '';

  // 1) uapis 聚合接口
  try {
    const query = isAv ? `aid=${encodeURIComponent(aid)}` : `bvid=${encodeURIComponent(bvid)}`;
    const res = await safeFetch(`https://uapis.cn/api/v1/social/bilibili/videoinfo?${query}`, 200000);
    if (res?.statusCode === 200) {
      let data = null;
      try { data = JSON.parse(res.body); } catch { data = null; }
      if (data && data.title) {
        const meta = normalizeUapis(data, raw);
        if (meta) return meta;
      }
    }
  } catch {
    // 继续回落
  }

  // 2) 官方 view 接口兜底
  try {
    const query = isAv ? `aid=${encodeURIComponent(aid)}` : `bvid=${encodeURIComponent(bvid)}`;
    const res = await safeFetch(`https://api.bilibili.com/x/web-interface/view?${query}`, 400000);
    if (res?.statusCode !== 200) return null;
    let data = null;
    try { data = JSON.parse(res.body); } catch { data = null; }
    // 官方这条必须 code === 0，否则就是没拿到
    if (!data || data.code !== 0 || !data.data) return null;
    return normalizeOfficial(data.data, raw);
  } catch {
    return null;
  }
}

/** uapis 的字段映射（字段名不保证固定，做多路兜底）。 */
function normalizeUapis(d, fallbackId) {
  if (!d || typeof d !== 'object') return null;
  const stat = d.stat && typeof d.stat === 'object' ? d.stat : d;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = d[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return '';
  };
  const num = (...keys) => {
    for (const k of keys) {
      const v = stat[k] ?? d[k];
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };
  const owner = d.owner && typeof d.owner === 'object' ? d.owner : null;
  return {
    ...EMPTY_META,
    id: String(pick('bvid', 'bv', 'id') || fallbackId),
    title: String(pick('title', 'name') || ''),
    up: String(owner?.name ?? pick('up', 'author', 'owner_name') ?? ''),
    cover: String(pick('pic', 'cover', 'cover_url', 'image') || ''),
    duration: num('duration'),
    view: num('view', 'play'),
    danmaku: num('danmaku', 'danmaku_count'),
    reply: num('reply', 'review'),
    favorite: num('favorite', 'fav'),
    coin: num('coin'),
    share: num('share'),
    like: num('like'),
  };
}

/** 官方 view 接口的字段映射（结构稳定，直接取）。 */
function normalizeOfficial(d, fallbackId) {
  const stat = d.stat && typeof d.stat === 'object' ? d.stat : {};
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    ...EMPTY_META,
    id: String(d.bvid || fallbackId),
    title: String(d.title || ''),
    up: String(d.owner?.name || ''),
    cover: String(d.pic || ''),
    duration: n(d.duration),
    view: n(stat.view),
    danmaku: n(stat.danmaku),
    reply: n(stat.reply),
    favorite: n(stat.favorite),
    coin: n(stat.coin),
    share: n(stat.share),
    like: n(stat.like),
  };
}
