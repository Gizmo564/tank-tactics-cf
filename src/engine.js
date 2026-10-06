// Turn-based game rules. Pure functions over a single game's `db` object
// ({ meta, players, heartPickups, juryVotes, gameLog, groups }): each action
// validates first, mutates `db` only on success, and returns a result object.
// No storage, no clock injection beyond Date.now(), so it is trivially testable.
// Persistence and broadcasting are the Durable Object's job.

const uuid = () => crypto.randomUUID();

// actorId (optional) is the player responsible for an event — the frontend
// uses it to color-code the activity feed. Omit for host/system events.
export function log(db, message, type = 'info', actorId = null) {
  db.gameLog.push({ time: Date.now(), message, type, actorId });
  if (db.gameLog.length > 400) db.gameLog = db.gameLog.slice(-400);
}

export function getDistance(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
const byUser = (db, userId) => db.players.find(p => p.userId === userId);
const byId = (db, id) => db.players.find(p => p.id === id);
const requireActive = db => (db.meta.status !== 'active' ? 'The game is not currently active' : null);
const fail = error => ({ ok: false, error });

export function randomEmptyPos(db, rand = Math.random) {
  const cfg = db.meta.config;
  const occupied = new Set(db.players.filter(p => p.x !== null).map(p => `${p.x},${p.y}`));
  const total = cfg.gridWidth * cfg.gridHeight;
  if (occupied.size >= total) throw new Error('Grid is full');
  // Enumerate free cells so a nearly-full board can never loop forever.
  const free = [];
  for (let y = 0; y < cfg.gridHeight; y++) for (let x = 0; x < cfg.gridWidth; x++) if (!occupied.has(`${x},${y}`)) free.push({ x, y });
  return free[Math.floor(rand() * free.length)];
}

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], upleft: [-1, -1], upright: [1, -1], downleft: [-1, 1], downright: [1, 1] };

export function movePlayer(db, userId, direction) {
  const err = requireActive(db); if (err) return fail(err);
  const cfg = db.meta.config;
  const player = byUser(db, userId);
  if (!player) return fail('You are not in this game');
  if (player.isDead) return fail('Fallen tanks cannot move');
  if (player.ap < cfg.moveCost) return fail(`Not enough AP (need ${cfg.moveCost})`);
  const delta = DIRS[direction];
  if (!delta) return fail('Invalid direction');
  const nx = player.x + delta[0], ny = player.y + delta[1];
  if (nx < 0 || nx >= cfg.gridWidth || ny < 0 || ny >= cfg.gridHeight) return fail('That would drive off the map');
  if (db.players.find(p => p.id !== player.id && p.x === nx && p.y === ny)) return fail('Square is occupied');

  player.x = nx; player.y = ny;
  player.ap -= cfg.moveCost;
  let heartPickedUp = false;
  const heart = db.heartPickups.find(h => !h.collected && h.x === nx && h.y === ny);
  if (heart) {
    heart.collected = true;
    player.hearts = Math.min(player.hearts + 1, cfg.maxHearts || 999);
    heartPickedUp = true;
    log(db, `${player.callsign} picked up a heart! Now at ${player.hearts} hearts`, 'heart', player.id);
  }
  log(db, `${player.callsign} moved ${direction}`, 'move', player.id);
  return { ok: true, heartPickedUp, fx: { type: 'move', id: player.id, x: nx, y: ny } };
}

