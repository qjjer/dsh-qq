// GitHub 链接 → OG 卡片图
//
// 需求：群里发 GitHub 链接，回一张 GitHub 官方预览卡片（1200x600 PNG）。
// 只要图，不需要 API 元数据。
//
// 网络：默认走 gh-proxy 镜像（用户要求不直连 GitHub）。
//   实测 gh-proxy 对 opengraph.githubassets.com 稳定可用；
//   jsdelivr 无法代理这张图（它只代理仓库内的文件，不代理 GitHub 实时渲染的图）。
//
// 图来源：https://opengraph.githubassets.com/1/{owner}/{repo}
//   尾部的路径（/issues/3、/releases）不影响出图，卡片始终展示仓库主页信息。

import { safeFetchBuffer, looksLikeImageBuffer } from './safe-fetch.js';

/** 默认镜像。设为空串则直连 GitHub。 */
export const DEFAULT_MIRROR = 'https://gh-proxy.com/';

/** GitHub 保留的一级路径，不是用户名。 */
const RESERVED_OWNERS = new Set([
  'settings', 'orgs', 'organizations', 'sponsors', 'marketplace', 'explore', 'topics',
  'notifications', 'pulls', 'issues', 'codespaces', 'features', 'pricing', 'login',
  'join', 'about', 'site', 'contact', 'apps', 'collections', 'trending', 'new',
  'security', 'enterprise', 'team', 'users', 'search', 'readme', 'dashboard',
]);

// 必须保证 github.com 是一个独立的域名：
//   · 前面是字符串开头、空白、或 http(s):// —— 不能是别的域名的一部分
//   · 前面不能紧跟字母/数字/点/横线（否则 gitlab.com、mygithub.com 会被误判）
const GH_RE = /(?:^|[\s(（<\[「『])https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(\/[^\s?#]*)?/i;
// 无协议头的裸域名（github.com/a/b）单独处理，避免与上面的锚定重复
const GH_BARE_RE = /(?:^|[\s(（<\[「『])(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(\/[^\s?#]*)?/i;

/**
 * 从文本里识别 GitHub 仓库引用。
 * @returns {{owner:string, repo:string, path:string}|null}
 */
export function parseGitHubRef(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  const m = GH_RE.exec(s) ?? GH_BARE_RE.exec(s);
  if (!m) return null;
  const owner = m[1];
  const repo = String(m[2]).replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  if (!/[A-Za-z0-9]/.test(repo)) return null;
  const path = String(m[3] || '').replace(/\/+$/, '');
  return { owner, repo, path };
}

/** 套镜像前缀。 */
export function mirrorUrl(originalUrl, mirror = DEFAULT_MIRROR) {
  const base = String(mirror ?? '').trim();
  if (!base) return originalUrl;
  return (base.endsWith('/') ? base : base + '/') + originalUrl;
}

/**
 * 抓 OG 卡片图。
 * @returns {Promise<Buffer|null>} PNG 字节；失败返回 null
 */
export async function fetchOgCard(owner, repo, { mirror = DEFAULT_MIRROR } = {}) {
  const url = mirrorUrl(
    `https://opengraph.githubassets.com/1/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    mirror
  );
  try {
    const fetched = await safeFetchBuffer(url, 8 * 1024 * 1024);
    const buf = fetched?.buffer ?? fetched;
    if (!Buffer.isBuffer(buf) || buf.length < 4000) return null;
    if (!looksLikeImageBuffer(buf)) return null;
    return buf;
  } catch {
    return null;
  }
}
