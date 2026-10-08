import { $app, S, api, esc, toast, setView, registerView, countdownMarkup } from '../core.js';
import { ICONS } from '../icons.js';
import { tankIcon } from '../tanks.js';
import { returnLinkHtml } from '../return-link.js';

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
        <div class="game-meta">Hosted by ${esc(g.hostUsername)} · ${g.playerCount}/${g.maxPlayers} players${g.status !== 'lobby' ? ` · ${g.aliveCount} still standing` : ''}</div>
        ${g.status === 'active' ? `<div class="game-meta">Next AP grant: ${countdownMarkup(g.nextAPGrant)}</div>` : ''}
      </div>
      <span class="badge ${g.status}">${statusLabel}</span>
      <span class="small-muted">${g.playerCount}/${g.maxPlayers}</span>
      ${actionBtn}
    </div>`;
}

async function render() {
  $app.innerHTML = `
    ${returnLinkHtml()}
    <div class="topbar">
      <div class="brand"><div class="mark">${tankIcon("#2f9e8f", 32)}</div><div class="brand-text">Tank Tactics Arena<small>Turn-based tank warfare</small></div></div>
      <div class="who"><a class="btn sm" id="adminBtn" hidden href="https://0801564.xyz/api/admin/handoff?to=tanks">Admin</a><span>Playing as <b>${esc(S.me.username)}</b></span><button class="btn sm ghost" id="logoutBtn">Log out</button></div>
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
    <div id="gameList"></div>
    <details class="archive" id="archive" hidden>
      <summary><span class="arch-title">Archived games</span><span class="arch-count" id="archiveCount"></span></summary>
      <p class="small-muted">Finished games. You can still open one to see how it ended.</p>
      <div id="archiveList"></div>
    </details>`;
  document.getElementById('logoutBtn').onclick = async () => { await api('/api/auth/logout', 'POST'); S.me = null; setView('auth'); };
  // Show the Admin button only for admin accounts. This is just a convenience: the admin console itself is guarded by the 0801564.xyz admin step.
  fetch('https://0801564.xyz/api/me', { credentials: 'include' }).then(r => r.json()).then(d => { if (d && d.admin) document.getElementById('adminBtn')?.removeAttribute('hidden'); }).catch(() => {});
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
  // Finished games move out of the main lists into the collapsible archive (its open/closed state survives refreshes).
  const ended = list.filter(g => g.status === 'ended'), live = list.filter(g => g.status !== 'ended');
  const mine = live.filter(g => g.isMember), open = live.filter(g => !g.isMember);
  const $arch = document.getElementById('archive');
  $arch.hidden = ended.length === 0;
  document.getElementById('archiveCount').textContent = ended.length ? ` (${ended.length})` : '';
  document.getElementById('archiveList').innerHTML = ended.map(g => gameRow(g, g.isMember)).join('');
  $my.innerHTML = mine.length ? mine.map(g => gameRow(g, true)).join('')
    : `<div class="empty-state card"><p class="small-muted">You're not in any games yet — join one below or create your own.</p></div>`;
  $open.innerHTML = open.length ? open.map(g => gameRow(g, false)).join('')
    : `<div class="empty-state card">${tankIcon("#2f9e8f", 56)}<p>${mine.length ? 'No other open games right now.' : 'No games yet. Start the first one above!'}</p></div>`;
  document.querySelectorAll('[data-join]').forEach(b => b.onclick = () => { S.pendingGame = { gameId: b.dataset.join }; setView('setup'); });
  document.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => { S.currentGameId = b.dataset.watch; setView('game'); });
  document.querySelectorAll('[data-enter-lobby]').forEach(b => b.onclick = () => { S.currentGameId = b.dataset.enterLobby; setView('waiting'); });
}
function leave() { clearInterval(refreshTimer); if (onVis) document.removeEventListener('visibilitychange', onVis); }
registerView('lobby', { render, leave });
