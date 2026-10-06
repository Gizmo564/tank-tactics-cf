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
export async function signSession(payload, secret, now = Date.now()) {
  const body = b64u.enc(enc.encode(JSON.stringify({ ...payload, exp: now + SESSION_MAX_AGE_S * 1000 })));
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
export function sessionCookie(token, url) {
  const secure = new URL(url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}`;
}
export function clearCookie(url) {
  const secure = new URL(url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function validateRegistration(username, password) {
  if (!username || !password) return 'Callsign and password required';
  if (username.length < 2 || username.length > 20) return 'Callsign must be 2-20 characters';
  if (!/^[a-zA-Z0-9 _-]+$/.test(username)) return 'Callsign can only use letters, numbers, spaces, - and _';
  if (password.length < 4) return 'Password must be at least 4 characters';
  if (password.length > 200) return 'Password too long';
  return null;
}
