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
  db.players.forEach((p, i) => { p.tanks[0].x = pos[i][0]; p.tanks[0].y = pos[i][1]; });
}
const P = (db, n) => db.players.find(p => p.username === n);
const T = (db, n, i = 0) => P(db, n).tanks[i];
const down = (db, n, i = 0) => { T(db, n, i).hearts = 0; T(db, n, i).isDead = true; P(db, n).isDead = P(db, n).tanks.every(t => t.isDead); };

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
  assert.equal(new Set(db.players.map(p => `${p.tanks[0].x},${p.tanks[0].y}`)).size, 3, 'unique spawn cells');
});

test('lobby: host leaves -> promoted; last leaves -> deleted', () => {
  const db = mkGame({}, ['alice', 'bob']);
  const r = L.leaveLobby(db, 'u-alice');
  assert.equal(r.newHost.userId, 'u-bob'); assert.equal(db.meta.hostUserId, 'u-bob');
  assert.equal(L.leaveLobby(db, 'u-bob').gameDeleted, true);
});

test('randomEmptyPos never loops on a full/nearly full board', () => {
  const db = mkGame({ gridWidth: 5, gridHeight: 5, maxPlayers: 60 }, []);
  for (let i = 0; i < 24; i++) db.players.push({ id: 'p' + i, isDead: false, tanks: [{ id: 'p' + i, x: i % 5, y: Math.floor(i / 5), isDead: false }] });
  assert.deepEqual(E.randomEmptyPos(db), { x: 4, y: 4 });
  db.players.push({ id: 'last', tanks: [{ id: 'last', x: 4, y: 4 }] });
  assert.throws(() => E.randomEmptyPos(db), /full/);
});

test('move: costs AP, bounds, occupied, diagonal, heart pickup', () => {
  const db = mkGame(); startAt(db, [[0, 0], [1, 0], [5, 5]]);
  const a = P(db, 'alice'), at = a.tanks[0];
  assert.match(E.movePlayer(db, 'u-alice', 'down').error, /Not enough AP/);
  a.ap = 5;
  assert.equal(E.movePlayer(db, 'u-alice', 'up').error, 'That would drive off the map');
  assert.equal(E.movePlayer(db, 'u-alice', 'right').error, 'Square is occupied');
  assert.equal(E.movePlayer(db, 'u-alice', 'nope').error, 'Invalid direction');
  db.heartPickups.push({ x: 1, y: 1, collected: false });
  const r = E.movePlayer(db, 'u-alice', 'downright');
  assert.ok(r.ok && r.heartPickedUp); assert.equal(at.hearts, 4); assert.equal(a.ap, 4); assert.deepEqual([at.x, at.y], [1, 1]);
});

test('shoot: range, friendly fire, kill transfers AP, last standing wins', () => {
  const db = mkGame({ endgamePlayerCount: 1 }); startAt(db, [[0, 0], [2, 0], [9, 9]]);
  const [a, b, c] = ['alice', 'bob', 'carol'].map(n => P(db, n));
  a.ap = 2; b.ap = 4; a.tanks[0].range = 2;
  assert.match(E.shootPlayer(db, 'u-alice', null, c.id).error, /Out of range/);
  b.tanks[0].hearts = 1;
  const r = E.shootPlayer(db, 'u-alice', null, b.id);
  assert.ok(r.ok && r.targetDead); assert.equal(a.ap, 1 + 4); assert.equal(b.ap, 0); assert.equal(a.kills, 1);
  assert.equal(db.meta.status, 'active'); // carol still alive, alice alive => 2 alive > 1
  c.tanks[0].x = 1; c.tanks[0].y = 0; c.tanks[0].hearts = 1; a.ap = 3;
  const r2 = E.shootPlayer(db, 'u-alice', null, c.id);
  assert.match(r2.message, /alice wins — game over/); assert.equal(db.meta.status, 'ended');
  assert.match(E.movePlayer(db, 'u-alice', 'down').error, /not currently active/);
});

