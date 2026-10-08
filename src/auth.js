// Stateless auth: PBKDF2 password hashes + HMAC-signed session cookies.
// Sessions are verified by signature alone, so they survive Durable Object
// eviction, redeploys and restarts (the old file-backed sessions did not).

const enc = new TextEncoder();
const b64u = {
  enc: bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
};

// Cloudflare Workers caps PBKDF2 at 100,000 iterations.
export const PBKDF2_ITERATIONS = 100000;

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64u.enc(salt)}$${b64u.enc(hash)}`;
}
export async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const got = await derive(password, b64u.dec(salt), parseInt(iter));
  return timingSafeEqual(got, b64u.dec(hash));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;

// payload: { sub, name, admin? }
export async function signSession(payload, secret, now = Date.now(), ttlS = SESSION_MAX_AGE_S) {
  const body = b64u.enc(enc.encode(JSON.stringify({ ...payload, exp: now + ttlS * 1000 })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64u.enc(sig)}`;
}
export async function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64u.dec(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64u.dec(body)));
    return p.exp > now ? p : null;
  } catch { return null; }
}

export const COOKIE = 'tt_session';
export function readCookie(req, name = COOKIE) {
  const m = (req.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
export function sessionCookie(token, url, maxAge = SESSION_MAX_AGE_S) {
  const secure = new URL(url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function clearCookie(url) {
  const secure = new URL(url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

// Shared 0801564.xyz sign-in cookie (issued by the landing Worker; same HMAC format as tt_session, different secret).
export const SSO_COOKIE = 'ov_sess';
export function clearSsoCookie(url) {
  const u = new URL(url), secure = u.protocol === 'https:' ? '; Secure' : '';
  const domain = u.hostname === '0801564.xyz' || u.hostname.endsWith('.0801564.xyz') ? '; Domain=.0801564.xyz' : '';
  return `${SSO_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${domain}${secure}`;
}
// One-time code from the 0801564.xyz admin (60 s, bound to 'tanks'); same format as the landing Worker's signHandoff.
export async function verifyHandoff(token, secret, aud, now = Date.now()) {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret + '|handoff|blob'), b64u.dec(sig), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(b64u.dec(body)));
    return p.exp > now && p.typ === 'handoff' && p.aud === aud && typeof p.jti === 'string' ? p : null;
  } catch { return null; }
}
// Server-to-server calls to the landing Worker, signed with the shared secret.
export async function signService(secret, ts, body) {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret + '|svc'), enc.encode(`${ts}.${body}`)));
  return b64u.enc(sig);
}

export function validateRegistration(username, password) {
  if (!username || !password) return 'Callsign and password required';
  if (username.length < 2 || username.length > 20) return 'Callsign must be 2-20 characters';
  if (!/^[a-zA-Z0-9 _-]+$/.test(username)) return 'Callsign can only use letters, numbers, spaces, - and _';
  if (password.length < 4) return 'Password must be at least 4 characters';
  if (password.length > 200) return 'Password too long';
  return null;
}
