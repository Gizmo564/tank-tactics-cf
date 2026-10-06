import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import * as L from '../src/lobby.js';
import * as S from '../src/schedule.js';
import * as A from '../src/admin-ops.js';
import { sanitizeConfig } from '../src/config.js';

function mkGame(cfg = {}, users = ['alice', 'bob', 'carol']) {
  const db = L.createGameDb({ id: 'g1', code: 'ABCDE', name: 't', hostUserId: 'u-alice', hostUsername: 'alice', configOverrides: cfg });
  users.forEach(n => assert.ok(L.joinLobby(db, 'u-' + n, n, n).ok));
  return db;
}
function startAt(db, pos) { // start, then place players deterministically
  assert.ok(L.startGame(db, 'u-alice').ok);
  db.players.forEach((p, i) => { p.x = pos[i][0]; p.y = pos[i][1]; });
}
const P = (db, n) => db.players.find(p => p.username === n);

test('sanitizeConfig clamps and rejects bad enums', () => {
  const c = sanitizeConfig({ gridWidth: 9999, winCondition: 'x', maxHearts: 1, startingHearts: 5 });
  assert.equal(c.gridWidth, 40); assert.equal(c.winCondition, 'lastStanding'); assert.equal(c.maxHearts, 5);
});

test('lobby: join, duplicate callsign, full, ban, start rules', () => {
  const db = mkGame({ maxPlayers: 3 });
  assert.equal(L.joinLobby(db, 'u-dave', 'dave', 'dave').error, 'Game is full (max 3 tanks)');
  assert.equal(L.joinLobby(db, 'u-alice', 'alice', 'BOB').error, 'Someone in this game already has that callsign');
  assert.equal(L.startGame(db, 'u-bob').error, 'Only the host can start the game');
  db.meta.bannedUserIds.push('u-x');
  assert.equal(L.joinLobby(db, 'u-x', 'x', 'x').error, 'You have been banned from this game');
  assert.ok(L.startGame(db, 'u-alice').ok);
  assert.equal(L.joinLobby(db, 'u-new', 'new', 'new').error, 'This game has already started');
  assert.equal(new Set(db.players.map(p => `${p.x},${p.y}`)).size, 3, 'unique spawn cells');
});

test('lobby: host leaves -> promoted; last leaves -> deleted', () => {
  const db = mkGame({}, ['alice', 'bob']);
  const r = L.leaveLobby(db, 'u-alice');
  assert.equal(r.newHost.userId, 'u-bob'); assert.equal(db.meta.hostUserId, 'u-bob');
  assert.equal(L.leaveLobby(db, 'u-bob').gameDeleted, true);
});

test('randomEmptyPos never loops on a full/nearly full board', () => {
  const db = mkGame({ gridWidth: 5, gridHeight: 5, maxPlayers: 60 }, []);
  for (let i = 0; i < 24; i++) db.players.push({ id: 'p' + i, x: i % 5, y: Math.floor(i / 5), isDead: false });
  assert.deepEqual(E.randomEmptyPos(db), { x: 4, y: 4 });
  db.players.push({ id: 'last', x: 4, y: 4 });
  assert.throws(() => E.randomEmptyPos(db), /full/);
});

test('move: costs AP, bounds, occupied, diagonal, heart pickup', () => {
  const db = mkGame(); startAt(db, [[0, 0], [1, 0], [5, 5]]);
  const a = P(db, 'alice');
  assert.match(E.movePlayer(db, 'u-alice', 'down').error, /Not enough AP/);
  a.ap = 5;
  assert.equal(E.movePlayer(db, 'u-alice', 'up').error, 'That would drive off the map');
  assert.equal(E.movePlayer(db, 'u-alice', 'right').error, 'Square is occupied');
  assert.equal(E.movePlayer(db, 'u-alice', 'nope').error, 'Invalid direction');
  db.heartPickups.push({ x: 1, y: 1, collected: false });
  const r = E.movePlayer(db, 'u-alice', 'downright');
  assert.ok(r.ok && r.heartPickedUp); assert.equal(a.hearts, 4); assert.equal(a.ap, 4); assert.deepEqual([a.x, a.y], [1, 1]);
});

