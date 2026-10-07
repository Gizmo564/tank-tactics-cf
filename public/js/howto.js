// "How to play" popup. Shown automatically the first time a game is opened in this browser,
// and reopenable from the "?" button above the map. The text is built from this game's own rules.
import { esc } from './core.js';
import { ICONS } from './icons.js';
import { tankSvg } from './tanks.js';

const KEY = 'tt_howto_seen';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode: it will just show again */ } };

function goal(c) {
  if (c.winCondition === 'killTarget') return `Be the first tank to destroy <b>${c.killTargetCount}</b> enemy tanks.`;
  if (c.winCondition === 'lastTeamStanding' && c.teamsEnabled) return 'Work with your team: you win when your team is the only one with tanks still running.';
  return c.endgamePlayerCount > 1
    ? `Outlast everyone else. The game ends when <b>${c.endgamePlayerCount}</b> or fewer players remain, and the survivors win together.`
    : 'Be the <b>last player standing</b>.';
}
function apLine(c) {
  const every = c.apIntervalHours >= 24 && c.apIntervalHours % 24 === 0
    ? (c.apIntervalHours === 24 ? 'day' : `${c.apIntervalHours / 24} days`) : `${c.apIntervalHours} hour${c.apIntervalHours === 1 ? '' : 's'}`;
  const weekdays = c.apSchedule === 'workdays' ? ' (weekdays only)' : '';
  return `Everything you do costs <b>Action Points (AP)</b>. You earn <b>${c.apPerDay} AP</b> about every ${every}${weekdays}; the countdown is in the “Your tank${c.tanksPerPlayer > 1 ? 's' : ''}” panel.${c.tanksPerPlayer > 1 ? ' All your tanks share this one pool.' : ''}`;
}

export function howToHtml(st) {
  const c = st.config;
  const items = [
    [ICONS.target(18), 'Goal', goal(c)],
    [ICONS.bolt(18), 'Action points', apLine(c)],
    ...(c.tanksPerPlayer > 1 ? [[ICONS.tank(18), `Your ${c.tanksPerPlayer} tanks`,
      `You command <b>${c.tanksPerPlayer} tanks</b>, each with its own hearts and range. Click one on the map, or press 1–${c.tanksPerPlayer}, to select it — moving, shooting, repairing and gifting all use the selected tank. Click empty ground out of its range to let go. A range upgrade lifts all your tanks at once. A tank at 0 hearts becomes a <b>wreck</b> that stays put and blocks its square until someone gifts it a heart; you're out only when every tank is a wreck.`]] : []),
    [ICONS.chevron('upright', 18), `Move (${c.moveCost} AP)`, 'Tap a tile next to your tank, use the arrow pad, or press the arrow keys / WASD (Q E Z C for diagonals). You can drive in 8 directions, but not onto another tank. Driving over a heart picks it up for <b>+1 heart</b>.'],
    [ICONS.radar(18), `Shoot (${c.shootCost} AP)`, `Any tank within your <b>range</b> can be hit. Range is rounded: straight up, down, left and right reach your full range, and the far corners of the square are cut off. A hit takes ${c.shootDamage === 1 ? 'a heart' : c.shootDamage + ' hearts'} off the target, and at 0 hearts that tank is out.${c.transferAPOnKill ? ' Eliminating a tank <b>takes its unspent AP</b>.' : ''}`],
    [ICONS.heart(18), 'Stay alive', `Repair a heart for ${c.addHeartCost} AP, or spend ${c.upgradeRangeCost} AP to increase your range by 1 (up to ${c.maxRange}). Hearts max out at ${c.maxHearts}.${c.heartSpawnEnabled ? ' New hearts appear on the board from time to time.' : ''}`]
  ];
  if (c.giftingEnabled) items.push([ICONS.users(18), 'Allies', `You can give hearts or AP to other players. Make deals, form alliances, break them.${c.tanksPerPlayer > 1 ? ` You can also move hearts between your own tanks${c.tankGiftCost > 0 ? ` (${c.tankGiftCost} AP)` : ''} — even a tank's last one, which revives a wreck.` : ''}`]);
  if (c.fogOfWarEnabled) items.push([ICONS.eye(18), 'Fog of war', 'You only see tanks that are within your range, so range is also your eyesight.']);
  if (c.teamsEnabled) items.push([ICONS.shield(18), 'Teams', 'Teammates are marked with a coloured dot on their tank.']);
  if (c.juryEnabled) items.push([ICONS.scale(18), 'If you fall', `Fallen tanks join the jury and vote each day on a tank to haunt${c.hauntingEnabled ? ' — the most-voted tank gets <b>no AP</b> that day' : ''}.`]);
  return `
    <div class="howto-head">${tankSvg('#2f9e8f', 56, 35)}<div><h2 id="howtoTitle">How to play</h2><p class="small-muted">A quick guide to ${esc(st.name)}</p></div></div>
    <ul class="howto-list">${items.map(([ic, t, body]) => `<li><span class="howto-ic">${ic}</span><div><div class="howto-t">${t}</div><p>${body}</p></div></li>`).join('')}</ul>
    <p class="hint">You can reopen this any time with the <b>?</b> button above the map.</p>
    <div class="howto-actions"><button type="button" class="btn primary" data-close>Got it, let's play</button></div>`;
}

export function showHowTo(st) {
  if (document.getElementById('howtoModal')) return;
  markSeen();
  const prev = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-backdrop'; back.id = 'howtoModal';
  back.innerHTML = `<div class="modal howto" role="dialog" aria-modal="true" aria-labelledby="howtoTitle">${howToHtml(st)}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.key === 'Tab') {                     // keep focus inside the dialog
      const f = [...back.querySelectorAll('button, [href], input, select, textarea')].filter(x => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  back.querySelector('[data-close]').focus();
}

// Called when a game screen first loads.
export function maybeShowHowTo(st) { if (!seen() && st.status === 'active') showHowTo(st); }
