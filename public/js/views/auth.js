import { $app, S, api, esc, setView, registerView } from '../core.js';
import { ICONS } from '../icons.js';
import { tankSvg } from '../tanks.js';
import { returnLinkHtml } from '../return-link.js';

let signinUrl = 'https://0801564.xyz/signin', legacyPlayers = true;
async function render() {
  const cfg = await api('/api/auth/config');
  if (cfg && cfg.ok) { signinUrl = cfg.signinUrl; legacyPlayers = !!cfg.legacyPlayerLogin; }
  $app.innerHTML = `
    <div class="auth-wrap">
      ${returnLinkHtml('center')}
      <div class="hero-tanks" aria-hidden="true">${tankSvg('#2f9e8f', 64, 35)}${tankSvg('#ff6b5e', 80, 0)}${tankSvg('#e8a83c', 64, -35)}</div>
      <h1 style="font-size:30px;">Tank Tactics Arena</h1>
      <p class="small-muted" style="margin:8px 0 20px;">Grab a callsign, create or join a match, and start blasting.</p>
      <div class="card" style="text-align:left;">
        <a class="btn primary block" id="ssoBtn" href="#">Sign in with 0801564.xyz</a>
        <p class="small-muted" style="margin:10px 0 0;">One account for every game on 0801564.xyz. New here? You can create one on that page too.</p>
      </div>
      <details class="card" id="legacyBox"${legacyPlayers ? '' : ' hidden'} style="text-align:left;margin-top:12px;">
        <summary class="small-muted" style="cursor:pointer;">Admin sign-in${legacyPlayers ? ' / old Tank Tactics login' : ''}</summary>
        <p style="margin:10px 0 0;"><a href="https://0801564.xyz/api/admin/handoff?to=tanks">Admin? Continue from the 0801564.xyz admin</a></p>
        <form id="authForm" novalidate style="margin-top:10px;">
          <div id="authError" aria-live="polite"></div>
          <div class="field"><label for="authUser">Callsign</label><input id="authUser" maxlength="20" autocomplete="username" autocapitalize="none"/></div>
          <div class="field"><label for="authPass">Password</label><input id="authPass" type="password" autocomplete="current-password"/></div>
          <button class="btn block" id="authSubmit" type="submit">Log In</button>
        </form>
      </details>
    </div>`;
  document.getElementById('ssoBtn').href = signinUrl + '?return=' + encodeURIComponent(location.origin + '/');
  document.getElementById('authForm').onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById('authSubmit');
    const username = document.getElementById('authUser').value.trim();
    const password = document.getElementById('authPass').value;
    btn.disabled = true;
    const r = await api('/api/auth/login', 'POST', { username, password });
    btn.disabled = false;
    if (!r.ok) { document.getElementById('authError').innerHTML = `<div class="error-msg">${esc(r.error)}</div>`; return; }
    if (r.isSuperAdmin) { S.me = { isSuperAdmin: true, username: r.username }; return setView('admin-dashboard'); }
    S.me = { userId: r.userId, username: r.username };
    setView('lobby');
  };
}
registerView('auth', { render });
