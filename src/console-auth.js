// 控制台短密码登录：用「短密码 → 换取会话」替代「必须手抄 48 位 token」
//
// 为什么需要它：
//   consoleToken 是 48 位随机串，存在本机 state/console-token 里。远程访问时人不在电脑边，
//   读不到那个文件，也就拿不到 token —— 这是真实使用场景下的死结。
//
// 设计要点：
//   · 密码明文**不落盘**：config.json 里存的是 scrypt 派生结果（salt + hash）。
//   · 登录成功后签发 HttpOnly + SameSite=Strict 的会话 Cookie，浏览器自动带上，
//     不用每次输密码；服务端只存会话的 HMAC，不存明文。
//   · 会话有 TTL（默认 7 天），可随时通过换密码让全部旧会话失效。
//   · 定长比较，避免时序侧信道。
//   · **只在本机回环或已配置的外部域名下可用**（复用 console-remote 的判定）。
//
// 安全边界（必须说清楚）：
//   · 短密码强度远低于 48 位随机 token。必须配足够长的密码（建议 ≥ 12 位）+
//     失败次数限制，否则等于把控制台交给暴力破解。
//   · 这是「便利性换安全」的取舍。想更高安全请用 Cloudflare Access。

import crypto from 'node:crypto';

export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
export const MIN_PASSWORD_LEN = 8;
const SCRYPT_KEYLEN = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** 生成密码的存储形式：scrypt(salt) 的 hex。绝不存明文。 */
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const pwd = String(password ?? '');
  const derived = crypto.scryptSync(pwd, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return { algo: 'scrypt', N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt, hash: derived.toString('hex') };
}

