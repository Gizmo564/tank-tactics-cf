import { $app, S, api, esc, toast, setView, registerView, countdownMarkup } from '../core.js';
import { ICONS } from '../icons.js';

let refreshTimer = null, onVis = null;

export function gameRow(g, isMine) {
  const statusLabel = g.status === 'lobby' ? 'Waiting for players' : g.status === 'active' ? 'In progress' : 'Ended';
  let actionBtn;
  if (g.status === 'lobby') actionBtn = isMine
    ? `<button class="btn primary sm" data-enter-lobby="${g.id}">Enter lobby</button>`
    : `<button class="btn primary sm" data-join="${g.id}">Join</button>`;
  else if (g.status === 'active') actionBtn = `<button class="btn sm" data-watch="${g.id}">${isMine ? 'Enter' : 'Spectate'}</button>`;
  else actionBtn = `<button class="btn sm ghost" data-watch="${g.id}">View</button>`;
  return `
    <div class="game-row">
      <div>
        <div class="game-title">${esc(g.name)} <span class="small-muted">#${esc(g.code)}</span>${g.visibility === 'unlisted' ? ' <span class="tag">join code only</span>' : ''}</div>
        <div class="game-meta">Hosted by ${esc(g.hostUsername)} · ${g.playerCount}/${g.maxPlayers} tanks${g.status !== 'lobby' ? ` · ${g.aliveCount} still standing` : ''}</div>
        ${g.status === 'active' ? `<div class="game-meta">Next AP grant: ${countdownMarkup(g.nextAPGrant)}</div>` : ''}
      </div>
      <span class="badge ${g.status}">${statusLabel}</span>
      <span class="small-muted">${g.playerCount}/${g.maxPlayers}</span>
      ${actionBtn}
    </div>`;
}

async function render() {
  $app.innerHTML = `
    <div class="topbar">
      <div class="brand"><div class="mark">${ICONS.tank(22)}</div><div class="brand-text">Tank Tactics Arena<small>Turn-based tank warfare</small></div></div>
      <div class="who"><span>Playing as <b>${esc(S.me.username)}</b></span><button class="btn sm ghost" id="logoutBtn">Log out</button></div>
    </div>
    <div class="card">
      <div class="flex-between">
        <div><h2 style="font-size:18px;">Start a new game</h2><p class="small-muted">You'll be the host — pick a preset, tune the rules, then wait for others to join.</p></div>
        <button class="btn primary icon-btn" id="createGameBtn">${ICONS.plus(16)} Create Game</button>
      </div>
      <form class="mt-16 join-block" id="joinForm">
        <label class="small-muted" for="joinCodeInput" style="display:block; margin-bottom:6px;">Have a join code?</label>
        <div class="join-code-row"><input id="joinCodeInput" maxlength="5" placeholder="ABCDE" autocapitalize="characters" autocomplete="off"/><button class="btn" type="submit">Join</button></div>
      </form>
    </div>
    <div class="section-head"><h2>Your games</h2></div>
    <div id="myGameList"></div>
    <div class="section-head"><h2>Open games</h2><button class="btn sm ghost icon-btn" id="refreshBtn">${ICONS.refresh(14)} Refresh</button></div>
    <div id="gameList"></div>`;
  document.getElementById('logoutBtn').onclick = async () => { await api('/api/auth/logout', 'POST'); S.me = null; setView('auth'); };
  document.getElementById('refreshBtn').onclick = load;
  document.getElementById('createGameBtn').onclick = () => setView('wizard');
  document.getElementById('joinForm').onsubmit = async e => {
    e.preventDefault();
    const code = document.getElementById('joinCodeInput').value.trim();
    if (!code) return;
    const r = await api('/api/games/join-by-code', 'POST', { code, callsign: S.me.username });
    if (!r.ok) return toast(r.error, 'bad');
    S.pendingGame = { gameId: r.gameId }; setView('setup');
  };
  await load();
  refreshTimer = setInterval(load, 30000);
  onVis = () => { if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onVis);
}

async function load() {
  const res = await api('/api/games');
  const list = res.ok ? res.games : [];
  const $my = document.getElementById('myGameList'), $open = document.getElementById('gameList');
  if (!$my || !$open) return;
  const mine = list.filter(g => g.isMember), open = list.filter(g => !g.isMember);
  $my.innerHTML = mine.length ? mine.map(g => gameRow(g, true)).join('')
    : `<div class="empty-state card"><p class="small-muted">You're not in any games yet — join one below or create your own.</p></div>`;
  $open.innerHTML = open.length ? open.map(g => gameRow(g, false)).join('')
    : `<div class="empty-state card">${ICONS.tank(40)}<p>${mine.length ? 'No other open games right now.' : 'No games yet. Start the first one above!'}</p></div>`;
  document.querySelectorAll('[data-join]').forEach(b => b.onclick = () => { S.pendingGame = { gameId: b.dataset.join }; setView('setup'); });
  document.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => { S.currentGameId = b.dataset.watch; setView('game'); });
  document.querySelectorAll('[data-enter-lobby]').forEach(b => b.onclick = () => { S.currentGameId = b.dataset.enterLobby; setView('waiting'); });
}
function leave() { clearInterval(refreshTimer); if (onVis) document.removeEventListener('visibilitychange', onVis); }
registerView('lobby', { render, leave });
