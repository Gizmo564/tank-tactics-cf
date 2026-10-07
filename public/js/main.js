import { S, api, setView, applyTheme, savedTheme } from './core.js';
import { setupSettings } from './settings.js';
import { initAudio } from './sfx.js';
import './views/auth.js'; import './views/lobby.js'; import './views/wizard.js'; import './views/setup.js';
import './views/waiting.js'; import './views/game.js'; import './views/admin.js';

applyTheme(savedTheme());
setupSettings();
initAudio();
(async function boot() {
  const r = await api('/api/auth/me');
  if (!r.ok || !r.loggedIn) return setView('auth');
  if (r.isSuperAdmin) { S.me = { isSuperAdmin: true, username: r.username }; return setView('admin-dashboard'); }
  S.me = { userId: r.userId, username: r.username };
  // shareable spectate link: https://host/#game/<id>
  const m = /^#game\/([\w-]+)$/.exec(location.hash);
  if (m) { S.currentGameId = m[1]; return setView('game'); }
  setView('lobby');
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
