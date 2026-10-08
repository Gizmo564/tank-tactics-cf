// Tank Tactics on Cloudflare: Worker entry. Serves the REST API (same paths
// as the original Express app) and WebSocket upgrades; static files are
// served directly by the assets binding without invoking this code.
import { signSession, verifySession, readCookie, sessionCookie, clearCookie, SSO_COOKIE, clearSsoCookie, signService, verifyHandoff } from './auth.js';
import { COLORS, PRESETS, FIELD_SPEC } from './config.js';
import { makeCode } from './lobby.js';
import { getNap, napMessage } from './nap.js';

export { GameDO } from './game-do.js';
export { DirectoryDO } from './directory-do.js';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

async function sha256(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
async function safeEqual(a, b) { // constant-time via fixed-length digests
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const dir = env => env.DIRECTORY.get(env.DIRECTORY.idFromName('main'));
const game = (env, id) => env.GAME.get(env.GAME.idFromName(id));

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  if (parseInt(req.headers.get('content-length') || '0') > 20_000) throw Object.assign(new Error('Body too large'), { status: 413 });
  try { return (await req.json()) || {}; } catch { return {}; }
}

export default {
  async fetch(req, env) {
    try { return await route(req, env); }
    catch (e) {
      console.error('unhandled', e && e.stack || e);
      return json({ ok: false, error: e.status === 413 ? 'Request too large' : 'Server error' }, e.status || 500);
    }
  }
};

const SIGNIN = 'https://0801564.xyz/signin';
// Who is this? The shared 0801564.xyz sign-in first (never an admin: that role is not in that cookie), then the old
// Tank cookie, which only matters for the super admin and for players who signed in before the move.
// The same person can be both: the player session is the default; the admin cookie (from the 0801564.xyz admin handoff,
// 2 hours) is only used on /api/admin/* and when a request says it wants to act as admin (header x-tt-as, or ?as=admin on the socket).
async function getSessions(req, env) {
  const legacy = await verifySession(readCookie(req), env.SESSION_SECRET);
  const admin = legacy && legacy.admin ? legacy : null;
  const sso = await verifySession(readCookie(req, SSO_COOKIE), env.SSO_SECRET);
  let player = sso && typeof sso.sub === 'string' && sso.sub ? { sub: sso.sub, name: sso.name, exp: sso.exp } : null;
  if (!player && legacy && !legacy.admin && env.LEGACY_PLAYER_LOGIN !== 'off') player = legacy;
  return { player, admin };
}

async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!env.SESSION_SECRET) return json({ ok: false, error: 'Server is missing SESSION_SECRET (see README: wrangler secret put SESSION_SECRET)' }, 500);
  // Nap Guard: asleep = everything game-related pauses (login and the landing keep working); no-new = no new games
  if (path === '/api/nap') return json(await getNap(env));
  const nap = path.startsWith('/ws/') || path.startsWith('/api/games') ? await getNap(env) : null;
  if (nap && nap.level === 'asleep') {
    if (path.startsWith('/ws/')) { // tell the player's screen instead of leaving it reconnecting
      const pair = new WebSocketPair();
      pair[1].accept(); pair[1].send(JSON.stringify({ type: 'nap', resetAt: nap.resetAt })); pair[1].close(1000, 'napping');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return json({ ok: false, napping: true, resetAt: nap.resetAt, error: napMessage(nap) }, 503);
  }
  const { player, admin: adminSess } = await getSessions(req, env);
  const asAdmin = path.startsWith('/api/admin/') || req.headers.get('x-tt-as') === 'admin' || url.searchParams.get('as') === 'admin';
  const session = asAdmin ? (adminSess || null) : (player || adminSess);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';

  // ---------- websocket ----------
  let m = path.match(/^\/ws\/([\w-]{8,64})$/);
  if (m) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    if (!session) return new Response('Not logged in', { status: 401 });
    const headers = new Headers(req.headers);
    headers.set('x-tt-user', JSON.stringify({ userId: session.admin ? null : session.sub, username: session.name, admin: !!session.admin }));
    return game(env, m[1]).fetch(new Request(req, { headers }));
  }

  if (!path.startsWith('/api/')) return new Response('Not found', { status: 404 });
  const body = await readBody(req);
  const method = req.method;

  // ---------- auth ----------
  if (path === '/api/auth/admin-handoff' && method === 'GET') {
    // The 0801564.xyz admin sends its signed-in admins here with a 60-second code, good once.
    const p = await verifyHandoff(url.searchParams.get('code'), env.SSO_SECRET, 'tanks');
    if (!p || !(await dir(env).rate('jti:' + p.jti, 1, 5 * 60 * 1000))) return new Response('That admin link expired or was already used. Open it again from the 0801564.xyz admin.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    const token = await signSession({ sub: 'admin', name: String(p.name || 'admin').slice(0, 30), admin: true }, env.SESSION_SECRET, Date.now(), 2 * 3600);
    return new Response(null, { status: 302, headers: { Location: '/#admin', 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(token, req.url, 2 * 3600) } });
  }
  if (path === '/api/auth/config' && method === 'GET') return json({ ok: true, signinUrl: SIGNIN, legacyPlayerLogin: env.LEGACY_PLAYER_LOGIN !== 'off' });
  if (path === '/api/auth/register' && method === 'POST') {
    return json({ ok: false, error: 'Sign-ups now happen once for all of 0801564.xyz.', signinUrl: SIGNIN }, 410);
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const { username, password } = body;
    if (!username || !password) return json({ ok: false, error: 'Callsign and password required' });
    if (!(await dir(env).rate('ip:' + ip, 30, 10 * 60 * 1000))) return json({ ok: false, error: 'Too many attempts from this network — try again later' }, 429);
    if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD && username === env.ADMIN_USERNAME) {
      if (!(await dir(env).rate('adm:' + ip, 8, 10 * 60 * 1000))) return json({ ok: false, error: 'Too many attempts — try again later' }, 429);
      if (await safeEqual(password, env.ADMIN_PASSWORD)) {
        const token = await signSession({ sub: 'admin', name: env.ADMIN_USERNAME, admin: true }, env.SESSION_SECRET);
        return json({ ok: true, isSuperAdmin: true, username: env.ADMIN_USERNAME }, 200, { 'Set-Cookie': sessionCookie(token, req.url) });
      }
      return json({ ok: false, error: 'Invalid callsign or password' });
    }
    if (env.LEGACY_PLAYER_LOGIN === 'off') return json({ ok: false, error: 'Please sign in with your 0801564.xyz account.', signinUrl: SIGNIN }, 410);
    const r = await dir(env).login(String(username), String(password));
    if (!r.ok) return json(r);
    const token = await signSession({ sub: r.user.id, name: r.user.username }, env.SESSION_SECRET);
    return json({ ok: true, userId: r.user.id, username: r.user.username }, 200, { 'Set-Cookie': sessionCookie(token, req.url) });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    h.append('Set-Cookie', clearCookie(req.url)); h.append('Set-Cookie', clearSsoCookie(req.url));
    return new Response(JSON.stringify({ ok: true }), { headers: h });
  }
  if (path === '/api/auth/me' && method === 'GET') {
    if (!session) return json({ ok: true, loggedIn: false });
    if (session.admin) return json({ ok: true, loggedIn: true, isSuperAdmin: true, username: session.name });
    return json({ ok: true, loggedIn: true, userId: session.sub, username: session.name, adminActive: !!adminSess });
  }

  if (!session && path.startsWith('/api/admin/')) return json({ ok: false, error: 'Admin only' }, 403);
  if (!session) return json({ ok: false, error: 'Not logged in' }, 401);
  const user = { userId: session.admin ? null : session.sub, username: session.name, admin: !!session.admin };

  // ---------- lobby / game list ----------
  if (path === '/api/games' && method === 'GET') return json({ ok: true, games: await dir(env).listGames(user.userId, false) });
  if (path === '/api/games/colors') return json({ ok: true, colors: COLORS });
  if (path === '/api/games/presets') return json({ ok: true, presets: PRESETS, fields: FIELD_SPEC });

  if (path === '/api/games' && method === 'POST') {
    if (nap && nap.level === 'no-new') return json({ ok: false, napping: true, resetAt: nap.resetAt, error: napMessage(nap) }, 503);
    if (user.admin) return json({ ok: false, error: 'The admin account manages games but does not play. Use a player account to create one.' });
    let code = null;
    for (let i = 0; i < 10 && !code; i++) { const c = makeCode(); if (!(await dir(env).findByCode(c))) code = c; }
    if (!code) return json({ ok: false, error: 'Could not allocate a join code, try again' });
    const id = crypto.randomUUID();
    const r = await game(env, id).call('create', user, { id, code, name: body.name, host: user, callsign: body.callsign,
      colorId: body.colorId, team: body.team, config: body.config, visibility: body.visibility });
    return json(r);
  }
  if (path === '/api/games/join-by-code' && method === 'POST') {
    if (!body.code) return json({ ok: false, error: 'Enter a join code' });
    const match = await dir(env).findByCode(String(body.code));
    if (!match) return json({ ok: false, error: 'No game with that code' });
    const r = await game(env, match.id).call('join', user, { callsign: body.callsign, colorId: body.colorId, team: body.team });
    return json(r.ok ? { ok: true, gameId: match.id } : r);
  }

  m = path.match(/^\/api\/games\/([\w-]{8,64})\/(.+)$/);
  if (m) {
    const [, gid, rest] = m;
    const g = game(env, gid);
    const call = (op, args) => g.call(op, user, args || {});
    const plain = { join: 'join', leave: 'leave', start: 'start', end: 'end' };

    if (method === 'GET' && rest === 'lobby') { const r = await call('lobby'); return json(r, r.ok === false ? 404 : 200); }
    if (method === 'GET' && rest === 'state') { const r = await call('state'); return json(r, r.ok === false ? 404 : 200); }
    if (method === 'POST' && plain[rest]) {
      const args = rest === 'join' ? { callsign: body.callsign, colorId: body.colorId, team: body.team } : {};
      return json(await call(plain[rest], args));
    }
    let a = rest.match(/^action\/(move|shoot|heal|upgrade|gift|vote)$/);
    if (method === 'POST' && a) return json(await call(a[1], { direction: body.direction, tankId: body.tankId, targetId: body.targetId, type: body.type, amount: body.amount }));
    if (method === 'POST' && rest === 'chat/send') return json(await call('chat.send', { text: body.text, toId: body.toId, groupId: body.groupId }));
    if (method === 'GET' && rest === 'chat') return json(await call('chat.list', { since: url.searchParams.get('since') }));
    if (rest === 'groups') {
      if (method === 'GET') return json(await call('groups.list'));
      if (method === 'POST') return json(await call('groups.create', { name: body.name, memberIds: body.memberIds }));
    }
    a = rest.match(/^groups\/([\w-]+)\/leave$/);
    if (method === 'POST' && a) return json(await call('groups.leave', { groupId: a[1] }));
    if (method === 'POST' && rest === 'host/grant-ap') {
      if (!body.playerId || isNaN(parseInt(body.amount))) return json({ ok: false, error: 'playerId and amount required' });
      return json(await call('host.grantAp', { playerId: body.playerId, amount: parseInt(body.amount) }));
    }
    if (method === 'POST' && rest === 'host/spawn-heart') return json(await call('host.spawnHeart'));
    if (method === 'POST' && rest === 'host/kick') {
      if (!body.playerId) return json({ ok: false, error: 'playerId required' });
      return json(await call('host.kick', { playerId: body.playerId }));
    }
    if (method === 'POST' && rest === 'host/grant-ap-all') return json(await call('host.grantApAll'));
  }

  // ---------- super admin ----------
  if (path.startsWith('/api/admin/')) {
    if (!user.admin) return json({ ok: false, error: 'Admin only' }, 403);
    if (path === '/api/admin/games' && method === 'GET') return json({ ok: true, games: await dir(env).listGames(null, true) });
    if (path === '/api/admin/backup' && method === 'GET') {
      const d = dir(env);
      const ids = await d.gameIds();
      const games = {};
      for (const id of ids) { const r = await game(env, id).call('admin.export', user); if (r.ok) games[id] = { db: r.db, chat: r.chat }; }
      const payload = { format: 'tank-tactics-cf-backup', version: 1, exportedAt: Date.now(), directory: await d.exportAll(), games };
      return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="tank-tactics-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/admin/migrate-accounts' && method === 'POST') {
      if (!env.SSO_SECRET) return json({ ok: false, error: 'SSO_SECRET is not set on this Worker' });
      const users = (await dir(env).exportAll()).users.map(u => ({ id: u.id, username: u.username, hash: u.hash, created_at: u.created_at }));
      const dryRun = body.dryRun !== false; // anything but an explicit false is a dry run
      const total = { total: users.length, imported: 0, skipped: [], renamed: [], dryRun };
      for (let i = 0; i < users.length || i === 0; i += 500) {
        const payload = JSON.stringify({ users: users.slice(i, i + 500), dryRun });
        const ts = String(Date.now());
        let res;
        try {
          res = await fetch((env.SSO_BASE || 'https://0801564.xyz') + '/api/internal/import-users', { method: 'POST',
            headers: { 'content-type': 'application/json', 'x-sso-ts': ts, 'x-sso-sig': await signService(env.SSO_SECRET, ts, payload) }, body: payload });
        } catch (e) { return json({ ok: false, error: 'Could not reach 0801564.xyz: ' + e.message, partial: total }); }
        const r = await res.json().catch(() => null);
        if (!res.ok || !r || !r.ok) return json({ ok: false, error: (r && r.error) || 'Landing refused the import (HTTP ' + res.status + ')', partial: total });
        total.imported += r.imported; total.skipped.push(...r.skipped); total.renamed.push(...r.renamed);
        if (users.length === 0) break;
      }
      return json({ ok: true, ...total });
    }
    if (path === '/api/admin/stats' && method === 'GET') return json({ ok: true, ...(await dir(env).stats()) });
    const am = path.match(/^\/api\/admin\/games\/([\w-]{8,64})(?:\/([\w-]+))?$/);
    if (am) {
      const g = game(env, am[1]);
      const call = (op, args) => g.call(op, user, args || {});
      if (method === 'GET' && !am[2]) { const r = await call('admin.detail'); return json(r, r.ok === false ? 404 : 200); }
      if (method === 'POST') {
        const needPlayer = () => (!body.playerId ? 'playerId required' : null);
        const needAmount = () => (!body.playerId || isNaN(parseInt(body.amount)) ? 'playerId and amount required' : null);
        const routes = { 'grant-ap': ['admin.grantAp', needAmount, true], 'set-ap': ['admin.setAp', needAmount, true], 'set-hearts': ['admin.setHearts', needAmount, true],
          kick: ['admin.kick', needPlayer, false], ban: ['admin.ban', needPlayer, false],
          unban: ['admin.unban', () => (!body.userId ? 'userId required' : null), false], end: ['admin.end', () => null, false] };
        const rt = routes[am[2]];
        if (rt) {
          const bad = rt[1](); if (bad) return json({ ok: false, error: bad });
          return json(await call(rt[0], { playerId: body.playerId, userId: body.userId, amount: rt[2] ? parseInt(body.amount) : undefined }));
        }
      }
    }
  }

  return json({ ok: false, error: 'Not found' }, 404);
}