test('win condition: killTarget and lastTeamStanding', () => {
  const k = mkGame({ winCondition: 'killTarget', killTargetCount: 1 }); startAt(k, [[0, 0], [1, 0], [3, 3]]);
  P(k, 'alice').ap = 1; T(k, 'bob').hearts = 1;
  assert.match(E.shootPlayer(k, 'u-alice', null, P(k, 'bob').id).message, /alice \(1 kills\) wins/);

  const t = mkGame({ teamsEnabled: true, teamCount: 2, winCondition: 'lastTeamStanding' }, ['alice', 'bob', 'carol', 'dan']);
  startAt(t, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  const ps = t.players; // balanced: alice t1, bob t2, carol t1, dan t2
  assert.deepEqual(ps.map(p => p.team), [1, 2, 1, 2]);
  assert.match(E.shootPlayer(t, 'u-alice', null, ps[2].id).error, /own team/);
  ps[0].ap = 5; ps[1].tanks[0].hearts = 1; ps[3].tanks[0].hearts = 1; ps[0].tanks[0].range = 5;
  E.shootPlayer(t, 'u-alice', null, ps[1].id);
  assert.equal(t.meta.status, 'active');
  const r = E.shootPlayer(t, 'u-alice', null, ps[3].id);
  assert.match(r.message, /Team 1 wins/);
});

test('fog of war hides out-of-range tanks and other players\' AP', () => {
  const db = mkGame({ fogOfWarEnabled: true }); startAt(db, [[0, 0], [1, 1], [9, 9]]);
  P(db, 'alice').ap = 7; P(db, 'bob').ap = 3;
  const s = E.getGameState(db, 'u-alice');
  const bob = s.players.find(p => p.callsign === 'bob'), carol = s.players.find(p => p.callsign === 'carol');
  assert.equal(bob.tanks[0].x, 1); assert.equal(carol.tanks[0].x, null); assert.equal(s.fogHidCount, 1);
  assert.equal(bob.ap, null); assert.equal(s.players.find(p => p.isOwn).ap, 7);
});

test('gifting: hearts revive the fallen, AP needs range, must keep 1 heart', () => {
  const db = mkGame(); startAt(db, [[0, 0], [1, 0], [9, 9]]);
  const [a, b, c] = ['alice', 'bob', 'carol'].map(n => P(db, n));
  down(db, 'bob'); a.tanks[0].hearts = 3;
  assert.match(E.sendGift(db, 'u-alice', null, b.id, 'ap', 1).error, /Can only send hearts/);
  assert.match(E.sendGift(db, 'u-alice', null, c.id, 'hearts', 1).error, /Out of range/);
  assert.match(E.sendGift(db, 'u-alice', null, b.id, 'hearts', 3).error, /keep at least 1/);
  assert.ok(E.sendGift(db, 'u-alice', null, b.id, 'hearts', 1).ok);
  assert.equal(b.isDead, false); assert.equal(b.tanks[0].hearts, 1); assert.equal(a.tanks[0].hearts, 2);
});

test('grantDailyAP: haunting skips the voted tank', () => {
  const db = mkGame({ apSchedule: 'always' }); startAt(db, [[0, 0], [1, 0], [2, 0]]);
  const [a, b, c] = ['alice', 'bob', 'carol'].map(n => P(db, n));
  down(db, 'bob');
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

// ---------- multi-tank ----------
function mkMulti(cfg = {}, users = ['alice', 'bob']) {
  const db = mkGame({ tanksPerPlayer: 2, ...cfg }, users);
  assert.ok(L.startGame(db, 'u-alice').ok);
  return db;
}
function place(db, spec) { // { alice: [[x,y],[x,y]], ... }
  for (const [n, cells] of Object.entries(spec)) cells.forEach((c, i) => { T(db, n, i).x = c[0]; T(db, n, i).y = c[1]; });
}

test('config: tanksPerPlayer clamps 1..3, defaults to 1; start places every tank on a unique cell', () => {
  assert.equal(sanitizeConfig({}).tanksPerPlayer, 1);
  assert.equal(sanitizeConfig({ tanksPerPlayer: 9 }).tanksPerPlayer, 3);
  const db = mkMulti({ tanksPerPlayer: 3 }, ['alice', 'bob', 'carol']);
  const cells = db.players.flatMap(p => p.tanks.map(t => `${t.x},${t.y}`));
  assert.equal(cells.length, 9); assert.equal(new Set(cells).size, 9);
  assert.equal(P(db, 'alice').tanks[0].id, P(db, 'alice').id); // first tank id == player id
  const tiny = mkGame({ gridWidth: 5, gridHeight: 5, tanksPerPlayer: 3, maxPlayers: 60 }, Array.from({ length: 9 }, (_, i) => 'p' + i));
  assert.match(L.startGame(tiny, 'u-alice').error || '', /too small/);
});

test('multi: moving needs a selected tank; shared AP pool; wrecks block squares', () => {
  const db = mkMulti(); place(db, { alice: [[0, 0], [4, 4]], bob: [[8, 8], [9, 9]] });
  const a = P(db, 'alice'); a.ap = 3;
  assert.equal(E.movePlayer(db, 'u-alice', 'down').error, 'Select a tank first');
  assert.equal(E.movePlayer(db, 'u-alice', 'down', T(db, 'bob').id).error, 'That is not one of your tanks');
  assert.ok(E.movePlayer(db, 'u-alice', 'down', a.tanks[1].id).ok);
  assert.deepEqual([a.tanks[1].x, a.tanks[1].y], [4, 5]); assert.deepEqual([a.tanks[0].x, a.tanks[0].y], [0, 0]);
  assert.ok(E.movePlayer(db, 'u-alice', 'right', a.tanks[0].id).ok); assert.equal(a.ap, 1);
  // a wreck stays put and blocks the tile
  down(db, 'bob', 0);
  T(db, 'alice', 0).x = 7; T(db, 'alice', 0).y = 8;
  assert.equal(E.movePlayer(db, 'u-alice', 'right', a.tanks[0].id).error, 'Square is occupied');
  assert.equal(E.movePlayer(db, 'u-bob', 'down', T(db, 'bob', 0).id).error, 'Fallen tanks cannot move');
  // with just one tank alive the choice is obvious
  down(db, 'alice', 0);
  assert.equal(E.movePlayer(db, 'u-alice', 'up', undefined).ok, true);
});

test('multi: shooting uses the chosen tank; killing one tank is not an elimination', () => {
  const db = mkMulti({ endgamePlayerCount: 1 }); place(db, { alice: [[0, 0], [9, 9]], bob: [[1, 0], [5, 5]] });
  const [a, b] = [P(db, 'alice'), P(db, 'bob')];
  a.ap = 5; b.ap = 4; a.tanks.forEach(t => { t.range = 2; });
  assert.match(E.shootPlayer(db, 'u-alice', a.tanks[1].id, b.tanks[0].id).error, /Out of range/);
  b.tanks[0].hearts = 1;
  const r = E.shootPlayer(db, 'u-alice', a.tanks[0].id, b.tanks[0].id);
  assert.ok(r.ok && r.targetDead); assert.match(r.message, /One of bob's tanks was destroyed/);
  assert.equal(b.isDead, false); assert.equal(b.ap, 4, 'no AP transfer until the player is out'); assert.equal(a.kills, 1);
  assert.equal(db.meta.status, 'active');
  assert.equal(E.shootPlayer(db, 'u-alice', a.tanks[0].id, b.tanks[0].id).error, 'Target is already down');
  // bring bob's last tank into range and finish him: elimination, AP transferred, game over
  b.tanks[1].x = 1; b.tanks[1].y = 1; b.tanks[1].hearts = 1;
  const r2 = E.shootPlayer(db, 'u-alice', a.tanks[0].id, b.tanks[1].id);
  assert.equal(b.isDead, true); assert.equal(a.ap, 5 - 2 + 4); assert.equal(a.kills, 2);
  assert.match(r2.message, /alice wins — game over/);
});

test('multi: last PLAYER with a living tank wins; kills from any tank count toward kill target', () => {
  const k = mkMulti({ winCondition: 'killTarget', killTargetCount: 2 }); place(k, { alice: [[0, 0], [0, 5]], bob: [[1, 0], [1, 5]] });
  const [a, b] = [P(k, 'alice'), P(k, 'bob')]; a.ap = 9; b.tanks.forEach(t => { t.hearts = 1; });
  E.shootPlayer(k, 'u-alice', a.tanks[0].id, b.tanks[0].id);
  assert.equal(k.meta.status, 'active');
  const r = E.shootPlayer(k, 'u-alice', a.tanks[1].id, b.tanks[1].id);
  assert.match(r.message, /alice \(2 kills\) wins/);
});

test('multi: range upgrade is paid once and raises every tank; hearts and repair are per tank', () => {
  const db = mkMulti(); place(db, { alice: [[0, 0], [5, 5]], bob: [[9, 9], [8, 9]] });
  const a = P(db, 'alice'); a.ap = 3 + 3 + 3;
  assert.ok(E.upgradeRange(db, 'u-alice').ok);
  assert.deepEqual(a.tanks.map(t => t.range), [3, 3]); assert.equal(a.ap, 6);
  assert.equal(E.addHeart(db, 'u-alice').error, 'Select a tank first');
  assert.ok(E.addHeart(db, 'u-alice', a.tanks[1].id).ok);
  assert.deepEqual(a.tanks.map(t => t.hearts), [3, 4]); assert.equal(a.ap, 3);
  down(db, 'alice', 1);
  assert.equal(E.addHeart(db, 'u-alice', a.tanks[1].id).error, 'Fallen tanks cannot repair');
});

test('multi: gifting hearts between own tanks costs AP, can spend the last heart; a gifted heart revives a wreck', () => {
  const db = mkMulti({ tankGiftCost: 1 }); place(db, { alice: [[0, 0], [1, 0]], bob: [[9, 9], [8, 8]] });
  const a = P(db, 'alice'); a.ap = 2; a.tanks[0].hearts = 1;
  assert.equal(E.sendGift(db, 'u-alice', a.tanks[0].id, a.tanks[0].id, 'hearts', 1).error, 'Pick a different tank');
  assert.match(E.sendGift(db, 'u-alice', a.tanks[0].id, a.tanks[1].id, 'ap', 1).error, /share one AP pool/);
  a.tanks[1].x = 8; assert.match(E.sendGift(db, 'u-alice', a.tanks[0].id, a.tanks[1].id, 'hearts', 1).error, /Out of range/); a.tanks[1].x = 1;
  const r = E.sendGift(db, 'u-alice', a.tanks[0].id, a.tanks[1].id, 'hearts', 1);
  assert.ok(r.ok); assert.equal(a.ap, 1);
  assert.equal(a.tanks[0].hearts, 0); assert.equal(a.tanks[0].isDead, true, 'gave away its last heart → wreck');
  assert.equal(a.tanks[1].hearts, 4); assert.equal(a.isDead, false);
  assert.equal(E.sendGift(db, 'u-alice', a.tanks[0].id, a.tanks[1].id, 'hearts', 1).error, 'Fallen tanks cannot send gifts');
  // revive the wreck from the other tank; AP pool is not wiped
  a.ap = 5;
  assert.ok(E.sendGift(db, 'u-alice', a.tanks[1].id, a.tanks[0].id, 'hearts', 1).ok);
  assert.equal(a.tanks[0].isDead, false); assert.equal(a.tanks[0].hearts, 1); assert.equal(a.ap, 4);
  assert.ok(db.gameLog.some(l => l.type === 'revive'));
  // another player: still has to keep 1 heart, no AP cost
  P(db, 'bob').tanks[0].x = 1; P(db, 'bob').tanks[0].y = 1; a.tanks[1].hearts = 2;
  assert.match(E.sendGift(db, 'u-alice', a.tanks[1].id, P(db, 'bob').tanks[0].id, 'hearts', 2).error, /keep at least 1/);
  assert.ok(E.sendGift(db, 'u-alice', a.tanks[1].id, P(db, 'bob').tanks[0].id, 'hearts', 1).ok); assert.equal(a.ap, 4);
});

test('multi: a player is out (and can jury-vote) only when every tank is down; daily AP is once per player', () => {
  const db = mkMulti({ apSchedule: 'always' }, ['alice', 'bob', 'carol']); place(db, { alice: [[0, 0], [1, 0]], bob: [[2, 0], [3, 0]], carol: [[4, 0], [5, 0]] });
  down(db, 'bob', 0);
  assert.equal(P(db, 'bob').isDead, false);
  assert.equal(E.juryVote(db, 'u-bob', P(db, 'carol').id).error, 'Only fallen tanks can cast jury votes');
  E.grantDailyAP(db);
  assert.deepEqual(db.players.map(p => p.ap), [1, 1, 1]); // not 2 per player
  down(db, 'bob', 1);
  assert.equal(P(db, 'bob').isDead, true);
  assert.ok(E.juryVote(db, 'u-bob', P(db, 'carol').id).ok);
  E.grantDailyAP(db);
  assert.equal(P(db, 'bob').ap, 1); // dead players get nothing
});

test('multi: fog of war uses every living tank of the viewer; state exposes tanks', () => {
  const db = mkMulti({ fogOfWarEnabled: true }); place(db, { alice: [[0, 0], [9, 9]], bob: [[8, 8], [5, 5]] });
  const s = E.getGameState(db, 'u-alice');
  const bob = s.players.find(p => p.callsign === 'bob');
  assert.equal(bob.tanks[0].x, 8, 'visible from alice\'s second tank'); assert.equal(bob.tanks[1].x, null);
  assert.equal(s.fogHidCount, 1); assert.equal(s.config.tanksPerPlayer, 2);
  assert.equal(s.players.find(p => p.isOwn).tanks.length, 2);
});

test('multi: heart pickups work for any tank; legacy single-tank data is upgraded', () => {
  const db = mkMulti(); place(db, { alice: [[0, 0], [5, 5]], bob: [[9, 9], [8, 9]] });
  P(db, 'alice').ap = 2; db.heartPickups.push({ x: 5, y: 6, collected: false });
  const r = E.movePlayer(db, 'u-alice', 'down', T(db, 'alice', 1).id);
  assert.ok(r.heartPickedUp); assert.equal(T(db, 'alice', 1).hearts, 4);
  const legacy = { meta: db.meta, gameLog: [], heartPickups: [], juryVotes: [], players: [{ id: 'p1', userId: 'u1', callsign: 'x', ap: 2, x: 3, y: 4, hearts: 2, range: 3, isDead: false, kills: 1 }] };
  E.ensureTanks(legacy);
  assert.deepEqual(legacy.players[0].tanks, [{ id: 'p1', x: 3, y: 4, hearts: 2, range: 3, isDead: false, killedBy: null }]);
  assert.equal(legacy.players[0].hearts, undefined);
  E.ensureTanks(legacy); assert.equal(legacy.players[0].tanks.length, 1);
});

test('admin: set hearts per tank; downing the last one takes the player out', () => {
  const db = mkMulti(); const a = P(db, 'alice');
  assert.equal(A.setHearts(db, a.tanks[1].id, 0).isDead, true); assert.equal(a.isDead, false);
  A.setHearts(db, a.tanks[0].id, 0); assert.equal(a.isDead, true);
  assert.equal(A.getDetail(db, []).players[0].tanks.length, 2);
});
