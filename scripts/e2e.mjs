// End-to-end test against a running server (wrangler dev or deployed).
// Usage: node scripts/e2e.mjs [baseUrl]
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
const suffix = Math.random().toString(36).slice(2, 7);

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async api(path, method = 'GET', body) {
    const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null), raw: r };
  }
  ws(gameId) {
    const w = new WebSocket(BASE.replace('http', 'ws') + '/ws/' + gameId, { headers: { Cookie: this.cookie } });
    w.msgs = []; w.onmessage = e => w.msgs.push(JSON.parse(e.data));
    return new Promise((res, rej) => { w.onopen = () => res(w); w.onerror = e => rej(new Error('ws error ' + (e.message || ''))); });
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const names = ['ann', 'ben', 'cy'].map(n => `${n}${suffix}`);
const [A, B, C] = names.map(n => new Client(n));

console.log('auth');
let r = await A.api('/api/auth/me'); ok(r.body.loggedIn === false, 'anonymous /me');
r = await A.api('/api/games'); ok(r.status === 401, 'games requires login');
for (const c of [A, B, C]) { r = await c.api('/api/auth/register', 'POST', { username: c.name, password: 'pw1234' }); ok(r.body.ok, `register ${c.name}`); }
r = await new Client('x').api('/api/auth/register', 'POST', { username: names[0], password: 'pw1234' }); ok(r.body.error === 'That callsign is already taken', 'duplicate name rejected');
r = await new Client('x').api('/api/auth/login', 'POST', { username: names[0], password: 'wrong' }); ok(r.body.error === 'Invalid callsign or password', 'bad password rejected');
const A2 = new Client('a2'); r = await A2.api('/api/auth/login', 'POST', { username: names[0].toUpperCase(), password: 'pw1234' }); ok(r.body.ok, 'login case-insensitive');
r = await A2.api('/api/auth/me'); ok(r.body.loggedIn && r.body.username === names[0], 'cookie session works');

console.log('lobby');
r = await A.api('/api/games/presets'); ok(r.body.presets.length === 5, 'presets');
r = await A.api('/api/games', 'POST', { name: 'E2E', callsign: 'Ann', colorId: 'teal', visibility: 'public', config: { gridWidth: 8, gridHeight: 8, maxPlayers: 4, apSchedule: 'always', apIntervalHours: 1, endgamePlayerCount: 1, startingHearts: 1 } });
ok(r.body.ok && r.body.code?.length === 5, 'create game'); const gid = r.body.gameId, code = r.body.code;
r = await B.api('/api/games/join-by-code', 'POST', { code: code.toLowerCase(), callsign: 'Ben', colorId: 'coral' }); ok(r.body.ok && r.body.gameId === gid, 'join by code (case-insens)');
r = await C.api(`/api/games/${gid}/join`, 'POST', { callsign: 'Ben', colorId: 'sky' }); ok(r.body.error?.includes('callsign'), 'duplicate callsign rejected');
r = await C.api(`/api/games/${gid}/join`, 'POST', { callsign: 'Cy', colorId: 'sky' }); ok(r.body.ok, 'join by id');
r = await C.api('/api/games'); const row = r.body.games.find(g => g.id === gid); ok(row && row.playerCount === 3 && row.status === 'lobby', 'directory lists game with 3 players');
r = await B.api(`/api/games/${gid}/start`, 'POST'); ok(r.body.error === 'Only the host can start the game', 'non-host cannot start');

console.log('websocket + start');
const wsA = await A.ws(gid), wsB = await B.ws(gid);
await sleep(200); ok(wsA.msgs[0]?.type === 'state' && wsA.msgs[0].state.status === 'lobby', 'ws initial state');
const noCookie = new Client('nc'); let wsFail = false; try { await noCookie.ws(gid); } catch { wsFail = true; } ok(wsFail, 'ws rejected without session');
r = await A.api(`/api/games/${gid}/start`, 'POST'); ok(r.body.ok, 'host starts');
await sleep(300);
ok(wsB.msgs.at(-1).state.status === 'active', 'ws pushed active state to other player');
r = await A.api(`/api/games/${gid}/state`); const sA = r.body.state; const me = sA.players.find(p => p.isOwn);
ok(me.ap === 0, 'own AP visible (starts at 0)');
r = await A.api(`/api/games/${gid}/host/grant-ap-all`, 'POST'); ok(r.body.ok, 'host grants AP to all');
r = await A.api(`/api/games/${gid}/host/grant-ap-all`, 'POST'); ok(/wait about/.test(r.body.error || ''), 'grant-all cooldown enforced');
r = await A.api(`/api/games/${gid}/state`); ok(r.body.state.players.find(p => p.isOwn).ap === 1, 'AP granted (+1) and visible to owner'); ok(sA.players.filter(p => !p.isOwn).every(p => p.ap === null), "others' AP hidden");

console.log('actions');
const before = wsB.msgs.length;
r = await A.api(`/api/games/${gid}/action/move`, 'POST', { direction: 'up' });
if (!r.body.ok) r = await A.api(`/api/games/${gid}/action/move`, 'POST', { direction: 'down' });
ok(r.body.ok, 'move'); await sleep(250);
ok(wsB.msgs.length > before && wsB.msgs.some(m => m.type === 'fx'), 'ws pushed state + fx to B after A moved');
r = await A.api(`/api/games/${gid}/action/shoot`, 'POST', { targetId: 'nope' }); ok(r.body.error === 'Target not found', 'shoot unknown target rejected');
r = await B.api(`/api/games/${gid}/action/vote`, 'POST', { targetId: me.id }); ok(r.body.error === 'Only fallen tanks can cast jury votes', 'alive cannot vote');

console.log('chat');
r = await A.api(`/api/games/${gid}/chat/send`, 'POST', { text: 'hello all' }); ok(r.body.ok, 'broadcast');
await sleep(150); ok(wsB.msgs.some(m => m.type === 'chat' && m.message.text === 'hello all'), 'chat pushed live');
const bId = (await B.api(`/api/games/${gid}/state`)).body.state.players.find(p => p.isOwn).id;
r = await A.api(`/api/games/${gid}/chat/send`, 'POST', { text: 'secret', toId: bId }); ok(r.body.ok, 'whisper');
await sleep(150);
r = await C.api(`/api/games/${gid}/chat`); ok(r.body.messages.some(m => m.text === 'hello all') && !r.body.messages.some(m => m.text === 'secret'), 'C sees broadcast but not whisper');
r = await B.api(`/api/games/${gid}/chat`); ok(r.body.messages.some(m => m.text === 'secret'), 'B sees whisper');
ok(!wsB.msgs.some(m => m.type === 'chat' && m.message.text === 'secret') === false, 'whisper pushed to recipient');

console.log('host + admin');
r = await B.api(`/api/games/${gid}/host/spawn-heart`, 'POST'); ok(r.body.error === 'Host only', 'non-host denied');
r = await A.api(`/api/games/${gid}/host/spawn-heart`, 'POST'); ok(r.body.ok, 'host spawns heart');
r = await A.api('/api/admin/games'); ok(r.status === 403, 'player denied admin routes');
const ADM = new Client('adm'); r = await ADM.api('/api/auth/login', 'POST', { username: 'admin', password: 'admin' }); ok(r.body.isSuperAdmin, 'admin login');
r = await ADM.api('/api/admin/games'); ok(r.body.games.some(g => g.id === gid), 'admin lists games');
r = await ADM.api(`/api/admin/games/${gid}`); ok(r.body.game.players.length === 3 && r.body.game.chat.length === 2, 'admin detail incl. whispers');
r = await ADM.api(`/api/games/${gid}/action/move`, 'POST', { direction: 'up' }); ok(!r.body.ok, 'admin cannot play');
r = await ADM.api(`/api/admin/games/${gid}/set-hearts`, 'POST', { playerId: bId, amount: 0 }); ok(r.body.ok && r.body.isDead, 'admin sets hearts to 0');
r = await ADM.api(`/api/admin/games/${gid}/set-ap`, 'POST', { playerId: bId, amount: 7 }); ok(r.body.ap === 7, 'admin sets AP');
r = await ADM.api('/api/admin/backup'); const bk = r.body; ok(bk.format === 'tank-tactics-cf-backup' && bk.games[gid] && bk.directory.users.length >= 3, 'backup export has users + game');

console.log('persistence across sessions');
r = await A2.api('/api/games'); ok(r.body.games.some(g => g.id === gid), 'game listed for other session of same user');
r = await A2.api(`/api/games/${gid}/state`); ok(r.body.state.players.length === 3, 'state persisted');

wsA.close(); wsB.close();
console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL E2E CHECKS PASSED');
process.exit(fails ? 1 : 0);
