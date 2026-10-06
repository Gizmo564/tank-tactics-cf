import { $app, S, api, esc, setView, registerView } from '../core.js';
import { ICONS } from '../icons.js';
import { tankSvg } from '../tanks.js';

let mode = 'login';
function render() {
  $app.innerHTML = `
    <div class="auth-wrap">
      <div class="hero-tanks" aria-hidden="true">${tankSvg('#2f9e8f', 64, 35)}${tankSvg('#ff6b5e', 80, 0)}${tankSvg('#e8a83c', 64, -35)}</div>
      <h1 style="font-size:30px;">Tank Tactics Arena</h1>
      <p class="small-muted" style="margin:8px 0 20px;">Grab a callsign, create or join a match, and start blasting.</p>
      <form class="card" id="authForm" style="text-align:left;" novalidate>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" id="tabLogin" class="${mode === 'login' ? 'active' : ''}">Log In</button>
          <button type="button" role="tab" id="tabRegister" class="${mode === 'register' ? 'active' : ''}">Sign Up</button>
        </div>
        <div id="authError" aria-live="polite"></div>
        <div class="field"><label for="authUser">Callsign</label><input id="authUser" maxlength="20" placeholder="e.g. RustyBolt" autocomplete="username" autocapitalize="none"/></div>
        <div class="field"><label for="authPass">Password</label><input id="authPass" type="password" placeholder="••••••••" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"/></div>
        <button class="btn primary block" id="authSubmit" type="submit">${mode === 'login' ? 'Log In' : 'Create Account'}</button>
      </form>
      <p class="hint">Your account works across every game on this server.</p>
    </div>`;
  document.getElementById('tabLogin').onclick = () => { mode = 'login'; render(); };
  document.getElementById('tabRegister').onclick = () => { mode = 'register'; render(); };
  document.getElementById('authForm').onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById('authSubmit');
    const username = document.getElementById('authUser').value.trim();
    const password = document.getElementById('authPass').value;
    btn.disabled = true;
    const r = await api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', 'POST', { username, password });
    btn.disabled = false;
    if (!r.ok) { document.getElementById('authError').innerHTML = `<div class="error-msg">${esc(r.error)}</div>`; return; }
    if (r.isSuperAdmin) { S.me = { isSuperAdmin: true, username: r.username }; return setView('admin-dashboard'); }
    S.me = { userId: r.userId, username: r.username };
    setView('lobby');
  };
  document.getElementById('authUser').focus();
}
registerView('auth', { render });