/** 定长比较校验密码。 */
export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'object') return false;
  const { salt, hash, N, r, p } = stored;
  if (!salt || !hash) return false;
  try {
    const derived = crypto.scryptSync(String(password ?? ''), salt, SCRYPT_KEYLEN, {
      N: Number(N) || SCRYPT_N,
      r: Number(r) || SCRYPT_R,
      p: Number(p) || SCRYPT_P
    }).toString('hex');
    const a = Buffer.from(derived, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** 密码是否够长（避免用户设个 123 就当密码）。 */
export function validatePasswordStrength(password) {
  const s = String(password ?? '');
  if (s.length < MIN_PASSWORD_LEN) return { ok: false, reason: `密码至少 ${MIN_PASSWORD_LEN} 位` };
  if (s.length > 200) return { ok: false, reason: '密码过长（上限 200 位）' };
  // 太弱：纯数字、纯重复字符
  if (/^\d+$/.test(s)) return { ok: false, reason: '不能是纯数字' };
  if (/^(.)\1+$/.test(s)) return { ok: false, reason: '不能是单一字符重复' };
  return { ok: true };
}

/**
 * 会话管家：签发/校验/吊销。
 * 会话本身不存明文 —— cookie 里放 `<id>.<hmac>`，服务端只存 id → 过期时间。
 */
export function createSessionStore({ ttlMs = DEFAULT_SESSION_TTL_MS, now = Date.now, secret } = {}) {
  const key = Buffer.from(String(secret ?? crypto.randomBytes(32).toString('hex')), 'utf8');
  /** id -> expiresAt */
  const sessions = new Map();

  function sign(id) {
    return crypto.createHmac('sha256', key).update(id).digest('hex').slice(0, 32);
  }

  function issue() {
    const id = crypto.randomBytes(24).toString('hex');
    const expiresAt = now() + ttlMs;
    sessions.set(id, expiresAt);
    return { cookie: `${id}.${sign(id)}`, expiresAt, id };
  }

  function verify(cookieValue) {
    const raw = String(cookieValue ?? '');
    const dot = raw.lastIndexOf('.');
    if (dot <= 0) return false;
    const id = raw.slice(0, dot);
    const mac = raw.slice(dot + 1);
    const expected = sign(id);
    const a = Buffer.from(mac, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const expiresAt = sessions.get(id);
    if (!expiresAt) return false;
    if (now() > expiresAt) {
      sessions.delete(id);
      return false;
    }
    return true;
  }

  function revokeAll() {
    sessions.clear();
  }

  /** 清理过期会话，避免长期运行时 Map 无界增长。 */
  function sweep() {
    const t = now();
    for (const [id, exp] of sessions) {
      if (t > exp) sessions.delete(id);
    }
  }

  return { issue, verify, revokeAll, sweep, size: () => sessions.size };
}

/** 从 Cookie 头里取指定名字的值。 */
export function readCookie(cookieHeader, name) {
  const raw = String(cookieHeader ?? '');
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

/** 构造 Set-Cookie 头。HttpOnly + SameSite=Strict + Secure（外部域名时）。 */
export function buildSessionCookie({ name, value, maxAgeMs, secure }) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/** 构造清除 Cookie 的头。 */
export function buildClearCookie({ name, secure }) {
  const bits = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/**
 * 登录失败限流：按来源 IP 计数，超阈值后冷却。
 * 没有它的话，短密码会被在线暴力破解。
 */
export function createLoginLimiter({ maxFailures = 5, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  /** ip -> { count, firstAt, blockedUntil } */
  const state = new Map();
  function key(ip) {
    return String(ip ?? '').trim() || 'unknown';
  }
  function allowed(ip) {
    const st = state.get(key(ip));
    if (!st) return { ok: true };
    if (st.blockedUntil && now() < st.blockedUntil) {
      return { ok: false, retryAfterMs: st.blockedUntil - now() };
    }
    return { ok: true };
  }
  function recordFailure(ip) {
    const k = key(ip);
    const t = now();
    let st = state.get(k);
    if (!st || t - st.firstAt > windowMs) {
      st = { count: 0, firstAt: t, blockedUntil: 0 };
      state.set(k, st);
    }
    st.count += 1;
    if (st.count >= maxFailures) {
      st.blockedUntil = t + windowMs;
      st.count = 0;
      st.firstAt = t;
    }
    return st;
  }
  function recordSuccess(ip) {
    state.delete(key(ip));
  }
  return { allowed, recordFailure, recordSuccess };
}

/** 登录页 HTML：极简，只负责输密码。 */
export function loginPageHtml({ action, error = '' }) {
  const err = error ? `<p class="err">${String(error).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))}</p>` : '';
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>控制台登录</title>
<style>
  :root { color-scheme: light dark }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; display: flex;
         min-height: 100vh; margin: 0; align-items: center; justify-content: center;
         background: #0f1115; color: #e6e6e6 }
  form { background: #171a21; padding: 28px 32px; border-radius: 12px; min-width: 280px;
         box-shadow: 0 8px 32px rgba(0,0,0,.4) }
  h1 { font-size: 17px; margin: 0 0 18px; font-weight: 600 }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 15px;
          border: 1px solid #2c313c; border-radius: 8px; background: #0f1115; color: inherit }
  input:focus { outline: 2px solid #4d6bfe; outline-offset: -1px }
  button { margin-top: 14px; width: 100%; padding: 10px; font-size: 15px; cursor: pointer;
           border: 0; border-radius: 8px; background: #4d6bfe; color: #fff; font-weight: 600 }
  button:hover { background: #3f59db }
  .err { color: #ff6b6b; font-size: 13px; margin: 0 0 12px }
  .hint { color: #6b7280; font-size: 12px; margin-top: 14px; text-align: center }
</style>
<form method="POST" action="${action}">
  <h1>QQ 桥接控制台</h1>
  ${err}
  <input type="password" name="password" placeholder="访问密码" autofocus autocomplete="current-password" required>
  <button type="submit">登录</button>
  <p class="hint">登录后本机记住 7 天，不用每次输</p>
</form>`;
}