test('shoot: range, friendly fire, kill transfers AP, last standing wins', () => {
  const db = mkGame({ endgamePlayerCount: 1 }); startAt(db, [[0, 0], [2, 0], [9, 9]]);
  const [a, b, c] = ['alice', 'bob', 'carol'].map(n => P(db, n));
  a.ap = 2; b.ap = 4; a.range = 2;
  assert.match(E.shootPlayer(db, 'u-alice', c.id).error, /Out of range/);
  b.hearts = 1;
  const r = E.shootPlayer(db, 'u-alice', b.id);
  assert.ok(r.ok && r.targetDead); assert.equal(a.ap, 1 + 4); assert.equal(b.ap, 0); assert.equal(a.kills, 1);
  assert.equal(db.meta.status, 'active'); // carol still alive, alice alive => 2 alive > 1
  c.x = 1; c.y = 0; c.hearts = 1; a.ap = 3;
  const r2 = E.shootPlayer(db, 'u-alice', c.id);
  assert.match(r2.message, /alice wins — game over/); assert.equal(db.meta.status, 'ended');
  assert.match(E.movePlayer(db, 'u-alice', 'down').error, /not currently active/);
});

test('win condition: killTarget and lastTeamStanding', () => {
  const k = mkGame({ winCondition: 'killTarget', killTargetCount: 1 }); startAt(k, [[0, 0], [1, 0], [3, 3]]);
  P(k, 'alice').ap = 1; P(k, 'bob').hearts = 1;
  assert.match(E.shootPlayer(k, 'u-alice', P(k, 'bob').id).message, /alice \(1 kills\) wins/);

  const t = mkGame({ teamsEnabled: true, teamCount: 2, winCondition: 'lastTeamStanding' }, ['alice', 'bob', 'carol', 'dan']);
  startAt(t, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  const ps = t.players; // balanced: alice t1, bob t2, carol t1, dan t2
  assert.deepEqual(ps.map(p => p.team), [1, 2, 1, 2]);
  assert.match(E.shootPlayer(t, 'u-alice', ps[2].id).error, /own team/);
  ps[0].ap = 5; ps[1].hearts = 1; ps[3].hearts = 1; ps[0].range = 5;
  E.shootPlayer(t, 'u-alice', ps[1].id);
  assert.equal(t.meta.status, 'active');
  const r = E.shootPlayer(t, 'u-alice', ps[3].id);
  assert.match(r.message, /Team 1 wins/);
});

test('fog of war hides out-of-range tanks and other players\' AP', () => {
  const db = mkGame({ fogOfWarEnabled: true }); startAt(db, [[0, 0], [1, 1], [9, 9]]);
  P(db, 'alice').ap = 7; P(db, 'bob').ap = 3;
  const s = E.getGameState(db, 'u-alice');
  const bob = s.players.find(p => p.callsign === 'bob'), carol = s.players.find(p => p.callsign === 'carol');
  assert.equal(bob.x, 1); assert.equal(carol.x, null); assert.equal(s.fogHidCount, 1);
  assert.equal(bob.ap, null); assert.equal(s.players.find(p => p.isOwn).ap, 7);
});

test('gifting: hearts revive the fallen, AP needs range, must keep 1 heart', () => {
  const db = mkGame(); startAt(db, [[0, 0], [1, 0], [9, 9]]);
  const [a, b, c] = ['alice', 'bob', 'carol'].map(n => P(db, n));
  b.isDead = true; b.hearts = 0; a.hearts = 3;
  assert.match(E.sendGift(db, 'u-alice', b.id, 'ap', 1).error, /Can only send hearts/);
  assert.match(E.sendGift(db, 'u-alice', c.id, 'hearts', 1).error, /Out of range/);
  assert.match(E.sendGift(db, 'u-alice', b.id, 'hearts', 3).error, /keep at least 1/);
  assert.ok(E.sendGift(db, 'u-alice', b.id, 'hearts', 1).ok);
  assert.equal(b.isDead, false); assert.equal(b.hearts, 1); assert.equal(a.hearts, 2);
});

test('grantDailyAP: haunting skips the voted tank', () => {
  const db = mkGame({ apSchedule: 'always' }); startAt(db, [[0, 0], [1, 0], [2, 0]]);
  const [a, b, c] = ['alice', 'bob', 'carol'].map(n => P(db, n));
  b.isDead = true; b.hearts = 0;
  assert.ok(E.juryVote(db, 'u-bob', c.id).ok);
  assert.equal(E.juryVote(db, 'u-alice', c.id).error, 'Only fallen tanks can cast jury votes');
  E.grantDailyAP(db);
  assert.equal(a.ap, 1); assert.equal(c.ap, 0); assert.equal(b.ap, 0);
  assert.ok(db.gameLog.some(l => l.type === 'haunt'));
});

test('host: cannot self-grant, cooldown on grant-all, kick', () => {
  const db = mkGame(); startAt(db, [[0, 0], [1, 0], [2, 0]]);
  assert.match(E.hostGrantAP(db, 'u-alice', P(db, 'alice').id, 2).error, /own tank/);
  assert.ok(E.hostGrantAP(db, 'u-alice', P(db, 'bob').id, 2).ok);
  assert.equal(E.hostGrantAP(db, 'u-bob', P(db, 'alice').id, 2).error, 'Host only');
  assert.ok(E.hostGrantAllAP(db, 'u-alice').ok);
  assert.match(E.hostGrantAllAP(db, 'u-alice').error, /wait about/);
  assert.ok(E.hostKick(db, 'u-alice', P(db, 'carol').id).ok); assert.equal(db.players.length, 2);
});

test('chat: broadcast vs whisper vs group visibility', () => {
  const db = mkGame(); startAt(db, [[0, 0], [1, 0], [2, 0]]);
  const [a, b, c] = ['alice', 'bob', 'carol'].map(n => P(db, n));
  const w = E.buildChatMessage(db, 'u-alice', { text: 'psst', toId: b.id }).message;
  assert.ok(E.canSeeChat(db, 'u-alice', w) && E.canSeeChat(db, 'u-bob', w) && !E.canSeeChat(db, 'u-carol', w));
  assert.match(E.createGroup(db, 'u-alice', 'g', [b.id]).error, /at least 2/);
  const g = E.createGroup(db, 'u-alice', 'g', [b.id, c.id]).group;
  const gm = E.buildChatMessage(db, 'u-alice', { text: 'hi', groupId: g.id }).message;
  assert.ok(E.canSeeChat(db, 'u-carol', gm));
  E.leaveGroup(db, 'u-carol', g.id);
  assert.ok(!E.canSeeChat(db, 'u-carol', gm));
  assert.equal(E.buildChatMessage(db, 'u-alice', { text: 'x'.repeat(301) }).error, 'Message too long (max 300 chars)');
  db.meta.config.chatBroadcastEnabled = false;
  assert.match(E.buildChatMessage(db, 'u-alice', { text: 'hi' }).error, /turned off/);
});

test('schedule: timers set on start, fire when due, next wake', () => {
  const db = mkGame({ apSchedule: 'always', apIntervalHours: 1, apGrantWindowHours: 0, heartSpawnIntervalHours: 2, heartSpawnRandomWindowHours: 0 });
  startAt(db, [[0, 0], [1, 0], [2, 0]]);
  const t0 = 1_000_000;
  S.ensureSchedule(db, t0, () => 0);
  assert.equal(db.meta.nextAPGrant, t0 + 3600_000); assert.equal(S.nextWake(db), t0 + 3600_000);
  assert.equal(S.runDue(db, t0 + 10, () => 0).changed, false);
  assert.ok(S.runDue(db, t0 + 3600_000, () => 0).changed);
  assert.equal(P(db, 'alice').ap, 1);
  S.runDue(db, t0 + 7200_000, () => 0);
  assert.equal(db.heartPickups.length, 1);
});

test('admin ops: set hearts down/up, ban blocks rejoin', () => {
  const db = mkGame(); const b = P(db, 'bob');
  assert.ok(A.setHearts(db, b.id, 0).isDead); assert.equal(A.setHearts(db, b.id, 99).hearts, 10);
  assert.ok(A.ban(db, b.id).ok);
  assert.equal(L.joinLobby(db, 'u-bob', 'bob', 'bob').error, 'You have been banned from this game');
  A.unban(db, 'u-bob'); assert.ok(L.joinLobby(db, 'u-bob', 'bob', 'bob').ok);
});

test('grantDailyAP: workdays schedule skips weekends, force overrides', () => {
  const db = mkGame({ apSchedule: 'workdays' }); startAt(db, [[0, 0], [1, 0], [2, 0]]);
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T12:00:00Z') }); // Saturday (UTC noon: Saturday in all US zones)
  try {
    assert.equal(E.grantDailyAP(db), 'Weekend — AP skipped'); assert.equal(P(db, 'alice').ap, 0);
    assert.match(E.grantDailyAP(db, true), /Granted AP to 3/); assert.equal(P(db, 'alice').ap, 1);
    mock.timers.setTime(new Date('2026-10-12T12:00:00Z').getTime()); // Monday
    assert.match(E.grantDailyAP(db), /Granted AP to 3/); assert.equal(P(db, 'alice').ap, 2);
  } finally { mock.timers.reset(); }
});
