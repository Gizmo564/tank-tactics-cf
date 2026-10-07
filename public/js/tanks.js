// Tank art (style "A — Toy Block"): chunky ink outline, offset shadow, fat
// barrel. Colors come from the player's hex; outline/shadow use theme CSS
// variables so tanks look right in every theme.

function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
export function shade(hex, amt) {            // amt in -1..1 (negative = darker)
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || '#888';
  const n = parseInt(m[1], 16);
  const f = c => clamp(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join('');
}

// Inner SVG markup for one 64x64 tank cell. `angle` rotates the turret (0 = up).
export function tankMarkup({ colorHex, dead = false, angle = 0, own = false }) {
  const body = dead ? '#cdbfa3' : colorHex;
  const dark = dead ? '#a89a7c' : shade(colorHex, -0.28);
  const cap = dead ? '#e3d8c0' : shade(colorHex, 0.5);
  return `
    <rect class="t-shadow" x="14" y="16" width="38" height="38" rx="9"/>
    <rect class="t-body" x="11" y="11" width="38" height="38" rx="9" fill="${body}"/>
    <rect class="t-tread" x="8" y="14" width="7" height="32" rx="3" fill="${dark}"/>
    <rect class="t-tread" x="45" y="14" width="7" height="32" rx="3" fill="${dark}"/>
    <g class="turret" style="transform: translate(30px, 30px) rotate(${angle}deg)">
      <rect class="t-barrel" x="-4.5" y="-24" width="9" height="20" rx="3" fill="${dark}"/>
      <circle class="t-cap" r="9.5" fill="${cap}"/>
      <circle class="t-eye" r="3" fill="${body}"/>
    </g>
    ${dead ? '<path class="t-x" d="M18 18l24 24M42 18L18 42"/>' : ''}`;
}

// Standalone <svg> for previews (setup screen, auth hero, icons).
export function tankSvg(colorHex, size = 64, angle = 0) {
  return `<svg class="tank-art" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${tankMarkup({ colorHex, angle })}</svg>`;
}

// Small icon version: the tank's body is centred at (30,30) in its 64x64 cell,
// so shift the viewBox to put that point in the middle of the box.
export function tankIcon(colorHex, size = 24) {
  return `<svg class="tank-art" width="${size}" height="${size}" viewBox="-2 -2 64 64" aria-hidden="true">${tankMarkup({ colorHex })}</svg>`;
}
