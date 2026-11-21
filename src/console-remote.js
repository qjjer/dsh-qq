// 控制台远程访问：路径前缀 + 域名白名单（只作用于 pathPrefix 命中时）
//
// 设计目标（用户要求）：
//   · 通过 cloudflared 暴露 qb.example.com → 127.0.0.1:3100
//   · 访问必须带一个**短路径后缀**（如 /admin），不带就 404
//   · 不改动本机直接访问（http://127.0.0.1:3100/）的行为
//
// 安全边界（必须说清楚）：
//   · 路径前缀不是密码。它只挡「随手扫到域名」的人，挡不住知道前缀的人。
//   · 真正的鉴权仍然是 consoleToken（x-console-token / ?token=）。
//   · 前缀 + token 两者都要，缺一不可。
//
// 实现方式：在 URL 解析之后、任何路由分发之前，剥掉前缀并改写 url.pathname；
// Host 白名单在「带前缀」时才放行外部域名（本机回环始终放行）。

/** 规范化用户配置的路径前缀：只接受一个层级、字母数字下划线横线。 */
export function normalizePathPrefix(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // 去掉首尾斜杠，只允许单段
  const stripped = s.replace(/^\/+|\/+$/g, '');
  if (!stripped) return '';
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(stripped)) return '';
  return stripped;
}

/**
 * 判断请求路径是否命中前缀并返回剥离后的路径。
 * 命中 `/admin` 或 `/admin/...`；不命中返回 null。
 * @param {string} pathname url.pathname（以 / 开头）
 * @param {string} prefix   normalizePathPrefix 的结果
 * @returns {string|null} 剥离前缀后的路径（以 / 开头）
 */
export function stripPathPrefix(pathname, prefix) {
  if (!prefix) return pathname;
  const p = String(pathname ?? '/');
  const want = `/${prefix}`;
  if (p === want) return '/';
  if (p.startsWith(`${want}/`)) return p.slice(want.length) || '/';
  return null;
}

/**
 * 给定请求的 Host 与是否带前缀，判断是否放行。
 *
 * - 本机回环（127.0.0.1 / localhost / [::1]）始终放行 —— 保持原有本地体验。
 * - 外部域名只在「带前缀」时放行，且必须命中 allowRemoteHosts。
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkConsoleHost({ hostHeader, port, prefixMatched, allowRemoteHosts = [] }) {
  const host = String(hostHeader ?? '').toLowerCase().trim();
  const p = Number(port);
  const loopback = [`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`, `127.0.0.1`, 'localhost', '[::1]'];
  if (loopback.includes(host)) return { ok: true };
  if (!prefixMatched) {
    return { ok: false, reason: `Host 头不被允许（${hostHeader || '缺失'}）：控制台只接受本机回环访问` };
  }
  const allow = new Set(allowRemoteHosts.map((h) => String(h ?? '').toLowerCase().trim()).filter(Boolean));
  const hostname = host.replace(/:\d+$/, '');
  if (allow.has(host) || allow.has(hostname)) return { ok: true };
  return {
    ok: false,
    reason: `Host 头不被允许（${hostHeader || '缺失'}）：请在 config.json 的 console.allowRemoteHosts 里加入该域名`
  };
}
