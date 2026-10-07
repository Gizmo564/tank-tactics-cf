// The live game screen. The shell is built ONCE; every server push updates
// pieces in place (board via Board.update, stats/log by targeted re-render,
// chat by appending), and all clicks use delegated listeners on persistent
// mounts — so nothing is ever torn out from under the player mid-click.
import { $app, S, api, esc, toast, setView, registerView, logLine, heartRow, countdownMarkup, connectGameSocket } from '../core.js';
import { ICONS } from '../icons.js';
import { Board } from '../board.js';
import { soundOn, setSound } from '../sfx.js';

const ZOOM_MIN = 0.4, ZOOM_MAX = 2, ZOOM_STEP = 0.15;
const DIRS = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right', '-1,-1': 'upleft', '1,-1': 'upright', '-1,1': 'downleft', '1,1': 'downright' };
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', q: 'upleft', e: 'upright', z: 'downleft', c: 'downright' };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

let G = null; // per-visit state, rebuilt on every render()

function me() { return G.st && G.st.players.find(p => p.isOwn); }
const gid = () => S.currentGameId;

async function render() {
  G = { st: null, v: -1, board: null, sock: null, poll: null, mode: null, chat: [], chatIds: new Set(), chatSince: 0,
    sigs: {}, zoom: 1, names: lsGet('tt_names', '1') === '1', live: false,
    groupForm: false, groupSel: new Set(), busy: false, replay: null };
  const r = await api(`/api/games/${gid()}/state`);
  if (!r.ok) { toast(r.error || 'Game not found', 'bad'); return setView('lobby'); }
  try { history.replaceState(null, '', `#game/${gid()}`); } catch { /* non-critical */ }  // a reload returns here, not to the lobby
  buildShell();
  applyState(r.state, null);
  loadChat();
  G.sock = connectGameSocket(gid(), {
    onState: m => { if (m.state) applyState(m.state, m.v); },
    onFx: fx => G.board && G.board.fx(fx),
    onChat: addChat,
    onStatus: up => {
      G.live = up; setLive();
      clearInterval(G.poll);
      if (up) refetch(); else G.poll = setInterval(refetch, 15000);
    }
  });
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('keydown', onKey);
}
function leave() {
  if (!G) return;
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  if (G.sock) G.sock.close();
  clearInterval(G.poll);
  document.removeEventListener('visibilitychange', onVisible);
  document.removeEventListener('keydown', onKey);
  G = null;
}
function onVisible() { if (document.visibilityState === 'visible' && G) refetch(); }
async function refetch() {
  if (!G) return;
  const r = await api(`/api/games/${gid()}/state`);
  if (G && r.ok) applyState(r.state, null);
}

