import { $app, S, api, esc, toast, setView, registerView } from '../core.js';
import { ICONS } from '../icons.js';

const statusLabel = s => (s === 'lobby' ? 'Waiting for players' : s === 'active' ? 'In progress' : 'Ended');
let timer = null;

// ---------- dashboard ----------
async function renderDashboard() {
  const [r, stats] = await Promise.all([api('/api/admin/games'), api('/api/admin/stats')]);
  const list = r.ok ? r.games : [];
  $app.innerHTML = `
    <div class="topbar">
      <div class="brand"><div class="mark">${ICONS.shield(20)}</div><div class="brand-text">Admin Console<small>Every game on this server</small></div></div>
      <div class="who">
        <a class="btn sm ghost icon-btn" href="/api/admin/backup" title="Download every account, game and chat log as one JSON file">${ICONS.download(14)} Download backup</a>
        <span class="admin-topbar-badge">${ICONS.shield(13)} ${esc(S.me.username)}</span>
        <button class="btn sm ghost" id="logoutBtn">Log out</button>
      </div>
    </div>
    <div class="card mb-8"><p><span class="tag" style="background:var(--good); color:#fff; border-color:var(--good);">Persistent</span> Data is stored in Cloudflare Durable Objects (SQLite) and survives idle periods and redeploys. ${stats.ok ? `${stats.users} account(s), ${stats.games} game(s).` : ''} Download a backup now and then as insurance.</p></div>
    <div class="section-head"><h2>All games</h2><button class="btn sm ghost icon-btn" id="refreshBtn">${ICONS.refresh(14)} Refresh</button></div>
    <div id="gameList">${list.length === 0 ? `<div class="empty-state card">${ICONS.shield(40)}<p>No games have been created yet.</p></div>` : list.map(g => `
      <div class="game-row">
        <div><div class="game-title">${esc(g.name)} <span class="small-muted">#${esc(g.code)}</span></div><div class="game-meta">Hosted by ${esc(g.hostUsername)} · ${g.playerCount}/${g.maxPlayers} players</div></div>
        <span class="badge ${g.status}">${statusLabel(g.status)}</span><span class="small-muted">${g.playerCount}/${g.maxPlayers}</span>
        <span class="gap-8"><button class="btn sm" data-spectate="${g.id}">Watch</button><button class="btn primary sm" data-manage="${g.id}">Manage</button></span>
      </div>`).join('')}</div>`;
  document.getElementById('logoutBtn').onclick = async () => { await api('/api/auth/logout', 'POST'); S.me = null; setView('auth'); };
  document.getElementById('refreshBtn').onclick = renderDashboard;
  document.querySelectorAll('[data-manage]').forEach(b => b.onclick = () => { S.adminGameId = b.dataset.manage; setView('admin-game'); });
  document.querySelectorAll('[data-spectate]').forEach(b => b.onclick = () => { S.currentGameId = b.dataset.spectate; setView('game'); });
}

// ---------- one game ----------
async function renderGame() { await poll(); timer = setInterval(poll, 4000); }
async function poll() {
  const r = await api(`/api/admin/games/${S.adminGameId}`);
  if (!r.ok) { toast(r.error || 'Game not found', 'bad'); return setView('admin-dashboard'); }
  S.adminGame = r.game;
  // Don't clobber a number the admin is typing: skip redraw while an input inside the table has focus.
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.admin-table')) return;
  draw();
}
const chatLine = m => (m.groupId
  ? `<div class="chat-msg whisper"><b>[${esc(m.groupName)}] ${esc(m.fromCallsign)}:</b>${esc(m.text)}</div>`
  : `<div class="chat-msg ${m.toId ? 'whisper' : ''}"><b>${esc(m.fromCallsign)}${m.toId ? ` → ${esc(m.toCallsign)}` : ''}:</b>${esc(m.text)}</div>`);