export function shootPlayer(db, userId, targetId) {
  const err = requireActive(db); if (err) return fail(err);
  const cfg = db.meta.config;
  const attacker = byUser(db, userId), target = byId(db, targetId);
  if (!attacker) return fail('You are not in this game');
  if (!target) return fail('Target not found');
  if (attacker.isDead) return fail('Fallen tanks cannot shoot');
  if (target.isDead) return fail('Target is already down');
  if (!cfg.friendlyFire && attacker.id === target.id) return fail('Cannot shoot yourself');
  if (cfg.teamsEnabled && !cfg.teamFriendlyFireEnabled && attacker.team && attacker.team === target.team) {
    return fail(`Cannot shoot your own team (Team ${attacker.team})`);
  }
  if (attacker.ap < cfg.shootCost) return fail(`Not enough AP (need ${cfg.shootCost})`);
  const dist = getDistance(attacker, target);
  if (dist > attacker.range) return fail(`Out of range (your range: ${attacker.range}, distance: ${dist})`);

  attacker.ap -= cfg.shootCost;
  const damage = cfg.shootDamage || 1;
  target.hearts -= damage;
  let killMsg = '', winMessage = null;
  if (target.hearts <= 0) {
    target.isDead = true; target.killedBy = attacker.id;
    attacker.kills = (attacker.kills || 0) + 1;
    if (cfg.transferAPOnKill !== false) {
      const ap = target.ap; attacker.ap += ap; target.ap = 0;
      killMsg = ` ${target.callsign} is out! ${attacker.callsign} gains ${ap} AP.`;
      log(db, `${attacker.callsign} eliminated ${target.callsign}!${ap > 0 ? ` +${ap} AP` : ''}`, 'kill', attacker.id);
    } else {
      killMsg = ` ${target.callsign} is out!`;
      log(db, `${attacker.callsign} eliminated ${target.callsign}!`, 'kill', attacker.id);
    }
    winMessage = checkWinCondition(db, attacker);
  } else {
    log(db, `${attacker.callsign} hit ${target.callsign} for ${damage} hearts (${target.hearts} left)`, 'shoot', attacker.id);
  }
  return { ok: true, targetDead: target.isDead, message: `Hit ${target.callsign}.${killMsg}${winMessage ? ` ${winMessage}` : ''}`,
    fx: { type: target.isDead ? 'kill' : 'hit', from: attacker.id, to: target.id } };
}

// Ends the game right here (with a victory log line) if the win condition is
// met after an elimination. Returns a message for the shooter, or null.
export function checkWinCondition(db, attacker) {
  const cfg = db.meta.config;
  const alive = db.players.filter(p => !p.isDead);
  const mode = cfg.winCondition || 'lastStanding';
  let winnerLabel = null;
  if (mode === 'killTarget') {
    if (attacker.kills >= (cfg.killTargetCount || 5)) winnerLabel = `${attacker.callsign} (${attacker.kills} kills)`;
  } else if (mode === 'lastTeamStanding' && cfg.teamsEnabled) {
    const teams = new Set(alive.map(p => p.team).filter(t => t != null));
    if (teams.size === 1 && alive.length > 0) winnerLabel = `Team ${[...teams][0]}`;
    else if (teams.size === 0) winnerLabel = 'nobody — draw';
  } else {
    const threshold = cfg.endgamePlayerCount || 1;
    if (alive.length <= threshold && alive.length > 0) {
      winnerLabel = alive.length === 1 ? alive[0].callsign : `${alive.map(p => p.callsign).join(', ')} (co-winners)`;
    }
  }
  if (!winnerLabel) return null;
  db.meta.status = 'ended';
  db.meta.winner = winnerLabel;
  db.meta.endedAt = Date.now();
  const draw = winnerLabel.includes('draw');
  log(db, `GAME OVER — ${winnerLabel} ${draw ? '' : 'wins'}!`, 'victory');
  return `${winnerLabel}${draw ? '' : ' wins'} — game over!`;
}

export function addHeart(db, userId) {
  const err = requireActive(db); if (err) return fail(err);
  const cfg = db.meta.config;
  const player = byUser(db, userId);
  if (!player) return fail('You are not in this game');
  if (player.isDead) return fail('Fallen tanks cannot repair');
  if (player.ap < cfg.addHeartCost) return fail(`Not enough AP (need ${cfg.addHeartCost})`);
  const cap = cfg.maxHearts || 999;
  if (player.hearts >= cap) return fail(`Already at max hearts (${cap})`);
  player.ap -= cfg.addHeartCost;
  player.hearts = Math.min(player.hearts + 1, cap);
  log(db, `${player.callsign} repaired to ${player.hearts} hearts`, 'heal', player.id);
  return { ok: true, fx: { type: 'heal', id: player.id } };
}

export function upgradeRange(db, userId) {
  const err = requireActive(db); if (err) return fail(err);
  const cfg = db.meta.config;
  const player = byUser(db, userId);
  if (!player) return fail('You are not in this game');
  if (player.isDead) return fail('Fallen tanks cannot upgrade');
  if (player.ap < cfg.upgradeRangeCost) return fail(`Not enough AP (need ${cfg.upgradeRangeCost})`);
  const cap = cfg.maxRange || 999;
  if (player.range >= cap) return fail(`Already at max range (${cap})`);
  player.ap -= cfg.upgradeRangeCost;
  player.range = Math.min(player.range + 1, cap);
  log(db, `${player.callsign} upgraded range to ${player.range}`, 'upgrade', player.id);
  return { ok: true, newRange: player.range };
}

