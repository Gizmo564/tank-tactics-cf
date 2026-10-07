// Lobby lifecycle for one game: create, join, leave, start, end. Pure over `db`.
import { COLORS, sanitizeConfig } from './config.js';
import { randomEmptyPos, makeTanks } from './engine.js';

const uuid = () => crypto.randomUUID();
const sysLog = (db, message, actorId) => db.gameLog.push({ time: Date.now(), message, type: 'system', actorId });

export function makeCode(rand = Math.random) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous characters
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(rand() * chars.length)];
  return code;
}

export function createGameDb({ id, code, name, hostUserId, hostUsername, configOverrides, visibility }) {
  const config = sanitizeConfig(configOverrides || {});
  const vis = visibility === 'unlisted' ? 'unlisted' : 'public';
  const finalName = (name || `${hostUsername}'s Game`).slice(0, 40);
  return {
    meta: { id, name: finalName, code, hostUserId, hostUsername, status: 'lobby', gameStarted: false, visibility: vis, config,
      createdAt: Date.now(), startedAt: null, endedAt: null, lastAPGrant: null, lastHeartSpawn: null,
      nextAPGrant: null, nextHeartSpawn: null, bannedUserIds: [] },
    players: [], heartPickups: [], juryVotes: [], groups: [],
    gameLog: [{ time: Date.now(), message: `${hostUsername} created the game.`, type: 'system' }]
  };
}

function pickBalancedTeam(db, teamCount) {
  const counts = new Array(teamCount).fill(0);
  db.players.forEach(p => { if (p.team >= 1 && p.team <= teamCount) counts[p.team - 1]++; });
  let best = 1, bestCount = counts[0];
  for (let i = 1; i < teamCount; i++) if (counts[i] < bestCount) { best = i + 1; bestCount = counts[i]; }
  return best;
}

export function joinLobby(db, userId, username, callsign, colorId, team) {
  if ((db.meta.bannedUserIds || []).includes(userId)) return { ok: false, error: 'You have been banned from this game' };
  if (db.meta.status !== 'lobby') return { ok: false, error: 'This game has already started' };
  const cfg = db.meta.config;
  const existing = db.players.find(p => p.userId === userId);
  if (!existing && db.players.length >= cfg.maxPlayers) return { ok: false, error: `Game is full (max ${cfg.maxPlayers} tanks)` };

  const cleanCallsign = (callsign || username).trim().slice(0, 18) || username;
  if (db.players.some(p => p.userId !== userId && p.callsign.toLowerCase() === cleanCallsign.toLowerCase())) {
    return { ok: false, error: 'Someone in this game already has that callsign' };
  }
  const color = COLORS.find(c => c.id === colorId) || COLORS[db.players.length % COLORS.length];
  let assignedTeam = null;
  if (cfg.teamsEnabled) {
    const teamCount = cfg.teamCount || 2;
    const requested = parseInt(team);
    assignedTeam = (requested >= 1 && requested <= teamCount) ? requested : pickBalancedTeam(db, teamCount);
  }
  if (existing) {
    existing.callsign = cleanCallsign; existing.colorId = color.id; existing.colorHex = color.hex;
    if (cfg.teamsEnabled) existing.team = assignedTeam;
  } else {
    const p = { id: uuid(), userId, username, callsign: cleanCallsign, colorId: color.id, colorHex: color.hex, team: assignedTeam,
      ready: true, ap: cfg.startingAP, kills: 0, isDead: false, joinedAt: Date.now() };
    p.tanks = makeTanks(p, cfg);
    db.players.push(p);
    sysLog(db, `${cleanCallsign} joined the lobby${cfg.teamsEnabled ? ` (Team ${assignedTeam})` : ''}.`, p.id);
  }
  return { ok: true };
}

// Returns { ok, gameDeleted?, newHost? } — the caller updates the directory.
export function leaveLobby(db, userId) {
  if (db.meta.status !== 'lobby') return { ok: false, error: 'Cannot leave — game already started' };
  const i = db.players.findIndex(p => p.userId === userId);
  if (i === -1) return { ok: false, error: 'You are not in this game' };
  const { callsign, id } = db.players[i];
  db.players.splice(i, 1);
  sysLog(db, `${callsign} left the lobby.`, id);
  if (db.meta.hostUserId === userId) {
    if (db.players.length === 0) return { ok: true, gameDeleted: true };
    const nh = db.players[0];
    db.meta.hostUserId = nh.userId; db.meta.hostUsername = nh.username;
    sysLog(db, `${nh.callsign} is now the host.`, nh.id);
    return { ok: true, newHost: { userId: nh.userId, username: nh.username } };
  }
  return { ok: true };
}

export function startGame(db, userId) {
  if (db.meta.hostUserId !== userId) return { ok: false, error: 'Only the host can start the game' };
  if (db.meta.status !== 'lobby') return { ok: false, error: 'Game already started' };
  if (db.players.length < 2) return { ok: false, error: 'Need at least 2 tanks to start' };
  const cfg = db.meta.config;
  const need = db.players.length * (cfg.tanksPerPlayer || 1);
  if (need > cfg.gridWidth * cfg.gridHeight) return { ok: false, error: `The board is too small for ${need} tanks` };
  db.players.forEach(p => { p.tanks = makeTanks(p, cfg); });
  db.players.forEach(p => p.tanks.forEach(t => { const pos = randomEmptyPos(db); t.x = pos.x; t.y = pos.y; }));
  db.meta.status = 'active'; db.meta.gameStarted = true; db.meta.startedAt = Date.now();
  sysLog(db, 'The game has begun! Good luck, tankers.');
  return { ok: true };
}

export function endGame(db, userId) {
  if (db.meta.hostUserId !== userId) return { ok: false, error: 'Only the host can end the game' };
  if (db.meta.status === 'ended') return { ok: false, error: 'Game already ended' };
  db.meta.status = 'ended'; db.meta.endedAt = Date.now();
  sysLog(db, 'The host ended the game.');
  return { ok: true };
}