function draw() {
  const g = S.adminGame;
  $app.innerHTML = `
    <div class="topbar">
      <div class="brand"><div class="mark">${ICONS.shield(20)}</div><div class="brand-text">${esc(g.name)}<small>Admin view · #${esc(g.code)}</small></div></div>
      <button class="btn sm ghost" id="backBtn">All games</button>
    </div>
    <div class="card">
      <div class="flex-between">
        <span class="gap-8"><span class="badge ${g.status}">${statusLabel(g.status)}</span>${g.visibility === 'unlisted' ? '<span class="tag">join code only</span>' : ''}</span>
        <span class="gap-8"><button class="btn sm icon-btn" id="watchBtn">${ICONS.eye(14)} Watch live</button>
        <button class="btn sm bad icon-btn" id="endGameBtn" ${g.status === 'ended' ? 'disabled' : ''}>${ICONS.flag(14)} End game</button></span>
      </div>
      <div class="panel-title mt-16">Tanks</div>
      <div style="overflow-x:auto;"><table class="admin-table">
        <thead><tr><th>Callsign</th><th>Account</th><th>Hearts</th><th>AP</th><th>Range</th><th>Status</th><th></th></tr></thead>
        <tbody>${g.players.map(p => p.tanks.map((t, i) => `<tr>
          <td>${i === 0 ? `<span class="dot" style="background:${p.colorHex}; display:inline-block; width:10px; height:10px; margin-right:6px;"></span>${esc(p.callsign)}` : `<span class="small-muted">↳ tank ${i + 1}</span>`}</td>
          <td class="small-muted">${i === 0 ? esc(p.username) : ''}</td>
          <td><div class="inline-form"><input type="number" min="0" value="${t.hearts}" id="hearts-${t.id}" aria-label="Hearts"/><button class="btn sm" data-set-hearts="${t.id}">Set</button></div></td>
          <td>${i === 0 ? `<div class="inline-form"><input type="number" min="0" value="${p.ap}" id="ap-${p.id}" aria-label="AP (shared by all this player's tanks)"/><button class="btn sm" data-set-ap="${p.id}">Set</button></div>` : ''}</td>
          <td>${t.range}</td><td>${t.isDead ? '<span class="tag">down</span>' : '<span class="tag">alive</span>'}</td>
          <td>${i === 0 ? `<div class="gap-8"><button class="btn sm icon-btn" data-kick="${p.id}">${ICONS.userX(12)} Kick</button><button class="btn sm bad icon-btn" data-ban="${p.id}">${ICONS.ban(12)} Ban</button></div>` : ''}</td></tr>`).join('')).join('')}
        </tbody>
      </table></div>
      ${g.bannedUserIds.length ? `<p class="hint">${g.bannedUserIds.length} account(s) banned from this game. ${g.bannedUserIds.map(id => `<button class="btn sm ghost" data-unban="${esc(id)}">Unban ${esc(id.slice(0, 6))}…</button>`).join(' ')}</p>` : ''}
    </div>
    ${g.groups.length ? `<div class="card mt-16"><div class="panel-title">Group chats</div><div class="gap-8">${g.groups.map(gr => `<span class="tag">${esc(gr.name)}: ${gr.members.map(esc).join(', ')}</span>`).join('')}</div></div>` : ''}
    <div class="card mt-16"><div class="panel-title">${ICONS.chat(13)} Full chat history (including whispers and group chats)</div>
      <div class="chat-feed" style="max-height:260px;">${g.chat.length === 0 ? '<p class="small-muted">No messages yet.</p>' : g.chat.map(chatLine).join('')}</div></div>
    <div class="card mt-16"><div class="panel-title">${ICONS.list(13)} Full action log</div>
      <div class="log-feed" style="max-height:320px;">${g.log.map(l => `<div class="log-line ${esc(l.type)}">${esc(l.message)}</div>`).join('')}</div></div>`;
  const act = async (path, body, okMsg) => { const r = await api(`/api/admin/games/${S.adminGameId}/${path}`, 'POST', body); toast(r.ok ? okMsg : r.error, r.ok ? 'good' : 'bad'); await poll(); };
  document.getElementById('backBtn').onclick = () => setView('admin-dashboard');
  document.getElementById('watchBtn').onclick = () => { S.currentGameId = S.adminGameId; setView('game'); };
  const end = document.getElementById('endGameBtn');
  if (end) end.onclick = () => { if (confirm('End this game for everyone?')) act('end', {}, 'Game ended'); };
  document.querySelectorAll('[data-set-hearts]').forEach(b => b.onclick = () => act('set-hearts', { playerId: b.dataset.setHearts, amount: parseInt(document.getElementById(`hearts-${b.dataset.setHearts}`).value) || 0 }, 'Hearts updated'));
  document.querySelectorAll('[data-set-ap]').forEach(b => b.onclick = () => act('set-ap', { playerId: b.dataset.setAp, amount: parseInt(document.getElementById(`ap-${b.dataset.setAp}`).value) || 0 }, 'AP updated'));
  document.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => { if (confirm('Remove this player from the game?')) act('kick', { playerId: b.dataset.kick }, 'Player kicked'); });
  document.querySelectorAll('[data-ban]').forEach(b => b.onclick = () => { if (confirm('Ban this player from this game? They will not be able to rejoin.')) act('ban', { playerId: b.dataset.ban }, 'Player banned'); });
  document.querySelectorAll('[data-unban]').forEach(b => b.onclick = () => act('unban', { userId: b.dataset.unban }, 'Ban lifted'));
}
registerView('admin-dashboard', { render: renderDashboard });
registerView('admin-game', { render: renderGame, leave: () => clearInterval(timer) });
