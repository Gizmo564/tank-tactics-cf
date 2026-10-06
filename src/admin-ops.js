// Super-admin operations on one game's db. Authorisation happens in the
// Worker (admin cookie); these bypass per-game host checks by design.
const alog = (db, message) => {
  db.gameLog.push({ time: Date.now(), message: `[admin] ${message}`, type: 'system' });
  if (db.gameLog.length > 1000) db.gameLog = db.gameLog.slice(-1000);
};
const find = (db, id) => db.players.find(x => x.id === id);
const NOPLAYER = { ok: false, error: 'Player not found' };

export function grantAP(db, playerId, amount) {
  const p = find(db, playerId); if (!p) return NOPLAYER;
  p.ap = Math.max(0, p.ap + amount); alog(db, `granted ${amount} AP to ${p.callsign} (now ${p.ap})`);
  return { ok: true, ap: p.ap };
}
export function setAP(db, playerId, amount) {
  const p = find(db, playerId); if (!p) return NOPLAYER;
  p.ap = Math.max(0, amount); alog(db, `set ${p.callsign}'s AP to ${p.ap}`);
  return { ok: true, ap: p.ap };
}
export function setHearts(db, playerId, amount) {
  const p = find(db, playerId); if (!p) return NOPLAYER;
  p.hearts = Math.max(0, Math.min(db.meta.config.maxHearts || 999, amount));
  p.isDead = p.hearts <= 0;
  alog(db, `set ${p.callsign}'s hearts to ${p.hearts}${p.isDead ? ' (down)' : ''}`);
  return { ok: true, hearts: p.hearts, isDead: p.isDead };
}
function remove(db, playerId) {
  const i = db.players.findIndex(p => p.id === playerId);
  if (i === -1) return null;
  const [player] = db.players.splice(i, 1);
  db.juryVotes = (db.juryVotes || []).filter(v => v.voterId !== playerId && v.targetId !== playerId);
  return player;
}
export function kick(db, playerId) {
  const p = remove(db, playerId); if (!p) return NOPLAYER;
  alog(db, `removed ${p.callsign} from the game`); return { ok: true, name: p.callsign };
}
export function ban(db, playerId) {
  const p = remove(db, playerId); if (!p) return NOPLAYER;
  db.meta.bannedUserIds = db.meta.bannedUserIds || [];
  if (!db.meta.bannedUserIds.includes(p.userId)) db.meta.bannedUserIds.push(p.userId);
  alog(db, `banned ${p.callsign} from the game`); return { ok: true, name: p.callsign };
}
export function unban(db, userId) {
  db.meta.bannedUserIds = (db.meta.bannedUserIds || []).filter(id => id !== userId);
  alog(db, 'lifted a ban'); return { ok: true };
}
export function endGame(db) {
  db.meta.status = 'ended'; db.meta.endedAt = Date.now(); alog(db, 'ended the game'); return { ok: true };
}
export function getDetail(db, chat) {
  return {
    id: db.meta.id, name: db.meta.name, code: db.meta.code, status: db.meta.status, visibility: db.meta.visibility || 'public',
    hostUserId: db.meta.hostUserId, config: db.meta.config, createdAt: db.meta.createdAt, startedAt: db.meta.startedAt,
    bannedUserIds: db.meta.bannedUserIds || [],
    players: db.players.map(p => ({ id: p.id, userId: p.userId, username: p.username, callsign: p.callsign, colorHex: p.colorHex,
      x: p.x, y: p.y, hearts: p.hearts, ap: p.ap, range: p.range, isDead: p.isDead })),
    heartPickups: db.heartPickups,
    groups: (db.groups || []).map(g => ({ id: g.id, name: g.name,
      members: g.memberIds.map(id => find(db, id)).filter(Boolean).map(p => p.callsign) })),
    chat, log: db.gameLog.slice().reverse()
  };
}