export function sendGift(db, userId, targetId, type, amount) {
  const err = requireActive(db); if (err) return fail(err);
  const cfg = db.meta.config;
  if (!cfg.giftingEnabled) return fail('Gifting is disabled in this game');
  const sender = byUser(db, userId), target = byId(db, targetId);
  if (!sender) return fail('You are not in this game');
  if (!target) return fail('Target not found');
  if (sender.isDead) return fail('Fallen tanks cannot send gifts');
  if (cfg.giftingRequiresRange !== false) {
    const dist = getDistance(sender, target);
    if (dist > sender.range) return fail(`Out of range (your range: ${sender.range}, distance: ${dist})`);
  }
  if (target.isDead && type !== 'hearts') return fail('Can only send hearts to fallen tanks');
  amount = parseInt(amount);
  if (isNaN(amount) || amount < 1) return fail('Invalid amount');

  if (type === 'hearts') {
    if (sender.hearts <= amount) return fail('Not enough hearts (must keep at least 1)');
    sender.hearts -= amount;
    target.hearts = Math.min(target.hearts + amount, cfg.maxHearts || 999);
    if (target.isDead && target.hearts > 0) {
      target.isDead = false; target.ap = 0;
      log(db, `${target.callsign} was revived by ${sender.callsign}!`, 'revive', sender.id);
    } else {
      log(db, `${sender.callsign} gifted ${amount} hearts to ${target.callsign}`, 'gift', sender.id);
    }
  } else if (type === 'ap') {
    if (sender.ap < amount) return fail('Not enough AP');
    sender.ap -= amount; target.ap += amount;
    log(db, `${sender.callsign} gifted ${amount} AP to ${target.callsign}`, 'gift', sender.id);
  } else return fail('Invalid gift type');
  return { ok: true };
}

const dayKey = (t = Date.now()) => new Date(t).toDateString(); // UTC on Workers

export function juryVote(db, userId, targetId) {
  const err = requireActive(db); if (err) return fail(err);
  if (!db.meta.config.juryEnabled) return fail('Jury voting is disabled');
  const voter = byUser(db, userId), target = byId(db, targetId);
  if (!voter) return fail('You are not in this game');
  if (!voter.isDead) return fail('Only fallen tanks can cast jury votes');
  if (!target) return fail('Target not found');
  if (target.isDead) return fail('Cannot vote for a fallen tank');
  const today = dayKey();
  db.juryVotes = db.juryVotes.filter(v => !(v.voterId === voter.id && v.date === today));
  db.juryVotes.push({ voterId: voter.id, targetId: target.id, date: today, timestamp: Date.now() });
  log(db, 'A fallen tank cast their jury vote', 'vote');
  return { ok: true };
}

// --- Host controls (scoped to their own game; always logged and visible) ---
export function hostGrantAP(db, hostUserId, playerId, amount) {
  if (db.meta.hostUserId !== hostUserId) return fail('Host only');
  const player = byId(db, playerId);
  if (!player) return fail('Player not found');
  if (player.userId === hostUserId) return fail("Hosts can't grant AP to their own tank — ask another player or the site admin.");
  player.ap += amount;
  log(db, `Host granted ${amount} AP to ${player.callsign} (now ${player.ap})`, 'host');
  return { ok: true };
}

export function hostSpawnHeart(db, hostUserId) {
  if (db.meta.hostUserId !== hostUserId) return fail('Host only');
  try {
    const pos = randomEmptyPos(db);
    db.heartPickups.push({ x: pos.x, y: pos.y, collected: false, spawnedAt: Date.now() });
    log(db, 'Host spawned a heart on the board', 'host');
    return { ok: true };
  } catch { return fail('No empty space on the board'); }
}

export function hostKick(db, hostUserId, playerId) {
  if (db.meta.hostUserId !== hostUserId) return fail('Host only');
  const i = db.players.findIndex(p => p.id === playerId);
  if (i === -1) return fail('Player not found');
  const name = db.players[i].callsign;
  db.players.splice(i, 1);
  db.juryVotes = db.juryVotes.filter(v => v.voterId !== playerId && v.targetId !== playerId);
  log(db, `Host removed ${name} from the game`, 'host');
  return { ok: true, username: name };
}

// Minimum wait between manual "grant AP now" clicks so a host can't pump AP.
export function hostGrantAllCooldownMs(cfg) {
  const intervalMs = Math.max(0.1, cfg.apIntervalHours || 24) * 3600 * 1000;
  return Math.max(5 * 60 * 1000, intervalMs * 0.25);
}

