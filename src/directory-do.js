// DirectoryDO: the single global object holding accounts and the game index.
// All methods are called via Durable Object RPC from the Worker.
import { DurableObject } from 'cloudflare:workers';
import { hashPassword, verifyPassword, validateRegistration } from './auth.js';
import { RateLimiter } from './ratelimit.js';

const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export class DirectoryDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.rl = new RateLimiter();
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, lname TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, lcode TEXT, created_at INTEGER, data TEXT NOT NULL)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS games_lcode ON games(lcode)');
  }

  rate(key, max, windowMs) { return this.rl.allow(key, max, windowMs); }

  async register(username, password) {
    const bad = validateRegistration(username, password);
    if (bad) return { ok: false, error: bad };
    const lname = username.toLowerCase();
    if (this.sql.exec('SELECT 1 FROM users WHERE lname=?', lname).toArray().length) return { ok: false, error: 'That callsign is already taken' };
    const hash = await hashPassword(password);
    const id = crypto.randomUUID();
    try {
      this.sql.exec('INSERT INTO users (id, username, lname, hash, created_at) VALUES (?,?,?,?,?)', id, username, lname, hash, Date.now());
    } catch { return { ok: false, error: 'That callsign is already taken' }; } // lost a race on the UNIQUE index
    return { ok: true, user: { id, username } };
  }

  async login(username, password) {
    const lname = String(username).toLowerCase();
    if (!this.rate('login:' + lname, 10, 5 * 60 * 1000)) return { ok: false, error: 'Too many attempts — wait a few minutes and try again' };
    const row = this.sql.exec('SELECT id, username, hash FROM users WHERE lname=?', lname).toArray()[0];
    // Always run a hash comparison so timing doesn't reveal whether the name exists.
    const ok = await verifyPassword(password, row ? row.hash : DUMMY_HASH) && !!row;
    return ok ? { ok: true, user: { id: row.id, username: row.username } } : { ok: false, error: 'Invalid callsign or password' };
  }

  getUser(id) { return this.sql.exec('SELECT id, username FROM users WHERE id=?', id).toArray()[0] || null; }

  upsertGame(s) {
    this.sql.exec(`INSERT INTO games (id, lcode, created_at, data) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET lcode=excluded.lcode, data=excluded.data`, s.id, (s.code || '').toLowerCase(), s.createdAt, JSON.stringify(s));
    return true;
  }
  deleteGame(id) { this.sql.exec('DELETE FROM games WHERE id=?', id); return true; }

  findByCode(code) {
    if (!code) return null;
    const r = this.sql.exec('SELECT data FROM games WHERE lcode=?', String(code).trim().toLowerCase()).toArray()[0];
    return r ? JSON.parse(r.data) : null;
  }

  // Players see public games plus unlisted ones they host/play in; admin sees all.
  listGames(userId, includeUnlisted = false) {
    return this.sql.exec('SELECT data FROM games ORDER BY created_at DESC').toArray().map(r => {
      const g = JSON.parse(r.data);
      const isMember = !!userId && (g.hostUserId === userId || (g.memberIds || []).includes(userId));
      return { id: g.id, name: g.name, code: g.code, status: g.status, hostUsername: g.hostUsername, maxPlayers: g.maxPlayers,
        playerCount: g.playerCount, aliveCount: g.aliveCount, createdAt: g.createdAt, startedAt: g.startedAt || null,
        visibility: g.visibility || 'public', isMember, nextAPGrant: g.status === 'active' ? (g.nextAPGrant || null) : null };
    }).filter(g => includeUnlisted || g.visibility !== 'unlisted' || g.isMember);
  }

  gameIds() { return this.sql.exec('SELECT id FROM games').toArray().map(r => r.id); }
  stats() {
    const c = t => this.sql.exec(`SELECT COUNT(*) c FROM ${t}`).one().c;
    return { users: c('users'), games: c('games') };
  }
  exportAll() {
    return { users: this.sql.exec('SELECT * FROM users').toArray(), games: this.sql.exec('SELECT * FROM games').toArray() };
  }
}
