// GameDO: one Durable Object per game. Owns the authoritative game state
// (single JSON row), chat (own table), the AP/heart alarm, and the live
// WebSocket fan-out. Handlers are synchronous against SQLite, and a Durable
// Object processes one event at a time, so actions can't interleave.
import { DurableObject } from 'cloudflare:workers';
import * as E from './engine.js';
import * as L from './lobby.js';
import * as A from './admin-ops.js';
import { ensureSchedule, runDue, nextWake } from './schedule.js';
import { RateLimiter } from './ratelimit.js';

const MAX_CHAT = 500;
const notFound = { ok: false, error: 'Game not found' };
const denied = { ok: false, error: 'Admin only' };

export class GameDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.rl = new RateLimiter();
    this.db = undefined;          // in-memory cache of the game row
    this.lastSummary = null;
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chat (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, json TEXT NOT NULL)');
    // Answered at the edge of the object without waking it: keeps idle sockets alive for free.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---------- state ----------
  load() {
    if (this.db === undefined) {
      const r = this.sql.exec("SELECT v FROM kv WHERE k='db'").toArray()[0];
      this.db = r ? E.ensureTanks(JSON.parse(r.v)) : null;
    }
    return this.db;
  }
  save(db) {
    this.db = db;
    this.sql.exec("INSERT INTO kv (k,v) VALUES ('db',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", JSON.stringify(db));
  }
  summary(db) {
    const m = db.meta;
    return { id: m.id, code: m.code, name: m.name, hostUserId: m.hostUserId, hostUsername: m.hostUsername, status: m.status,
      visibility: m.visibility, maxPlayers: m.config.maxPlayers, playerCount: db.players.length,
      aliveCount: db.players.filter(p => !p.isDead).length, memberIds: db.players.map(p => p.userId),
      createdAt: m.createdAt, startedAt: m.startedAt, nextAPGrant: m.nextAPGrant || null };
  }
  async syncDirectory(db) {
    const s = JSON.stringify(this.summary(db));
    if (s === this.lastSummary) return;
    await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('main')).upsertGame(JSON.parse(s));
    this.lastSummary = s;
  }
  async syncAlarm(db) {
    const want = nextWake(db);
    const cur = await this.ctx.storage.getAlarm();
    if (want && cur !== want) await this.ctx.storage.setAlarm(want);
    else if (!want && cur) await this.ctx.storage.deleteAlarm();
  }
  // Persist, re-arm timers, tell directory + sockets. Call after any successful mutation.
  async commit(db, fx = null) {
    ensureSchedule(db);
    this.save(db);
    await this.syncAlarm(db);
    this.broadcast(db, fx);
    await this.syncDirectory(db);
  }

  lobbyView(db, userId) {
    return { ok: true, id: db.meta.id, name: db.meta.name, code: db.meta.code, status: db.meta.status,
      isHost: db.meta.hostUserId === userId, maxPlayers: db.meta.config.maxPlayers,
      teamsEnabled: !!db.meta.config.teamsEnabled, teamCount: db.meta.config.teamCount || 2,
      players: db.players.map(p => ({ id: p.id, callsign: p.callsign, colorHex: p.colorHex, userId: p.userId, team: p.team || null })),
      recentLog: db.gameLog.slice(-20) };
  }

  // ---------- realtime ----------
  broadcast(db, fx = null) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      try {
        ws.send(JSON.stringify({ type: 'state', state: E.getGameState(db, att.userId), lobby: this.lobbyView(db, att.userId), v: db.meta.v || 0 }));
        if (fx) ws.send(JSON.stringify({ type: 'fx', fx }));
      } catch { /* socket closing */ }
    }
  }
  broadcastChat(db, message) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (E.canSeeChat(db, att.userId, message)) { try { ws.send(JSON.stringify({ type: 'chat', message })); } catch { /* closing */ } }
    }
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    const db = this.load();
    if (!db) return new Response('Game not found', { status: 404 });
    const user = JSON.parse(req.headers.get('x-tt-user') || '{}'); // set by the Worker only
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ userId: user.userId || null, admin: !!user.admin });
    pair[1].send(JSON.stringify({ type: 'state', state: E.getGameState(db, user.userId), lobby: this.lobbyView(db, user.userId), v: db.meta.v || 0 }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage() { /* clients speak HTTP; sockets are push-only. Pings are auto-answered. */ }
  webSocketClose(ws, code) { try { ws.close(code === 1005 || code === 1006 || !code ? 1000 : code, 'bye'); } catch { /* already closed */ } }
  webSocketError(ws) { try { ws.close(1011, 'error'); } catch { /* already closed */ } }

  async alarm() {
    const db = this.load();
    if (!db) return;
    const { changed } = runDue(db);
    if (changed) await this.commit(db); else await this.syncAlarm(db);
  }

  // ---------- RPC entry point ----------
  // user: { userId, username, admin } supplied by the Worker after verifying the session cookie.
  async call(op, user, a = {}) {
    if (op === 'create') return this.create(a);
    const db = this.load();
    if (!db) return notFound;
    const uid = user.userId;

    if (op.startsWith('admin.')) return user.admin ? this.adminOp(op, db, a) : denied;
    // The admin account observes and moderates; it never plays.
    if (user.admin && !['lobby', 'state', 'chat.list'].includes(op)) return { ok: false, error: 'The admin account cannot play — use a player account.' };

    switch (op) {
      case 'lobby': return this.lobbyView(db, uid);
      case 'state': return { ok: true, state: E.getGameState(db, uid) };
      case 'join': return this.mutate(db, () => L.joinLobby(db, uid, user.username, a.callsign, a.colorId, a.team));
      case 'start': return this.mutate(db, () => L.startGame(db, uid));
      case 'end': return this.mutate(db, () => L.endGame(db, uid));
      case 'leave': return this.leave(db, uid);

      case 'move': return this.act(db, uid, () => E.movePlayer(db, uid, a.direction, a.tankId));
      case 'shoot': return this.act(db, uid, () => E.shootPlayer(db, uid, a.tankId, a.targetId));
      case 'heal': return this.act(db, uid, () => E.addHeart(db, uid, a.tankId));
      case 'upgrade': return this.act(db, uid, () => E.upgradeRange(db, uid));
      case 'gift': return this.act(db, uid, () => E.sendGift(db, uid, a.tankId, a.targetId, a.type, a.amount));
      case 'vote': return this.act(db, uid, () => E.juryVote(db, uid, a.targetId));

      case 'groups.list': return E.myGroups(db, uid);
      case 'groups.create': return this.mutate(db, () => E.createGroup(db, uid, a.name, a.memberIds));
      case 'groups.leave': return this.mutate(db, () => E.leaveGroup(db, uid, a.groupId));

      case 'host.grantAp': return this.mutate(db, () => E.hostGrantAP(db, uid, a.playerId, a.amount));
      case 'host.spawnHeart': return this.mutate(db, () => E.hostSpawnHeart(db, uid));
      case 'host.kick': return this.mutate(db, () => E.hostKick(db, uid, a.playerId));
      case 'host.grantApAll': return this.mutate(db, () => E.hostGrantAllAP(db, uid));

      case 'chat.send': return this.chatSend(db, uid, a);
      case 'chat.list': return this.chatList(db, uid, a.since);
      default: return { ok: false, error: 'Unknown operation' };
    }
  }

  // Runs a rules function; on success persists + broadcasts. Failed calls change nothing.
  async mutate(db, fn) {
    const r = fn();
    if (r && r.ok) { db.meta.v = (db.meta.v || 0) + 1; await this.commit(db, r.fx || null); }
    return r;
  }
  async act(db, uid, fn) {
    if (!this.rl.allow('a:' + uid, 20, 10_000)) return { ok: false, error: 'Slow down — too many actions at once' };
    return this.mutate(db, fn);
  }

  async create({ id, code, name, host, callsign, colorId, team, config, visibility }) {
    if (this.load()) return { ok: false, error: 'Game already exists' };
    const db = L.createGameDb({ id, code, name, hostUserId: host.userId, hostUsername: host.username, configOverrides: config, visibility });
    const j = L.joinLobby(db, host.userId, host.username, callsign, colorId, team);
    if (!j.ok) return j;
    await this.commit(db);
    return { ok: true, gameId: id, code };
  }

  async leave(db, uid) {
    const r = L.leaveLobby(db, uid);
    if (!r.ok) return r;
    if (r.gameDeleted) {
      await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('main')).deleteGame(db.meta.id);
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'game deleted'); } catch { /* closed */ } }
      this.db = null; this.lastSummary = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return { ok: true, gameDeleted: true };
    }
    db.meta.v = (db.meta.v || 0) + 1;
    await this.commit(db);
    return r;
  }

  // ---------- chat ----------
  async chatSend(db, uid, a) {
    if (!this.rl.allow('c:' + uid, 8, 10_000)) return { ok: false, error: 'Slow down — too many messages' };
    const r = E.buildChatMessage(db, uid, a || {});
    if (!r.ok) return r;
    this.sql.exec('INSERT INTO chat (ts, json) VALUES (?,?)', r.message.timestamp, JSON.stringify(r.message));
    const n = this.sql.exec('SELECT COUNT(*) c FROM chat').one().c;
    if (n > MAX_CHAT + 50) this.sql.exec('DELETE FROM chat WHERE seq <= (SELECT MAX(seq) FROM chat) - ?', MAX_CHAT);
    this.broadcastChat(db, r.message);
    return { ok: true };
  }
  chatRows() { return this.sql.exec('SELECT json FROM chat ORDER BY seq').toArray().map(r => JSON.parse(r.json)); }
  chatList(db, uid, since) {
    const s = parseInt(since) || 0;
    return { ok: true, messages: this.chatRows().filter(m => m.timestamp > s && E.canSeeChat(db, uid, m)) };
  }

  // ---------- admin ----------
  async adminOp(op, db, a) {
    switch (op) {
      case 'admin.detail': return { ok: true, game: A.getDetail(db, this.chatRows()) };
      case 'admin.grantAp': return this.mutate(db, () => A.grantAP(db, a.playerId, a.amount));
      case 'admin.setAp': return this.mutate(db, () => A.setAP(db, a.playerId, a.amount));
      case 'admin.setHearts': return this.mutate(db, () => A.setHearts(db, a.playerId, a.amount));
      case 'admin.kick': return this.mutate(db, () => A.kick(db, a.playerId));
      case 'admin.ban': return this.mutate(db, () => A.ban(db, a.playerId));
      case 'admin.unban': return this.mutate(db, () => A.unban(db, a.userId));
      case 'admin.end': return this.mutate(db, () => A.endGame(db));
      case 'admin.export': return { ok: true, db, chat: this.chatRows() };
      default: return { ok: false, error: 'Unknown operation' };
    }
  }
}
