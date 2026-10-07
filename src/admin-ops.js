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
// `tankId` picks one tank; the first tank's id is the player's id, so the old
// per-player call still works for single-tank games.
export function setHearts(db, tankId, amount) {
  let p = null, t = null;
  for (const q of db.players) { const m = q.tanks.find(x => x.id === tankId); if (m) { p = q; t = m; } }
  if (!t) return NOPLAYER;
  t.hearts = Math.max(0, Math.min(db.meta.config.maxHearts || 999, amount));
  t.isDead = t.hearts <= 0;
  p.isDead = p.tanks.every(x => x.isDead);
  alog(db, `set ${p.callsign}'s tank to ${t.hearts} hearts${t.isDead ? ' (down)' : ''}`);
  return { ok: true, hearts: t.hearts, isDead: t.isDead };
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
      ap: p.ap, isDead: p.isDead, tanks: p.tanks.map(t => ({ id: t.id, x: t.x, y: t.y, hearts: t.hearts, range: t.range, isDead: t.isDead })) })),
    heartPickups: db.heartPickups,
    groups: (db.groups || []).map(g => ({ id: g.id, name: g.name,
      members: g.memberIds.map(id => find(db, id)).filter(Boolean).map(p => p.callsign) })),
    chat, log: db.gameLog.slice().reverse()
  };
}