export function hostGrantAllAP(db, hostUserId) {
  if (db.meta.hostUserId !== hostUserId) return fail('Host only');
  const cooldown = hostGrantAllCooldownMs(db.meta.config);
  if (db.meta.lastAPGrant && Date.now() - db.meta.lastAPGrant < cooldown) {
    const waitMin = Math.ceil((cooldown - (Date.now() - db.meta.lastAPGrant)) / 60000);
    return fail(`AP was granted recently — wait about ${waitMin} more minute(s) before granting again.`);
  }
  return { ok: true, message: grantDailyAP(db, true, 'host') };
}

export function grantDailyAP(db, force = false, logType = 'system') {
  if (db.meta.status !== 'active') return null;
  const cfg = db.meta.config;
  const now = new Date();
  if (!force && cfg.apSchedule === 'workdays') {
    const day = now.getDay();
    if (day === 0 || day === 6) return 'Weekend — AP skipped';
  }
  let hauntedId = null;
  if (cfg.hauntingEnabled) {
    const today = dayKey();
    const counts = {};
    db.juryVotes.filter(v => v.date === today).forEach(v => { counts[v.targetId] = (counts[v.targetId] || 0) + 1; });
    let max = 0;
    for (const [id, c] of Object.entries(counts)) if (c > max) { max = c; hauntedId = id; }
  }
  let granted = 0;
  for (const p of db.players) {
    if (p.isDead) continue;
    if (p.id === hauntedId) log(db, `${p.callsign} is haunted — no AP today!`, 'haunt', p.id);
    else { p.ap += cfg.apPerDay; granted++; }
  }
  db.meta.lastAPGrant = Date.now();
  log(db, `${logType === 'host' ? 'Host manually granted' : 'Daily'} AP (+${cfg.apPerDay}) to ${granted} tanks`, logType);
  return `Granted AP to ${granted} tanks`;
}

export function spawnHeartScheduled(db) {
  if (db.meta.status !== 'active') return false;
  const cfg = db.meta.config;
  if (!cfg.heartSpawnEnabled) return false;
  if (db.heartPickups.filter(h => !h.collected).length >= (cfg.maxHeartsOnBoard || 3)) return false;
  try {
    const pos = randomEmptyPos(db);
    db.heartPickups.push({ x: pos.x, y: pos.y, collected: false, spawnedAt: Date.now() });
    db.meta.lastHeartSpawn = Date.now();
    log(db, 'A heart appeared on the board!', 'heart');
    return true;
  } catch { return false; }
}

// Per-viewer state: hides other players' AP and, with fog of war on, hides
// tanks outside the viewer's own range (visibility == shoot range).
export function getGameState(db, requestingUserId) {
  const cfg = db.meta.config;
  const me = byUser(db, requestingUserId);
  const fogActive = !!cfg.fogOfWarEnabled && me && !me.isDead && me.x !== null;
  let fogHidCount = 0;
  const players = db.players.map(p => {
    const isSelf = p.userId === requestingUserId;
    let x = p.x, y = p.y;
    if (fogActive && !isSelf && p.x !== null && getDistance(me, p) > me.range) { x = null; y = null; fogHidCount++; }
    return { id: p.id, callsign: p.callsign, colorId: p.colorId, colorHex: p.colorHex, team: p.team || null,
      kills: p.kills || 0, x, y, hearts: p.hearts, range: p.range, isDead: p.isDead, ap: isSelf ? p.ap : null, isOwn: isSelf };
  });
  const today = dayKey();
  const voteCount = {};
  db.juryVotes.filter(v => v.date === today).forEach(v => { voteCount[v.targetId] = (voteCount[v.targetId] || 0) + 1; });
  const isHost = db.meta.hostUserId === requestingUserId;
  const logVisible = cfg.actionLogEnabled !== false || isHost;
  let visibleLog = logVisible ? db.gameLog : db.gameLog.filter(e => e.type === 'host');
  if (logVisible && cfg.actionLogWindow === '24h') {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    visibleLog = visibleLog.filter(e => e.time >= cutoff);
  }
  return {
    id: db.meta.id, name: db.meta.name, code: db.meta.code, status: db.meta.status,
    isHost, isPlayer: !!me, me: me ? { id: me.id, isDead: me.isDead } : null,
    players, heartPickups: db.heartPickups.filter(h => !h.collected),
    recentLog: visibleLog.slice(-40), logVisible, voteCount,
    nextAPGrant: db.meta.nextAPGrant || null, winner: db.meta.winner || null, fogActive, fogHidCount,
    config: {
      gridWidth: cfg.gridWidth, gridHeight: cfg.gridHeight, moveCost: cfg.moveCost, shootCost: cfg.shootCost,
      addHeartCost: cfg.addHeartCost, upgradeRangeCost: cfg.upgradeRangeCost, juryEnabled: cfg.juryEnabled,
      giftingEnabled: cfg.giftingEnabled, maxHearts: cfg.maxHearts, maxRange: cfg.maxRange,
      endgamePlayerCount: cfg.endgamePlayerCount,
      chatBroadcastEnabled: cfg.chatBroadcastEnabled !== false, chatWhisperEnabled: cfg.chatWhisperEnabled !== false,
      actionLogEnabled: cfg.actionLogEnabled !== false, actionLogWindow: cfg.actionLogWindow === '24h' ? '24h' : 'full',
      fogOfWarEnabled: !!cfg.fogOfWarEnabled, teamsEnabled: !!cfg.teamsEnabled, teamCount: cfg.teamCount || 2,
      winCondition: cfg.winCondition || 'lastStanding', killTargetCount: cfg.killTargetCount || 5
    }
  };
}

