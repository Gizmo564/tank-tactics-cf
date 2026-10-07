// Persistent SVG game board. Tanks are keyed <g> elements that glide between
// cells via CSS transitions, so a state push updates the board in place
// instead of rebuilding it (the old innerHTML approach made animation —
// and reliable clicking during updates — impossible).
import { tankMarkup, shade } from './tanks.js';
import { play } from './sfx.js';

const NS = 'http://www.w3.org/2000/svg';
const U = 64;                          // SVG units per cell
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const HEART = 'M32 52S12 40 6 28C2 19 8 9 18 9c6 0 11 3 14 8 3-5 8-8 14-8 10 0 16 10 12 19-6 12-26 24-26 24z';
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class Board {
  constructor(mount, { onCell, onTank } = {}) {
    this.mount = mount; this.onCell = onCell; this.onTank = onTank;
    this.tanks = new Map();            // playerId -> { g, x, y, angle, sig }
    this.pickups = new Map();          // "x,y" -> g
    this.w = 0; this.h = 0; this.zoom = 1; this.cellPx = 52; this.showNames = true;
    this.lastPos = new Map();
    this.ready = false;
  }

  build(w, h) {
    this.w = w; this.h = h;
    this.mount.innerHTML = '';
    const svg = this.svg = el('svg', { class: 'board-svg', viewBox: `0 0 ${w * U} ${h * U}`, role: 'img', 'aria-label': 'Game board' });
    this.gCells = el('g', { class: 'cells' }, svg);
    this.gRange = el('g', { class: 'range-layer' }, svg);
    this.gFog = el('g', { class: 'fog-layer' }, svg);
    this.gPickups = el('g', { class: 'pickup-layer' }, svg);
    this.gTanks = el('g', { class: 'tank-layer' }, svg);
    this.gFx = el('g', { class: 'fx-layer' }, svg);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      el('rect', { class: 'cell' + ((x + y) % 2 ? ' alt' : ''), x: x * U, y: y * U, width: U, height: U, 'data-x': x, 'data-y': y }, this.gCells);
    }
    svg.addEventListener('click', e => {
      const t = e.target.closest('[data-tank]');
      if (t && this.onTank) return this.onTank(t.dataset.tank);
      const c = e.target.closest('rect.cell');
      if (c && this.onCell) this.onCell(+c.dataset.x, +c.dataset.y);
    });
    this.mount.appendChild(svg);
    this.tanks.clear(); this.pickups.clear(); this.lastPos.clear(); this.ready = false;
    this.applySize();
  }

  applySize() {
    if (!this.svg) return;
    this.svg.setAttribute('width', Math.round(this.w * this.cellPx * this.zoom));
    this.svg.setAttribute('height', Math.round(this.h * this.cellPx * this.zoom));
  }
  setZoom(z) { this.zoom = z; this.applySize(); }
  setNames(on) { this.showNames = on; this.svg && this.svg.classList.toggle('no-names', !on); }

  // st: game state from server; opts: { actionMode, me }
  update(st, opts = {}) {
    const cfg = st.config;
    if (cfg.gridWidth !== this.w || cfg.gridHeight !== this.h || !this.svg) this.build(cfg.gridWidth, cfg.gridHeight);
    this.svg.classList.toggle('no-names', !this.showNames);
    const me = st.players.find(p => p.isOwn);
    this.syncPickups(st);
    this.syncTanks(st);
    this.syncRange(st, me, opts.actionMode);
    this.syncFog(st, me);
    this.ready = true;
  }

  center(x, y) { return { x: x * U + U / 2, y: y * U + U / 2 }; }

  syncPickups(st) {
    const live = new Set(st.heartPickups.map(h => `${h.x},${h.y}`));
    for (const [k, g] of this.pickups) if (!live.has(k)) {
      const [x, y] = k.split(',').map(Number);
      const taken = st.players.some(p => p.x === x && p.y === y);
      if (taken) this.pop(x, y, 'pickup'); // someone drove onto it
      g.remove(); this.pickups.delete(k);
    }
    for (const h of st.heartPickups) {
      const k = `${h.x},${h.y}`; if (this.pickups.has(k)) continue;
      const g = el('g', { class: 'pickup', transform: `translate(${h.x * U} ${h.y * U})` }, this.gPickups);
      const inner = el('g', { class: 'pickup-bob' }, g);
      el('path', { d: HEART, class: 'pickup-heart', transform: 'translate(8 8) scale(.75)' }, inner);
      this.pickups.set(k, g);
    }
  }

  syncTanks(st) {
    const seen = new Set();
    for (const p of st.players) {
      if (p.x === null || p.y === null) continue;           // hidden by fog or not placed
      seen.add(p.id);
      let t = this.tanks.get(p.id);
      if (!t) {
        const g = el('g', { class: 'tank-g', 'data-tank': p.id }, this.gTanks);
        t = { g, x: p.x, y: p.y, angle: 0, sig: '', hearts: p.hearts };
        g.style.transform = `translate(${p.x * U}px, ${p.y * U}px)`;
        if (this.ready) { g.classList.add('spawn'); setTimeout(() => g.classList.remove('spawn'), 600); }
        this.tanks.set(p.id, t);
      }
      if (t.x !== p.x || t.y !== p.y) {                      // moved: face the direction of travel
        const dx = p.x - t.x, dy = p.y - t.y;
        t.angle = this.nearest(t.angle, Math.atan2(dx, -dy) * 180 / Math.PI);
        t.x = p.x; t.y = p.y;
        t.g.style.transform = `translate(${p.x * U}px, ${p.y * U}px)`;
      }
      const sig = [p.colorHex, p.isDead, p.isOwn, p.hearts, p.callsign, Math.round(t.angle), p.team].join('|');
      if (sig !== t.sig) { this.paintTank(t, p); t.sig = sig; }
      if (p.hearts < t.hearts && !p.isDead) this.pop(p.x, p.y, 'hit');
      t.hearts = p.hearts;
    }
    for (const [id, t] of this.tanks) if (!seen.has(id)) { t.g.remove(); this.tanks.delete(id); }
  }

  paintTank(t, p) {
    const name = (p.callsign || '').slice(0, 9);
    t.g.classList.toggle('dead', !!p.isDead);
    t.g.classList.toggle('own', !!p.isOwn);
    // The art's own centre is (30,30). It is drawn at 85% and centred on (32,37) so the heart pill fits above it.
    t.g.innerHTML = `
      <title>${esc(p.callsign)}${p.team ? ` (Team ${p.team})` : ''} — ${p.isDead ? 'down' : p.hearts + ' hearts'}</title>
      <g class="tank-inner">
        ${p.isOwn && !p.isDead ? '<circle class="own-ring" cx="32" cy="37" r="25"><animateTransform attributeName="transform" type="rotate" from="0 32 37" to="360 32 37" dur="9s" repeatCount="indefinite"/></circle>' : ''}
        <g transform="translate(32 37) scale(.85) translate(-30 -30)">${tankMarkup({ colorHex: p.colorHex, dead: p.isDead, angle: Math.round(t.angle), own: p.isOwn })}</g>
        ${p.team ? `<circle class="team-dot" cx="54" cy="20" r="5" fill="${TEAM_COLORS[(p.team - 1) % TEAM_COLORS.length]}"/>` : ''}
      </g>
      ${p.isDead ? '' : this.heartsMarkup(p.hearts)}
      <g class="name-tag"><rect x="${32 - name.length * 3.4 - 3}" y="52" width="${name.length * 6.8 + 6}" height="11" rx="5.5"/><text x="32" y="60.5" text-anchor="middle">${esc(name)}</text></g>`;
  }
  // Hearts sit in a pill above the tank: up to 4 hearts, then one heart and a count.
  heartsMarkup(n) {
    if (n <= 0) return '';
    const many = n > 4, shown = many ? 1 : n, step = 14, hw = 12.5;
    const w = many ? 38 : shown * step + 5, x0 = 32 - w / 2;
    let out = `<rect class="heart-pill" x="${x0}" y="0.75" width="${w}" height="15" rx="7.5"/>`;
    for (let i = 0; i < shown; i++) out += `<path class="pip" d="${HEART}" transform="translate(${x0 + 3 + i * step - 1} 2.4) scale(${hw / 60})"/>`;
    if (many) out += `<text class="pip-n" x="${x0 + 20}" y="12.5">${n}</text>`;
    return `<g class="pips">${out}</g>`;
  }
  // choose the equivalent angle closest to the current one so turrets take the short way round
  nearest(cur, target) { let d = ((target - cur) % 360 + 540) % 360 - 180; return cur + d; }

  syncRange(st, me, mode) {
    this.gRange.innerHTML = '';
    if (!me || me.x === null || !mode || !['shoot', 'gift-hearts', 'gift-ap'].includes(mode)) return;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (cheb(me, { x, y }) <= me.range) el('rect', { class: 'range-cell', x: x * U + 1, y: y * U + 1, width: U - 2, height: U - 2, rx: 6 }, this.gRange);
    }
  }
  syncFog(st, me) {
    this.gFog.innerHTML = '';
    if (!st.fogActive || !me || me.x === null) return;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (cheb(me, { x, y }) > me.range) el('rect', { class: 'fog-cell', x: x * U, y: y * U, width: U, height: U }, this.gFog);
    }
  }

  // ---------- effects ----------
  tankCenter(id) { const t = this.tanks.get(id); return t ? this.center(t.x, t.y) : null; }
  aim(id, toId) {
    const a = this.tanks.get(id), b = this.tanks.get(toId); if (!a || !b) return;
    a.angle = this.nearest(a.angle, Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI);
    const turret = a.g.querySelector('.turret');
    if (turret) turret.style.transform = `translate(30px, 30px) rotate(${Math.round(a.angle)}deg)`;
  }
  fx(fx) {
    if (!fx) return;
    if (fx.type === 'move') { play('move'); return; }
    if (fx.type === 'heal') { const c = this.tankCenter(fx.id); if (c) this.floater(c.x, c.y - 10, '+1', 'good'); play('heal'); return; }
    if (fx.type === 'hit' || fx.type === 'kill') {
      this.aim(fx.from, fx.to);
      const a = this.tankCenter(fx.from), b = this.tankCenter(fx.to);
      play('shoot'); setTimeout(() => play(fx.type === 'kill' ? 'kill' : 'hit'), 120);
      if (!a || !b || reduceMotion()) return;
      const line = el('line', { class: 'tracer', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, this.gFx);
      const mz = el('circle', { class: 'muzzle', cx: a.x, cy: a.y, r: 12 }, this.gFx); mz.style.transformOrigin = `${a.x}px ${a.y}px`; mz.addEventListener('animationend', () => mz.remove());
      line.addEventListener('animationend', () => line.remove());
      setTimeout(() => {
        if (fx.type === 'kill') this.explosion(b.x, b.y); else this.burst(b.x, b.y);
        this.floater(b.x, b.y - 14, fx.type === 'kill' ? '✕' : '−1', 'bad');
        const t = this.tanks.get(fx.to); if (t) { t.g.classList.remove('shake'); void t.g.getBoundingClientRect(); t.g.classList.add('shake'); }
      }, 140);
    }
  }
  burst(x, y) {
    const c = el('circle', { class: 'burst', cx: x, cy: y, r: 8 }, this.gFx); c.style.transformOrigin = `${x}px ${y}px`; c.addEventListener('animationend', () => c.remove());
    for (let i = 0; i < 6; i++) {
      const s = el('circle', { class: 'spark', cx: x, cy: y, r: 3 }, this.gFx);
      const a = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      s.style.setProperty('--dx', `${Math.cos(a) * 26}px`); s.style.setProperty('--dy', `${Math.sin(a) * 26}px`);
      s.addEventListener('animationend', () => s.remove());
    }
  }
  explosion(x, y) {
    for (let i = 0; i < 3; i++) {
      const c = el('circle', { class: 'ring', cx: x, cy: y, r: 10 }, this.gFx);
      c.style.transformOrigin = `${x}px ${y}px`; c.style.animationDelay = `${i * 90}ms`; c.addEventListener('animationend', () => c.remove());
    }
    this.burst(x, y);
  }
  floater(x, y, text, kind) {
    if (reduceMotion()) return;
    const t = el('text', { class: 'floater ' + kind, x, y, 'text-anchor': 'middle' }, this.gFx);
    t.textContent = text; t.addEventListener('animationend', () => t.remove());
  }
  pop(x, y, kind) {
    if (reduceMotion()) return;
    const c = this.center(x, y);
    if (kind === 'pickup') { this.floater(c.x, c.y - 10, '+♥', 'good'); play('heart'); }
  }
}

const TEAM_COLORS = ['#3f7fc1', '#e85d5d', '#4fa05c', '#e0a233', '#8b6bc7', '#2f9e8f'];
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
