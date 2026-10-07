import { $app, S, api, esc, toast, setView, registerView } from '../core.js';
import { ICONS } from '../icons.js';

let wizard = { presetId: 'standard', name: '', config: {}, visibility: 'public' };
const GROUPS = { board: 'Board & players', ap: 'Action points', economy: 'Action costs', combat: 'Combat & pickups', social: 'Social', messaging: 'Messaging & history', teams: 'Teams & victory' };

function field(f) {
  const val = wizard.config[f.key];
  if (f.type === 'bool') return `<div class="field-checkbox"><input type="checkbox" id="f_${f.key}" ${val ? 'checked' : ''}/><label for="f_${f.key}">${esc(f.label)}</label></div>`;
  if (f.type === 'enum') return `<div class="field"><label for="f_${f.key}">${esc(f.label)}</label><select id="f_${f.key}">${f.options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
  return `<div class="field"><label for="f_${f.key}">${esc(f.label)}</label><input type="number" id="f_${f.key}" step="${f.type === 'float' ? '0.25' : '1'}" min="${f.min}" max="${f.max}" value="${val}"/></div>`;
}

async function render() {
  if (S.presets.length === 0) {
    const r = await api('/api/games/presets');
    if (r.ok) { S.presets = r.presets; S.presetFields = r.fields; }
  }
  const preset = S.presets.find(p => p.id === wizard.presetId) || S.presets[0];
  const full = (S.presets.find(p => p.id === 'standard') || preset).overrides;
  if (Object.keys(wizard.config).length === 0) wizard.config = { ...full, ...preset.overrides };
  const byGroup = {};
  S.presetFields.forEach(f => { (byGroup[f.group] = byGroup[f.group] || []).push(f); });

  $app.innerHTML = `
    <div class="topbar">
      <div class="brand"><div class="mark">${ICONS.sliders(20)}</div><div class="brand-text">New Game<small>Setup wizard</small></div></div>
      <button class="btn sm ghost" id="wizardBack">Cancel</button>
    </div>
    <div class="card">
      <div class="field-grid">
        <div class="field"><label for="wizardName">Game name</label><input id="wizardName" maxlength="40" placeholder="e.g. Friday Night Tanks" value="${esc(wizard.name)}"/></div>
        <div class="field"><label for="wizardVisibility">Privacy</label>
          <select id="wizardVisibility">
            <option value="public" ${wizard.visibility === 'public' ? 'selected' : ''}>Open — anyone can find it in the games list</option>
            <option value="unlisted" ${wizard.visibility === 'unlisted' ? 'selected' : ''}>Join code only — hidden from the list</option>
          </select></div>
      </div>
      <div class="field-group-title">Choose a preset</div>
      <div class="preset-grid">${S.presets.map(p => `
        <button type="button" class="preset-card ${p.id === wizard.presetId ? 'selected' : ''}" data-preset="${p.id}"><div class="p-title">${esc(p.label)}</div><div class="p-blurb">${esc(p.blurb)}</div></button>`).join('')}</div>
      ${Object.keys(byGroup).map(g => `<div class="field-group-title">${GROUPS[g] || g}</div><div class="field-grid">${byGroup[g].map(field).join('')}</div>${g === 'ap' ? '<p class="hint" id="apHint" hidden></p>' : ''}`).join('')}
      <button class="btn primary block mt-16" id="wizardCreate">${ICONS.plus(16)} Create Game</button>
    </div>`;

  document.getElementById('wizardBack').onclick = () => setView('lobby');
  document.querySelectorAll('[data-preset]').forEach(c => c.onclick = () => {
    wizard.name = document.getElementById('wizardName').value;
    wizard.presetId = c.dataset.preset;
    wizard.config = { ...full, ...S.presets.find(p => p.id === wizard.presetId).overrides };
    render();
  });
  S.presetFields.forEach(f => {
    const el = document.getElementById('f_' + f.key); if (!el) return;
    el.addEventListener('change', () => { wizard.config[f.key] = f.type === 'bool' ? el.checked : el.value; });
  });
  // More tanks share the same AP pool, so gently suggest a bigger grant.
  const apHint = () => {
    const h = document.getElementById('apHint'); if (!h) return;
    const tanks = parseInt(wizard.config.tanksPerPlayer) || 1, ap = parseInt(wizard.config.apPerDay) || 1;
    h.hidden = !(tanks > 1 && ap < tanks * 2);
    h.textContent = `With ${tanks} tanks per player sharing one AP pool, ${ap} AP per grant may feel slow — consider raising it (around ${tanks * 2} or more).`;
  };
  ['tanksPerPlayer', 'apPerDay'].forEach(k => { const el = document.getElementById('f_' + k); if (el) el.addEventListener('input', () => { wizard.config[k] = el.value; apHint(); }); });
  apHint();
  document.getElementById('wizardVisibility').addEventListener('change', e => { wizard.visibility = e.target.value; });
  document.getElementById('wizardCreate').onclick = async e => {
    e.target.disabled = true;
    wizard.name = document.getElementById('wizardName').value.trim();
    const r = await api('/api/games', 'POST', { name: wizard.name, callsign: S.me.username, config: wizard.config, visibility: wizard.visibility });
    e.target.disabled = false;
    if (!r.ok) return toast(r.error, 'bad');
    wizard = { presetId: 'standard', name: '', config: {}, visibility: 'public' };
    S.pendingGame = { gameId: r.gameId };
    setView('setup');
  };
}
registerView('wizard', { render });
