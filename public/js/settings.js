// Settings button + panel that unrolls from it: color theme, music, sound effects.
import { THEMES, applyTheme, savedTheme, esc } from './core.js';
import { ICONS } from './icons.js';
import * as A from './sfx.js';

export function setupSettings() {
  const btn = document.getElementById('themeToggleBtn'), panel = document.getElementById('themePanel');
  if (!btn || !panel) return;
  btn.innerHTML = ICONS.gear(20);
  let open = false;
  const setOpen = v => {
    open = v; panel.classList.toggle('open', v); btn.classList.toggle('active', v); btn.setAttribute('aria-expanded', String(v));
    if (v) { A.loadAudioConfig(); draw(); }
  };

  function draw() {
    const cur = savedTheme(), m = A.musicInfo(), s = A.sfxInfo();
    const musicNote = m.tracks ? (m.on ? `${m.playing ? 'Playing' : 'Starts on your next click'}: ${esc(m.name)}` : `${m.tracks} track${m.tracks > 1 ? 's' : ''} ready`)
      : 'No music added yet — see public/audio/README.txt';
    const sfxNote = s.custom ? `${s.custom} custom sound${s.custom > 1 ? 's' : ''} loaded; the rest use built-in sounds` : 'Using the built-in sounds';
    panel.innerHTML = `<div class="sp-inner">
      <div class="sp-title">Theme</div>
      <div class="sp-themes">${THEMES.map(t => `<button type="button" class="theme-option ${t.id === cur ? 'active' : ''}" data-theme-id="${t.id}"><span class="swatch-dot" style="background:${t.swatch}"></span>${esc(t.label)}</button>`).join('')}</div>
      <div class="sp-title">Music</div>
      <div class="sp-row"><span>${ICONS.volume(15)} Background music</span><button type="button" class="switch ${m.on ? 'on' : ''}" role="switch" aria-checked="${m.on}" aria-label="Background music" data-act="music"><i></i></button></div>
      <div class="sp-row"><input type="range" min="0" max="100" value="${Math.round(m.vol * 100)}" aria-label="Music volume" data-vol="music"/>${m.tracks > 1 ? `<button type="button" class="btn sm ghost" data-act="skip" title="Next track" aria-label="Next track">${ICONS.skipForward(14)}</button>` : ''}</div>
      <p class="sp-note">${musicNote}</p>
      <div class="sp-title">Sound effects</div>
      <div class="sp-row"><span>${ICONS.bolt(15)} Effects</span><button type="button" class="switch ${s.on ? 'on' : ''}" role="switch" aria-checked="${s.on}" aria-label="Sound effects" data-act="sfx"><i></i></button></div>
      <div class="sp-row"><input type="range" min="0" max="100" value="${Math.round(s.vol * 100)}" aria-label="Effects volume" data-vol="sfx"/></div>
      <p class="sp-note">${sfxNote}</p>
    </div>`;
  }

  panel.addEventListener('click', e => {
    const t = e.target.closest('[data-theme-id]');
    if (t) { applyTheme(t.dataset.themeId); return draw(); }
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'music') A.setMusic(!A.musicInfo().on);
    else if (a.dataset.act === 'sfx') A.setSound(!A.sfxInfo().on);
    else if (a.dataset.act === 'skip') A.skipTrack();
  });
  // sliders: update the level live without redrawing (a redraw would drop the drag)
  panel.addEventListener('input', e => {
    const r = e.target.closest('[data-vol]'); if (!r) return;
    const v = r.value / 100;
    if (r.dataset.vol === 'music') A.setMusicVolume(v); else A.setSfxVolume(v);
  });
  panel.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.vol === 'sfx') A.play('blip'); });
  A.onAudioChange(() => { const ae = document.activeElement; if (open && !(ae && ae.type === 'range' && panel.contains(ae))) draw(); });

  btn.addEventListener('click', e => { e.stopPropagation(); setOpen(!open); });
  // composedPath is captured at click time, so clicking an element the panel then redraws still counts as "inside"
  document.addEventListener('click', e => { const path = e.composedPath(); if (open && !path.includes(panel) && !path.includes(btn)) setOpen(false); });
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape') { setOpen(false); btn.focus(); } });
  draw();
}
