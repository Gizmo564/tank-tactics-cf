// Hand-drawn line-icon set. No emoji and no icon font: every glyph is inline
// SVG so it renders identically everywhere.
function wrap(inner, size) {
  return `<svg class="icon" width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
export const ICONS = {
  target: s => wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/>', s),
  tank: s => wrap('<rect x="4" y="12" width="16" height="6" rx="1.5"/><rect x="8" y="7" width="8" height="6" rx="1"/><line x1="16" y1="9" x2="21" y2="9"/><circle cx="8" cy="19" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/><circle cx="16" cy="19" r="1.4" fill="currentColor"/>', s),
  heart: s => wrap('<path d="M12 20s-7-4.35-9.5-9C.8 7.2 3 3.5 6.7 3.5c2 0 3.4 1.1 4.3 2.5.9-1.4 2.3-2.5 4.3-2.5C19 3.5 21.2 7.2 21.5 11c-2.5 4.65-9.5 9-9.5 9z" fill="currentColor" stroke="none"/>', s),
  heartOutline: s => wrap('<path d="M12 20s-7-4.35-9.5-9C.8 7.2 3 3.5 6.7 3.5c2 0 3.4 1.1 4.3 2.5.9-1.4 2.3-2.5 4.3-2.5C19 3.5 21.2 7.2 21.5 11c-2.5 4.65-9.5 9-9.5 9z"/>', s),
  bolt: s => wrap('<polygon points="13 2 4 14 11 14 10 22 20 9 13 9" fill="currentColor" stroke="none"/>', s),
  wrench: s => wrap('<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-3-3z"/><circle cx="6.5" cy="17.5" r="0.6" fill="currentColor"/>', s),
  radar: s => wrap('<circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M9 12a3 3 0 0 1 3-3"/><path d="M6.5 12a5.5 5.5 0 0 1 5.5-5.5"/><path d="M4 12a8 8 0 0 1 8-8"/>', s),
  scale: s => wrap('<line x1="12" y1="3" x2="12" y2="20"/><line x1="5" y1="7" x2="19" y2="7"/><path d="M5 7l-2.5 5a2.5 2.5 0 0 0 5 0z"/><path d="M19 7l-2.5 5a2.5 2.5 0 0 0 5 0z"/><line x1="8" y1="21" x2="16" y2="21"/>', s),
  sun: s => wrap('<circle cx="12" cy="12" r="4"/><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="4.2" y1="4.2" x2="6" y2="6"/><line x1="18" y1="18" x2="19.8" y2="19.8"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.2" y1="19.8" x2="6" y2="18"/><line x1="18" y1="6" x2="19.8" y2="4.2"/>', s),
  plus: s => wrap('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', s),
  flag: s => wrap('<line x1="5" y1="3" x2="5" y2="21"/><path d="M5 4h13l-3.5 4L18 12H5"/>', s),
  userX: s => wrap('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><line x1="16" y1="8" x2="21" y2="13"/><line x1="21" y1="8" x2="16" y2="13"/>', s),
  ban: s => wrap('<circle cx="12" cy="12" r="8.5"/><line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/>', s),
  close: s => wrap('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>', s),
  refresh: s => wrap('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><polyline points="20 3 20 8 15 8"/>', s),
  check: s => wrap('<polyline points="4 12.5 9.5 18 20 6"/>', s),
  chevron: (dir, s) => {
    const rot = { up: 0, right: 90, down: 180, left: 270, upright: 45, downright: 135, downleft: 225, upleft: 315 }[dir] || 0;
    return wrap(`<g transform="rotate(${rot} 12 12)"><polyline points="7 14 12 8 17 14"/></g>`, s);
  },
  shield: s => wrap('<path d="M12 3l7 3v6c0 4.8-3 8.2-7 9-4-.8-7-4.2-7-9V6z"/>', s),
  chat: s => wrap('<path d="M4 5h16v11H8l-4 4z"/>', s),
  eye: s => wrap('<path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>', s),
  dot: s => wrap('<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>', s),
  list: s => wrap('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>', s),
  sliders: s => wrap('<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/>', s),
  palette: s => wrap('<path d="M12 3a9 8 0 1 0 0 16c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.3-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a4 4 0 0 0 4-4c0-4.4-3.6-6.1-8-6.1z"/><circle cx="7.2" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.8" cy="7.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.8" cy="11" r="1.1" fill="currentColor" stroke="none"/>', s),
  clock: s => wrap('<circle cx="12" cy="12" r="8.5"/><polyline points="12 7 12 12 16 14.5"/>', s),
  bell: s => wrap('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>', s),
  volume: s => wrap('<polygon points="4 9 8 9 13 5 13 19 8 15 4 15" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>', s),
  volumeOff: s => wrap('<polygon points="4 9 8 9 13 5 13 19 8 15 4 15" fill="currentColor"/><line x1="17" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="17" y2="15"/>', s),
  play: s => wrap('<polygon points="7 4 20 12 7 20" fill="currentColor"/>', s),
  pause: s => wrap('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>', s),
  skipBack: s => wrap('<polygon points="19 5 9 12 19 19" fill="currentColor"/><line x1="6" y1="5" x2="6" y2="19"/>', s),
  skipForward: s => wrap('<polygon points="5 5 15 12 5 19" fill="currentColor"/><line x1="18" y1="5" x2="18" y2="19"/>', s),
  users: s => wrap('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>', s),
  download: s => wrap('<path d="M12 4v11"/><polyline points="7 11 12 16 17 11"/><line x1="5" y1="20" x2="19" y2="20"/>', s),
  expand: s => wrap('<polyline points="4 9 4 4 9 4"/><polyline points="20 9 20 4 15 4"/><polyline points="4 15 4 20 9 20"/><polyline points="20 15 20 20 15 20"/>', s),
  tag: s => wrap('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>', s)
};
