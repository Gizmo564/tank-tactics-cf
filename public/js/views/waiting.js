import { $app, S, api, esc, toast, setView, registerView, logLine, connectGameSocket } from '../core.js';
import { ICONS } from '../icons.js';
import { tankIcon } from '../tanks.js';

let sock = null, poll = null, lobby = null;

async function render() {
  const gameId = S.currentGameId;
  await refresh();
  // The socket pushes roster changes instantly; the poll is only a safety net while it's down.
  sock = connectGameSocket(gameId, {
    onState: m => { if (m.lobby) apply(m.lobby); },
    onStatus: up => { clearInterval(poll); if (!up) poll = setInterval(refresh, 5000); }
  });
}
async function refresh() {
  const r = await api(`/api/games/${S.currentGameId}/lobby`);
  if (!r.ok) { toast(r.error || 'Game not found', 'bad'); return setView('lobby'); }
  apply(r);
}
function apply(r) {
  if (S.view !== 'waiting' || !r || r.id !== S.currentGameId) return;   // ignore late replies after leaving
  if (r.status === 'active' || r.status === 'ended') return setView('game');
  lobby = r; draw();
}
function draw() {
  const r = lobby, canStart = r.isHost && r.players.length >= 2;
  $app.innerHTML = `
    <div class="topbar">
      <div class="brand"><div class="mark">${tankIcon("#2f9e8f", 32)}</div><div class="brand-text">${esc(r.name)}<small>Waiting room</small></div></div>
      <div class="gap-8">
        <button class="btn sm ghost icon-btn" id="backArrowBtn">${ICONS.chevron('left', 14)} All games</button>
        <button class="btn sm bad" id="leaveBtn">Leave game</button>
      </div>
    </div>
    <div class="card">
      <div class="flex-between">
        <div>
          <div class="small-muted">Share this code so others can join:</div>
          <div class="gap-8 mt-10" style="align-items:center;"><div class="code-pill">${esc(r.code)}</div><button class="btn sm ghost" id="copyCodeBtn" type="button">Copy</button><button class="btn sm ghost" id="copyLinkBtn" type="button">Copy invite text</button></div>
        </div>
        <div style="text-align:right;">
          <div class="small-muted">${r.players.length}/${r.maxPlayers} tanks joined</div>
          ${r.isHost ? `<button class="btn primary mt-10 icon-btn" id="startBtn" ${canStart ? '' : 'disabled'}>${tankIcon("#2f9e8f", 20)} Start Game</button>` : '<div class="small-muted mt-10">Waiting for the host to start…</div>'}
        </div>
      </div>
      ${r.isHost && !canStart ? '<p class="hint">Need at least 2 tanks to start.</p>' : ''}
      <div class="panel-title mt-16">Roster</div>
      <div class="roster">${r.players.map(p => `<div class="roster-chip"><span class="dot" style="background:${p.colorHex}"></span>${esc(p.callsign)}${p.team ? ` <span class="tag">Team ${p.team}</span>` : ''}</div>`).join('')}</div>
      <div class="panel-title mt-16">Recent activity</div>
      <div class="log-feed">${r.recentLog.slice().reverse().map(l => logLine(l, r.players)).join('')}</div>
    </div>`;
  document.getElementById('backArrowBtn').onclick = () => setView('lobby');
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok, 'good'); } catch { toast('Copy failed — select it manually', 'bad'); } };
  document.getElementById('copyCodeBtn').onclick = () => copy(r.code, 'Code copied');
  document.getElementById('copyLinkBtn').onclick = () => copy(`Join my Tank Tactics game "${r.name}" at ${location.origin} — code: ${r.code}`, 'Invite copied');
  document.getElementById('leaveBtn').onclick = async () => {
    if (!confirm("Leave this game? You can rejoin with the join code later if it hasn't started yet.")) return;
    const res = await api(`/api/games/${S.currentGameId}/leave`, 'POST');
    if (!res.ok) return toast(res.error, 'bad');
    setView('lobby');
  };
  const start = document.getElementById('startBtn');
  if (start) start.onclick = async () => { start.disabled = true; const res = await api(`/api/games/${S.currentGameId}/start`, 'POST'); if (!res.ok) { toast(res.error, 'bad'); start.disabled = false; } };
}
function leave() { if (sock) sock.close(); sock = null; clearInterval(poll); lobby = null; }
registerView('waiting', { render, leave });
