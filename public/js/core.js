// Shared client plumbing: app state, API helper, toasts, escaping, countdowns,
// themes, the view router, and the live game socket (with reconnect).
import { ICONS } from './icons.js';

export const $app = document.getElementById('app');
const $toasts = document.getElementById('toastWrap');

export const S = {
  me: null,                 // { userId, username } | { isSuperAdmin, username }
  view: 'loading',
  colors: [], presets: [], presetFields: [],
  pendingGame: { gameId: null },
  currentGameId: null,
  adminGameId: null
};

// ---------- helpers ----------
export async function api(path, method = 'GET', body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(path, opts); } catch { return { ok: false, error: 'Network error — check your connection' }; }
  const data = await r.json().catch(() => ({ ok: false, error: `Server error (${r.status})` }));
  if (data && data.napping) showNap(data.resetAt);
  if (r.status === 401 && S.me) { S.me = null; toast('Your session ended — please log in again', 'bad'); setView('auth'); }
  return data;
}
// Nap Guard: a banner while the free daily server limit is used up (everything resumes at the reset)
export function showNap(resetAt) {
  let el = document.getElementById('napBanner');
  if (!el) {
    el = document.createElement('div'); el.id = 'napBanner'; el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 14px;text-align:center;font-weight:700;background:#ffe1d9;color:#2b2620;border-bottom:3px solid #2b2620';
    document.body.appendChild(el);
  }
  const t = resetAt ? new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'the daily reset';
  el.textContent = `The games are napping (free daily server limit nearly used up). Your game is paused and safe; back around ${t}.`;
  clearTimeout(showNap.t); showNap.t = setTimeout(() => el.remove(), 90_000);
}
export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.setAttribute('role', 'status');
  el.textContent = msg;
  $toasts.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function colorHex(id) { const c = S.colors.find(c => c.id === id); return c ? c.hex : '#ccc'; }

export function logLine(entry, players) {
  const actor = entry.actorId && players ? players.find(p => p.id === entry.actorId) : null;
  const style = actor ? ` style="border-left-color:${actor.colorHex};"` : '';
  return `<div class="log-line ${entry.type}"${style}>${esc(entry.message)}</div>`;
}
export function heartRow(count) {
  let out = '';
  for (let i = 0; i < count; i++) out += ICONS.heart(14);
  if (!out) return `<span class="small-muted">${ICONS.heartOutline(14)} down</span>`;
  return `<span style="color:var(--bad); display:inline-flex; gap:1px;">${out}</span>`;
}

// ---------- AP countdown: markup anywhere, one interval keeps them current ----------
export function countdownMarkup(targetTs) {
  return `${ICONS.clock(12)} <span class="countdown" data-target="${targetTs || ''}">${formatCountdown(targetTs)}</span>`;
}
export function formatCountdown(targetTs) {
  if (!targetTs) return 'calculating…';
  const diff = targetTs - Date.now();
  if (diff <= 0) return 'any moment now';
  const t = Math.floor(diff / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
setInterval(() => document.querySelectorAll('.countdown[data-target]').forEach(el => { el.textContent = formatCountdown(parseInt(el.dataset.target, 10)); }), 1000);

// ---------- themes (button + panel are static markup in index.html) ----------
export const THEMES = [
  { id: 'sunrise', label: 'Sunrise', swatch: '#ff6b4a' }, { id: 'dusk', label: 'Dusk', swatch: '#ff7ab6' },
  { id: 'forest', label: 'Forest', swatch: '#3f8f4f' }, { id: 'ocean', label: 'Ocean', swatch: '#2596be' },
  { id: 'blush', label: 'Blush', swatch: '#e0507e' }
];
export const savedTheme = () => { try { return localStorage.getItem('tt_theme') || 'sunrise'; } catch { return 'sunrise'; } };
export function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem('tt_theme', id); } catch { /* private mode: just won't persist */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--cream').trim() || '#faf3e6');
}
// ---------- view router ----------
const views = {};
let current = null;
export function registerView(name, mod) { views[name] = mod; }
export function setView(view) {
  if (current && views[current] && views[current].leave) views[current].leave();
  S.view = view; current = view;
  render();
}
export function render() {
  const v = views[S.view];
  if (v) return v.render();
  $app.innerHTML = '<p style="text-align:center; margin-top:80px;">Loading…</p>';
}

// ---------- live game socket ----------
// Server pushes the full per-viewer state after every change, plus chat and
// effect events. Auto-reconnects with backoff; handlers.onStatus reports
// connected/disconnected so the UI can show a "Live" indicator and fall back
// to polling while the socket is down.
export function connectGameSocket(gameId, handlers) {
  let ws = null, closed = false, tries = 0, timer = null, pingTimer = null, napped = false;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const open = () => {
    if (closed) return;
    try { ws = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(gameId)}`); } catch { schedule(); return; }
    ws.onopen = () => {
      tries = 0; handlers.onStatus && handlers.onStatus(true);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { try { ws.send('ping'); } catch { /* closing */ } }, 25000);
    };
    ws.onmessage = ev => {
      if (ev.data === 'pong') return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'state') handlers.onState && handlers.onState(m);
      else if (m.type === 'fx') handlers.onFx && handlers.onFx(m.fx);
      else if (m.type === 'chat') handlers.onChat && handlers.onChat(m.message);
      else if (m.type === 'nap') { napped = true; showNap(m.resetAt); }
    };
    ws.onclose = () => { clearInterval(pingTimer); if (closed) return; handlers.onStatus && handlers.onStatus(false); schedule(); };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  };
  const schedule = () => { if (closed) return; clearTimeout(timer); timer = setTimeout(open, napped ? 60_000 : Math.min(10000, 500 * 2 ** tries++)); napped = false; };
  const onVisible = () => { if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) { tries = 0; clearTimeout(timer); open(); } };
  document.addEventListener('visibilitychange', onVisible);
  open();
  return { close() { closed = true; clearTimeout(timer); clearInterval(pingTimer); document.removeEventListener('visibilitychange', onVisible); try { ws && ws.close(); } catch { /* ignore */ } },
    get open() { return !!ws && ws.readyState === 1; } };
}