// ---------- shell ----------
function buildShell() {
  $app.innerHTML = `
    <div class="topbar">
      <div class="brand"><div class="mark">${ICONS.target(20)}</div><div class="brand-text"><span id="gName"></span><small id="gSub"></small></div></div>
      <div class="gap-8" style="align-items:center;">
        <span class="live-pill off" id="livePill" role="status"><i></i><span>Connecting…</span></span>
        <button class="btn sm ghost" id="backBtn">All games</button>
      </div>
    </div>
    <div id="victory"></div>
    <div class="game-layout">
      <div class="col-main">
        <div id="fogHint"></div>
        <div class="board-toolbar">
          <button type="button" id="namesBtn" title="Toggle names" aria-label="Toggle names" aria-pressed="${G.names}">${ICONS.tag(14)}</button>
          <button type="button" id="soundBtn" title="Toggle sound" aria-label="Toggle sound" aria-pressed="${soundOn()}">${soundOn() ? ICONS.volume(14) : ICONS.volumeOff(14)}</button>
          <span class="tb-sep"></span>
          <button type="button" id="zoomOutBtn" title="Zoom out" aria-label="Zoom out">−</button>
          <span class="zoom-label" id="zoomLabel"></span>
          <button type="button" id="zoomInBtn" title="Zoom in" aria-label="Zoom in">+</button>
          <button type="button" id="zoomFitBtn" title="Fit to screen" aria-label="Fit to screen">${ICONS.expand(14)}</button>
        </div>
        <div class="board-wrap" id="boardWrap"><div id="boardMount" class="board-mount"></div></div>
        <div class="card mt-16 log-card"><div class="panel-title">Battle log</div><div id="logNote"></div><div class="log-feed" id="logFeed"></div></div>
      </div>
      <div class="col-side">
        <div id="statsMount"></div>
        <div id="actionsMount"></div>
        <div id="targetMount"></div>
        <div id="chatMount"></div>
        <div id="hostMount"></div>
      </div>
    </div>`;
  G.board = new Board(document.getElementById('boardMount'), { onCell, onTank });
  G.board.setNames(G.names);
  setZoom(G.zoom, true);
  document.getElementById('backBtn').onclick = () => setView('lobby');
  document.getElementById('namesBtn').onclick = e => {
    G.names = !G.names; lsSet('tt_names', G.names ? '1' : '0'); G.board.setNames(G.names); e.currentTarget.setAttribute('aria-pressed', G.names);
  };
  document.getElementById('soundBtn').onclick = e => {
    setSound(!soundOn()); e.currentTarget.innerHTML = soundOn() ? ICONS.volume(14) : ICONS.volumeOff(14); e.currentTarget.setAttribute('aria-pressed', soundOn());
  };
  document.getElementById('zoomOutBtn').onclick = () => setZoom(G.zoom - ZOOM_STEP);
  document.getElementById('zoomInBtn').onclick = () => setZoom(G.zoom + ZOOM_STEP);
  document.getElementById('zoomFitBtn').onclick = fitZoom;
  document.getElementById('boardWrap').addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setZoom(G.zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }, { passive: false });
  document.getElementById('actionsMount').addEventListener('click', onActionsClick);
  document.getElementById('targetMount').addEventListener('click', onTargetClick);
  document.getElementById('hostMount').addEventListener('click', onHostClick);
  document.getElementById('chatMount').addEventListener('click', onChatClick);
  document.getElementById('chatMount').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'chatInput') { e.preventDefault(); sendChat(); } });
  document.getElementById('chatMount').addEventListener('change', e => {
    if (e.target.matches('#groupForm input[type=checkbox]')) { const id = e.target.dataset.member; if (e.target.checked) G.groupSel.add(id); else G.groupSel.delete(id); }
  });
}
function setLive() {
  const p = document.getElementById('livePill'); if (!p) return;
  p.classList.toggle('off', !G.live);
  p.querySelector('span').textContent = G.live ? 'Live' : 'Reconnecting…';
}

// ---------- zoom ----------
const zoomKey = () => G.st ? `tt_zoom_${G.st.config.gridWidth}x${G.st.config.gridHeight}` : null;
function setZoom(z, silent) {
  G.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  if (zoomKey()) lsSet(zoomKey(), String(G.zoom));
  G.board.setZoom(G.zoom);
  const l = document.getElementById('zoomLabel'); if (l) l.textContent = Math.round(G.zoom * 100) + '%';
}
function fitZoom() {
  const wrap = document.getElementById('boardWrap'); if (!wrap || !G.st) return;
  const c = G.st.config, availW = wrap.clientWidth - 28, availH = Math.max(280, window.innerHeight * 0.68);
  setZoom(Math.min(availW / (c.gridWidth * G.board.cellPx), availH / (c.gridHeight * G.board.cellPx), 1.6));
}

// ---------- applying state ----------
function applyState(st, v) {
  if (v != null) { if (v < G.v) return; G.v = v; }
  const first = !G.st;
  G.st = st;
  const m = me();
  document.getElementById('gName').textContent = st.name;
  document.getElementById('gSub').textContent = st.status === 'active' ? (m ? 'Battle in progress' : 'Spectating') : 'Game over';
  // victory banner
  document.getElementById('victory').innerHTML = st.status === 'ended' && st.winner
    ? `<div class="card victory-banner"><div class="panel-title">${ICONS.flag(15)} Game over</div><p>${esc(st.winner)}${/draw/i.test(st.winner) ? '' : ' wins'}!</p></div>` : '';
  document.getElementById('fogHint').innerHTML = st.fogActive
    ? `<p class="hint mb-8">${ICONS.eye(13)} Fog of war is on — you only see tanks within your range (${st.fogHidCount} hidden right now).</p>` : '';
  if (G.mode && (!m || m.isDead || st.status !== 'active')) G.mode = null;
  G.board.update(st, { actionMode: G.mode });
  if (first) restoreZoom();
  renderStats(); renderActions(); renderTarget(); renderLog(); renderChatShell(); renderHost();
}
// A zoom the player chose is remembered per board size and never overridden; only a first visit auto-fits.
function restoreZoom() {
  const saved = parseFloat(lsGet(zoomKey(), ''));
  if (saved) return setZoom(saved);
  fitZoom();
}