// --- Group chats: a named set of player ids; messages visible to members only ---
export function createGroup(db, userId, name, memberIds) {
  if (db.meta.config.chatWhisperEnabled === false) return fail('Private messaging is turned off in this game');
  const me = byUser(db, userId);
  if (!me) return fail('You are not in this game');
  const validIds = Array.from(new Set((memberIds || []).filter(id => id && id !== me.id))).filter(id => db.players.some(p => p.id === id));
  if (validIds.length < 2) return fail('Pick at least 2 other players to form a group (for just one, use a private message instead)');
  const group = { id: uuid(), name: (name || '').trim().slice(0, 30) || `${me.callsign}'s group`,
    memberIds: [me.id, ...validIds], createdBy: me.id, createdAt: Date.now() };
  db.groups = db.groups || [];
  db.groups.push(group);
  const names = validIds.map(id => byId(db, id)?.callsign).filter(Boolean);
  log(db, `${me.callsign} started a group chat "${group.name}" with ${names.join(', ')}`, 'system', me.id);
  return { ok: true, group: { id: group.id, name: group.name } };
}

export function myGroups(db, userId) {
  const me = byUser(db, userId);
  if (!me) return fail('You are not in this game');
  const groups = (db.groups || []).filter(g => g.memberIds.includes(me.id)).map(g => ({
    id: g.id, name: g.name,
    members: g.memberIds.map(id => byId(db, id)).filter(Boolean).map(p => ({ id: p.id, callsign: p.callsign, colorHex: p.colorHex }))
  }));
  return { ok: true, groups };
}

export function leaveGroup(db, userId, groupId) {
  const me = byUser(db, userId);
  if (!me) return fail('You are not in this game');
  const group = (db.groups || []).find(g => g.id === groupId);
  if (!group || !group.memberIds.includes(me.id)) return fail('Group not found');
  group.memberIds = group.memberIds.filter(id => id !== me.id);
  if (group.memberIds.length < 2) db.groups = db.groups.filter(g => g.id !== groupId);
  return { ok: true };
}

// --- Chat (messages themselves live in their own table in the DO) ---
export function buildChatMessage(db, userId, { text, toId, groupId }) {
  if (!text || !String(text).trim()) return fail('Empty message');
  if (text.length > 300) return fail('Message too long (max 300 chars)');
  const sender = byUser(db, userId);
  if (!sender) return fail('You are not in this game');
  const cfg = db.meta.config;
  let toCallsign = null, groupName = null;
  if (groupId) {
    if (cfg.chatWhisperEnabled === false) return fail('Private messaging is turned off in this game');
    const group = (db.groups || []).find(g => g.id === groupId);
    if (!group || !group.memberIds.includes(sender.id)) return fail('Group not found');
    groupName = group.name;
  } else if (toId) {
    if (cfg.chatWhisperEnabled === false) return fail('Private messaging is turned off in this game');
    if (toId === sender.id) return fail("You can't whisper yourself");
    const target = byId(db, toId);
    if (!target) return fail('Target not found');
    toCallsign = target.callsign;
  } else if (cfg.chatBroadcastEnabled === false) return fail('Bulletin messaging is turned off in this game');
  return { ok: true, message: { id: uuid(), fromId: sender.id, fromCallsign: sender.callsign, toId: toId || null, toCallsign,
    groupId: groupId || null, groupName, text: text.trim(), timestamp: Date.now() } };
}

export function canSeeChat(db, userId, m) {
  const me = byUser(db, userId);
  const myId = me ? me.id : null;
  if (m.groupId) return !!(db.groups || []).find(g => g.id === m.groupId && g.memberIds.includes(myId));
  return !m.toId || m.fromId === myId || m.toId === myId;
}
