import { $app, S, api, esc, toast, setView, registerView, colorHex } from '../core.js';
import { tankSvg } from '../tanks.js';

let pickedColor = null, pickedTeam = null;
async function render() {
  if (S.colors.length === 0) { const r = await api('/api/games/colors'); if (r.ok) S.colors = r.colors; }
  if (!pickedColor) pickedColor = S.colors[Math.floor(Math.random() * S.colors.length)]?.id;
  const gameId = S.pendingGame.gameId;
  const lobby = await api(`/api/games/${gameId}/lobby`);
  if (!lobby.ok) { toast(lobby.error || 'Game not found', 'bad'); return setView('lobby'); }
  const teamsEnabled = !!lobby.teamsEnabled, teamCount = lobby.teamCount || 2;
  const mine = lobby.players.find(p => p.userId === S.me.userId);
  if (mine && !pickedColor) pickedColor = S.colors.find(c => c.hex === mine.colorHex)?.id;
  if (teamsEnabled && !pickedTeam) pickedTeam = mine?.team || 1;

  $app.innerHTML = `
    <div class="auth-wrap" style="max-width:420px;">
      <div class="tank-preview" id="tankPreview">${tankSvg(colorHex(pickedColor), 72)}</div>
      <h1 style="font-size:24px;">Set up your tank</h1>
      <p class="small-muted" style="margin:6px 0 20px;">Joining <b>${esc(lobby.name)}</b></p>
      <form class="card" id="setupForm" style="text-align:left;">
        <div class="field"><label for="setupCallsign">Callsign (shown in this game)</label><input id="setupCallsign" maxlength="18" value="${esc(mine?.callsign || S.me.username)}"/></div>
        <div class="field"><label>Tank color</label><div class="color-grid" id="colorGrid" role="radiogroup"></div></div>
        ${teamsEnabled ? `<div class="field"><label for="setupTeam">Team</label><select id="setupTeam">${Array.from({ length: teamCount }, (_, i) => i + 1).map(n => `<option value="${n}" ${n === pickedTeam ? 'selected' : ''}>Team ${n}</option>`).join('')}</select></div>` : ''}
        <div class="gap-8" style="margin-top:16px;"><button type="button" class="btn ghost" id="setupBack">Back</button><button class="btn primary" type="submit" style="flex:1;">Enter Lobby</button></div>
      </form>
    </div>`;
  const $grid = document.getElementById('colorGrid');
  $grid.innerHTML = S.colors.map(c => `<button type="button" role="radio" aria-checked="${c.id === pickedColor}" class="swatch ${c.id === pickedColor ? 'selected' : ''}" data-color="${c.id}" style="background:${c.hex}" title="${c.id}"></button>`).join('');
  $grid.querySelectorAll('.swatch').forEach(sw => sw.onclick = () => {
    pickedColor = sw.dataset.color;
    document.getElementById('tankPreview').innerHTML = tankSvg(colorHex(pickedColor), 72);
    $grid.querySelectorAll('.swatch').forEach(s => { const on = s.dataset.color === pickedColor; s.classList.toggle('selected', on); s.setAttribute('aria-checked', on); });
  });
  const $team = document.getElementById('setupTeam');
  if ($team) $team.addEventListener('change', e => { pickedTeam = parseInt(e.target.value); });
  document.getElementById('setupBack').onclick = () => setView('lobby');
  document.getElementById('setupForm').onsubmit = async e => {
    e.preventDefault();
    const callsign = document.getElementById('setupCallsign').value.trim() || S.me.username;
    const r = await api(`/api/games/${gameId}/join`, 'POST', { callsign, colorId: pickedColor, team: teamsEnabled ? pickedTeam : undefined });
    if (!r.ok) return toast(r.error, 'bad');
    S.currentGameId = gameId; pickedColor = null; pickedTeam = null;
    setView('waiting');
  };
}
registerView('setup', { render });