function renderStats() {
  const st = G.st, m = me(), cfg = st.config, el = document.getElementById('statsMount');
  const html = m ? `
    <div class="card">
      <div class="panel-title">Your tank</div>
      ${m.team ? `<div class="stat-row"><span class="label">Team</span><span class="val">Team ${m.team}</span></div>` : ''}
      <div class="stat-row"><span class="label">Hearts</span><span class="val">${heartRow(m.hearts)}</span></div>
      <div class="stat-row"><span class="label">${ICONS.bolt(13)} Action Points</span><span class="val">${m.ap}</span></div>
      <div class="stat-row"><span class="label">${ICONS.radar(13)} Range</span><span class="val">${m.range}</span></div>
      ${cfg.winCondition === 'killTarget' ? `<div class="stat-row"><span class="label">${ICONS.target(13)} Kills</span><span class="val">${m.kills || 0} / ${cfg.killTargetCount}</span></div>` : ''}
      ${st.status === 'active' ? `<div class="stat-row"><span class="label">${ICONS.clock(13)} Next AP grant</span><span class="val">${countdownMarkup(st.nextAPGrant)}</span></div>` : ''}
      ${m.isDead && st.status === 'active' ? `<p class="hint">You're out — but as jury you can still vote each day, or wait to be revived.</p>` : ''}
    </div>`
    : `<div class="card"><p class="small-muted">You're spectating this game.</p>
      <div class="stat-row"><span class="label">Tanks alive</span><span class="val">${st.players.filter(p => !p.isDead).length} / ${st.players.length}</span></div>
      ${st.status === 'active' ? `<div class="stat-row"><span class="label">${ICONS.clock(13)} Next AP grant</span><span class="val">${countdownMarkup(st.nextAPGrant)}</span></div>` : ''}</div>`;
  const key = html.replace(/(class="countdown"[^>]*>)[^<]*/g, '$1'); // ticking text must not force a redraw
  if (key !== G.sigs.stats) { el.innerHTML = html; G.sigs.stats = key; }
}

function renderActions() {
  const st = G.st, m = me(), cfg = st.config, el = document.getElementById('actionsMount');
  if (!m || st.status !== 'active') { el.innerHTML = ''; G.sigs.actions = ''; return; }
  const sig = [m.isDead, cfg.moveCost, cfg.shootCost, cfg.addHeartCost, cfg.upgradeRangeCost, cfg.giftingEnabled, cfg.juryEnabled].join('|');
  if (sig !== G.sigs.actions) {
    G.sigs.actions = sig;
    el.innerHTML = m.isDead ? `
      <div class="card mt-16"><div class="panel-title">Jury vote</div>
        <button class="btn action-mode block icon-btn" data-mode="vote">${ICONS.scale(16)} Vote to haunt a tank</button></div>`
    : `
      <div class="card mt-16">
        <div class="panel-title">Move (${cfg.moveCost} AP)</div>
        <div class="dpad">
          <button data-dir="upleft" aria-label="Up-left">${ICONS.chevron('upleft', 16)}</button><button data-dir="up" aria-label="Up">${ICONS.chevron('up', 16)}</button><button data-dir="upright" aria-label="Up-right">${ICONS.chevron('upright', 16)}</button>
          <button data-dir="left" aria-label="Left">${ICONS.chevron('left', 16)}</button><div class="center">${ICONS.tank(18)}</div><button data-dir="right" aria-label="Right">${ICONS.chevron('right', 16)}</button>
          <button data-dir="downleft" aria-label="Down-left">${ICONS.chevron('downleft', 16)}</button><button data-dir="down" aria-label="Down">${ICONS.chevron('down', 16)}</button><button data-dir="downright" aria-label="Down-right">${ICONS.chevron('downright', 16)}</button>
        </div>
        <p class="hint kbd-hint">Tip: click a tile next to you, or use arrow keys / WASD (Q E Z C for diagonals).</p>
        <div class="action-grid">
          <button class="btn action-mode sm icon-btn" data-mode="shoot" data-cost="${cfg.shootCost}">${ICONS.target(14)} Shoot (${cfg.shootCost})</button>
          <button class="btn sm icon-btn" data-act="heal" data-cost="${cfg.addHeartCost}">${ICONS.wrench(14)} Repair (${cfg.addHeartCost})</button>
          <button class="btn sm icon-btn" data-act="upgrade" data-cost="${cfg.upgradeRangeCost}">${ICONS.radar(14)} +Range (${cfg.upgradeRangeCost})</button>
          ${cfg.giftingEnabled ? `<button class="btn action-mode sm icon-btn" data-mode="gift-hearts">${ICONS.heart(14)} Gift heart</button>
          <button class="btn action-mode sm icon-btn" data-mode="gift-ap">${ICONS.bolt(14)} Gift AP</button>` : ''}
        </div>
      </div>`;
  }
  // in-place updates only: affordability + active mode (no re-render = no lost clicks)
  el.querySelectorAll('[data-dir]').forEach(b => { b.disabled = m.ap < cfg.moveCost; });
  el.querySelectorAll('[data-cost]').forEach(b => { b.disabled = m.ap < +b.dataset.cost; });
  el.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b.dataset.mode === G.mode); b.setAttribute('aria-pressed', b.dataset.mode === G.mode); });
}

function renderLog() {
  const st = G.st;
  const note = !st.logVisible ? `<p class="hint mb-8">Full action history is off in this game. Host actions still show here.</p>`
    : st.config.actionLogWindow === '24h' ? `<p class="hint mb-8">Quick history mode — showing only the last 24 hours.</p>` : '';
  document.getElementById('logNote').innerHTML = note;
  const html = st.recentLog.length ? st.recentLog.slice().reverse().map(l => logLine(l, st.players)).join('') : '<p class="small-muted">Nothing logged yet.</p>';
  if (html !== G.sigs.log) { document.getElementById('logFeed').innerHTML = html; G.sigs.log = html; }
}

// ---------- targeting ----------
function candidates() {
  const st = G.st, m = me(); if (!m || !G.mode) return [];
  let c = st.players.filter(p => p.id !== m.id);
  if (G.mode === 'shoot' || G.mode === 'gift-ap' || G.mode === 'vote') c = c.filter(p => !p.isDead);
  if (st.fogActive && (G.mode === 'shoot' || G.mode.startsWith('gift'))) c = c.filter(p => p.x !== null);
  return c;
}
function renderTarget() {
  const el = document.getElementById('targetMount'), m = me();
  if (!G.mode || !m) { el.innerHTML = ''; G.sigs.target = ''; return; }
  const c = candidates();
  const sig = G.mode + '|' + c.map(p => p.id + p.isDead + p.team).join(',');
  if (sig === G.sigs.target) return;           // unchanged → keep the DOM (and any typed gift amounts)
  const amts = {}; el.querySelectorAll('input[data-amt]').forEach(i => { amts[i.dataset.amt] = i.value; });
  G.sigs.target = sig;
  const label = { shoot: 'Choose a target to shoot', 'gift-hearts': 'Choose who receives hearts', 'gift-ap': 'Choose who receives AP', vote: 'Choose who to haunt today' }[G.mode];
  const gift = G.mode.startsWith('gift');
  el.innerHTML = `<div class="card mt-16"><div class="panel-title">${label}</div><div class="target-list">
    ${c.length ? c.map(p => `<div class="target-row"><span><span class="dot sm" style="background:${p.colorHex}"></span>${esc(p.callsign)}${p.team ? ` <span class="tag">Team ${p.team}</span>` : ''}${p.isDead ? ' <span class="tag">down</span>' : ''}</span>
      ${gift ? `<span class="gap-8"><input type="number" min="1" value="${esc(amts[p.id] || '1')}" class="amt" data-amt="${p.id}" aria-label="Amount for ${esc(p.callsign)}"/><button class="btn sm" data-target="${p.id}">Send</button></span>`
        : `<button class="btn sm" data-target="${p.id}">${G.mode === 'vote' ? 'Vote' : 'Fire'}</button>`}</div>`).join('') : '<p class="small-muted">No valid targets right now.</p>'}
    </div></div>`;
}
function setMode(mode) {
  G.mode = G.mode === mode ? null : mode;
  G.board.update(G.st, { actionMode: G.mode });
  renderActions(); renderTarget();
}
function onActionsClick(e) {
  const dir = e.target.closest('[data-dir]'), act = e.target.closest('[data-act]'), mode = e.target.closest('[data-mode]');
  if (dir) return doMove(dir.dataset.dir);
  if (act) return doSimple(act.dataset.act);
  if (mode) return setMode(mode.dataset.mode);
}
function onTankTargetable(id) { return G.mode && candidates().some(p => p.id === id); }
function onTank(id) { if (G.mode && onTankTargetable(id)) targeted(id); }
function onTargetClick(e) { const b = e.target.closest('[data-target]'); if (b) targeted(b.dataset.target); }
function onCell(x, y) {
  const m = me(); if (!m || m.isDead || m.x === null || G.st.status !== 'active') return;
  if (G.mode) return;
  const d = DIRS[`${Math.sign(x - m.x)},${Math.sign(y - m.y)}`];
  if (d && Math.max(Math.abs(x - m.x), Math.abs(y - m.y)) === 1) doMove(d);
}
function onKey(e) {
  if (!G || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.matches('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'Escape' && G.mode) return setMode(G.mode);
  const d = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  const m = me();
  if (!d || !m || m.isDead || G.st.status !== 'active') return;
  e.preventDefault(); doMove(d);
}

// ---------- actions ----------
async function post(path, body) {
  const r = await api(`/api/games/${gid()}/${path}`, 'POST', body);
  // The socket pushes the new state; only fall back to a refetch if it is down.
  if (G && !(G.sock && G.sock.open)) refetch();
  return r;
}
async function doMove(direction) {
  if (G.busy) return; G.busy = true;
  const r = await post('action/move', { direction });
  G.busy = false;
  if (!r.ok) toast(r.error, 'bad'); else if (r.heartPickedUp) toast('Picked up a heart', 'good');
}
async function doSimple(act) {
  const r = await post(`action/${act}`);
  if (!r.ok) toast(r.error, 'bad'); else if (act === 'upgrade') toast(`Range upgraded to ${r.newRange}`, 'good'); else toast(r.message || 'Repaired', 'good');
}
async function targeted(targetId) {
  const mode = G.mode; let r;
  if (mode === 'shoot') r = await post('action/shoot', { targetId });
  else if (mode === 'vote') r = await post('action/vote', { targetId });
  else if (mode && mode.startsWith('gift')) {
    const i = document.querySelector(`input[data-amt="${targetId}"]`);
    r = await post('action/gift', { targetId, type: mode === 'gift-hearts' ? 'hearts' : 'ap', amount: parseInt(i && i.value, 10) || 1 });
  } else return;
  if (!r.ok) return toast(r.error, 'bad');   // keep the mode on failure so the player can retry
  toast(r.message || 'Done', 'good');
  if (G) { G.mode = null; G.board.update(G.st, { actionMode: null }); renderActions(); renderTarget(); }
}

// ---------- host ----------
function renderHost() {
  const st = G.st, el = document.getElementById('hostMount');
  if (!st.isHost || st.status !== 'active') { el.innerHTML = ''; G.sigs.host = ''; return; }
  const sig = st.players.map(p => p.id + p.isDead + p.isOwn + p.callsign).join(',');
  if (sig === G.sigs.host) return;
  G.sigs.host = sig;
  el.innerHTML = `
    <div class="card mt-16"><div class="panel-title">Host controls</div>
      <div class="gap-8">
        <button class="btn sm icon-btn" data-host="grant-ap-all">${ICONS.sun(14)} Grant daily AP</button>
        <button class="btn sm icon-btn" data-host="spawn-heart">${ICONS.plus(14)} Spawn heart</button>
        <button class="btn sm bad icon-btn" data-host="end">${ICONS.flag(14)} End game</button>
      </div>
      <p class="hint">Hosts can't grant AP to their own tank — every host action is logged for everyone to see.</p>
      <div class="target-list mt-16">${st.players.map(p => `
        <div class="target-row"><span>${esc(p.callsign)}${p.isDead ? ' <span class="tag">down</span>' : ''}${p.isOwn ? ' <span class="tag">you</span>' : ''}</span>
          <span class="gap-8">${p.isOwn ? '' : `<button class="btn sm icon-btn" data-host-ap="${p.id}">${ICONS.bolt(12)} +1</button>`}
          <button class="btn sm bad icon-btn" data-host-kick="${p.id}">${ICONS.userX(12)} Kick</button></span></div>`).join('')}</div>
    </div>`;
}
async function onHostClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.host === 'grant-ap-all') { const r = await post('host/grant-ap-all'); toast(r.message || r.error, r.ok ? 'good' : 'bad'); }
  else if (b.dataset.host === 'spawn-heart') { const r = await post('host/spawn-heart'); toast(r.ok ? 'Heart spawned' : r.error, r.ok ? 'good' : 'bad'); }
  else if (b.dataset.host === 'end') { if (!confirm('End this game for everyone?')) return; const r = await post('end'); toast(r.ok ? 'Game ended' : r.error, r.ok ? '' : 'bad'); }
  else if (b.dataset.hostAp) { const r = await post('host/grant-ap', { playerId: b.dataset.hostAp, amount: 1 }); toast(r.ok ? '+1 AP granted' : r.error, r.ok ? 'good' : 'bad'); }
  else if (b.dataset.hostKick) { if (!confirm('Remove this player from the game?')) return; const r = await post('host/kick', { playerId: b.dataset.hostKick }); toast(r.ok ? 'Player kicked' : r.error, r.ok ? 'good' : 'bad'); }
}

// ---------- chat ----------
async function loadChat() {
  const r = await api(`/api/games/${gid()}/chat?since=0`);
  if (!G || !r.ok) return;
  r.messages.forEach(m => addChat(m, true)); drawChat();
}
function addChat(m, batch) {
  if (!G) return;
  const id = m.id || `${m.timestamp}|${m.fromId}|${m.text}`;
  if (G.chatIds.has(id)) return;
  G.chatIds.add(id); G.chat.push(m); if (G.chat.length > 150) G.chat.shift();
  if (!batch) drawChat(true);
}
function chatMsgHtml(m) {
  if (m.groupId) return `<div class="chat-msg whisper"><b>[${esc(m.groupName)}] ${esc(m.fromCallsign)}:</b>${esc(m.text)}</div>`;
  return `<div class="chat-msg ${m.toId ? 'whisper' : ''}"><b>${esc(m.fromCallsign)}${m.toId ? ` → ${esc(m.toCallsign)}` : ''}:</b>${esc(m.text)}</div>`;
}
function drawChat(stick) {
  const f = document.getElementById('chatFeed'); if (!f) return;
  const nearBottom = f.scrollHeight - f.scrollTop - f.clientHeight < 60;
  f.innerHTML = G.chat.map(chatMsgHtml).join('') || '<p class="small-muted">No messages yet.</p>';
  if (!stick || nearBottom) f.scrollTop = f.scrollHeight;
}
function renderChatShell() {
  const st = G.st, cfg = st.config, el = document.getElementById('chatMount');
  if (!(cfg.chatBroadcastEnabled || cfg.chatWhisperEnabled)) { el.innerHTML = ''; return; }
  if (!document.getElementById('chatFeed')) {
    el.innerHTML = `<div class="card mt-16"><div class="panel-title">Chat</div><div class="chat-feed" id="chatFeed"></div>
      <div id="chatControls"></div></div>`;
    drawChat();
  }
  const m = me();
  if (!st.isPlayer || st.status !== 'active' && st.status !== 'ended') { document.getElementById('chatControls').innerHTML = ''; G.sigs.chat = ''; return; }
  const others = st.players.filter(p => p.id !== m.id);
  const sig = [cfg.chatBroadcastEnabled, cfg.chatWhisperEnabled, G.groupForm, st.groups.map(g => g.id + g.name).join(','), others.map(p => p.id + p.callsign).join(',')].join('|');
  if (sig === G.sigs.chat) return;
  G.sigs.chat = sig;
  const box = document.getElementById('chatControls');
  const prevTarget = (document.getElementById('chatTarget') || {}).value;
  const hadFocus = document.activeElement && document.activeElement.id === 'chatInput';
  const prevText = (document.getElementById('chatInput') || {}).value || '';
  box.innerHTML = `
    ${cfg.chatWhisperEnabled ? `<div class="field" style="margin-bottom:6px;"><label for="chatTarget">Send to</label>
      <select id="chatTarget">${cfg.chatBroadcastEnabled ? '<option value="">Everyone</option>' : ''}
        ${st.groups.length ? `<optgroup label="Your groups">${st.groups.map(g => `<option value="group:${g.id}">${esc(g.name)}</option>`).join('')}</optgroup>` : ''}
        <optgroup label="Private message">${others.map(p => `<option value="${p.id}">${esc(p.callsign)}</option>`).join('')}</optgroup></select>
      <button type="button" class="btn sm ghost mt-10 icon-btn" data-chat="newgroup">${ICONS.plus(12)} New group chat</button></div>
      <div id="groupForm">${G.groupForm ? groupFormHtml(others) : ''}</div>` : ''}
    <div class="chat-input-row"><input id="chatInput" placeholder="Say something…" maxlength="300" aria-label="Chat message"/><button class="btn sm" data-chat="send">Send</button></div>`;
  const input = document.getElementById('chatInput'); input.value = prevText; if (hadFocus) input.focus();
  const sel = document.getElementById('chatTarget');
  if (sel && prevTarget && [...sel.options].some(o => o.value === prevTarget)) sel.value = prevTarget;
}
function groupFormHtml(others) {
  return `<div class="card inset"><div class="field" style="margin-bottom:8px;"><label for="groupName">Group name (optional)</label><input id="groupName" maxlength="30" placeholder="e.g. Northern Alliance"/></div>
    <label class="small-muted" style="display:block; margin-bottom:6px;">Pick at least 2 other players</label>
    <div class="target-list" style="margin-bottom:10px;">${others.map(p => `<div class="field-checkbox"><input type="checkbox" id="mem-${p.id}" data-member="${p.id}" ${G.groupSel.has(p.id) ? 'checked' : ''}/><label for="mem-${p.id}"><span class="dot sm" style="background:${p.colorHex}"></span>${esc(p.callsign)}</label></div>`).join('')}</div>
    <div class="gap-8"><button type="button" class="btn sm ghost" data-chat="cancelgroup">Cancel</button><button type="button" class="btn sm primary" data-chat="creategroup">Create group</button></div></div>`;
}
async function onChatClick(e) {
  const b = e.target.closest('[data-chat]'); if (!b) return;
  const a = b.dataset.chat;
  if (a === 'send') return sendChat();
  if (a === 'newgroup') { G.groupForm = !G.groupForm; G.sigs.chat = ''; return renderChatShell(); }
  if (a === 'cancelgroup') { G.groupForm = false; G.groupSel = new Set(); G.sigs.chat = ''; return renderChatShell(); }
  if (a === 'creategroup') {
    const r = await api(`/api/games/${gid()}/groups`, 'POST', { name: document.getElementById('groupName').value.trim(), memberIds: [...G.groupSel] });
    if (!r.ok) return toast(r.error, 'bad');
    toast('Group chat created', 'good'); G.groupForm = false; G.groupSel = new Set(); G.sigs.chat = '';
    await refetch();
  }
}
async function sendChat() {
  const input = document.getElementById('chatInput'); if (!input) return;
  const text = input.value.trim(); if (!text) return;
  const raw = (document.getElementById('chatTarget') || {}).value || '';
  input.value = '';
  const r = await api(`/api/games/${gid()}/chat/send`, 'POST', {
    text, toId: raw && !raw.startsWith('group:') ? raw : null, groupId: raw.startsWith('group:') ? raw.slice(6) : null });
  if (!r.ok) { toast(r.error, 'bad'); input.value = text; }
  else if (G && !(G.sock && G.sock.open)) loadChatSince();
}
async function loadChatSince() { const r = await api(`/api/games/${gid()}/chat?since=0`); if (G && r.ok) { r.messages.forEach(m => addChat(m, true)); drawChat(true); } }

registerView('game', { render, leave });
