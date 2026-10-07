// Audio: background music playlist + sound effects.
// Music and custom effects are OPTIONAL files the owner drops into public/audio/ and lists in
// public/audio/audio.json. Any effect without a file falls back to a small built-in synth sound.
// Everything is off by default (browsers block autoplay anyway) and remembered per browser.
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d; };
let sfxOn = LS.get('tt_sound', '1') === '1', sfxVol = num(LS.get('tt_sfx_vol'), 0.8);
let musicOn = LS.get('tt_music', '1') === '1', musicVol = num(LS.get('tt_music_vol'), 0.5);
let ctx = null, master = null, tracks = [], idx = 0, el = null, cfgPromise = null;
const raw = {}, buf = {}, listeners = new Set();
const apath = f => '/audio/' + String(f).split('/').filter(p => p && p !== '..').map(encodeURIComponent).join('/');

export const onAudioChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch { /* ui gone */ } });
export const soundOn = () => sfxOn;
export const sfxInfo = () => ({ on: sfxOn, vol: sfxVol, custom: Object.keys(raw).length });
export const musicInfo = () => ({ on: musicOn, vol: musicVol, tracks: tracks.length, playing: !!el && !el.paused, name: tracks[idx] || '' });

// ---------- config ----------
export function loadAudioConfig() {
  if (cfgPromise) return cfgPromise;
  cfgPromise = (async () => {
    try {
      const r = await fetch('/audio/audio.json', { cache: 'no-cache' });
      // Unknown paths fall back to index.html on this site, so check it really is JSON.
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return;
      const c = await r.json();
      tracks = (Array.isArray(c.music) ? c.music : []).filter(s => typeof s === 'string' && s);
      await Promise.all(Object.entries(c.sfx || {}).map(async ([name, file]) => {
        try {
          const f = await fetch(apath(file));
          if (f.ok && /audio|ogg|octet/.test(f.headers.get('content-type') || '')) raw[name] = await f.arrayBuffer();
        } catch { /* missing file: built-in sound is used */ }
      }));
    } catch { /* no config: built-in sounds only, no music */ }
    emit();
  })();
  return cfgPromise;
}

// ---------- sound effects ----------
function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    master = ctx.createGain(); master.gain.value = sfxVol; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
async function decodeAll() {
  const a = ac(); if (!a) return;
  for (const k of Object.keys(raw)) {
    if (buf[k]) continue;
    try { buf[k] = await a.decodeAudioData(raw[k].slice(0)); } catch { delete raw[k]; }
  }
  emit();
}
function tone(freq, dur, type = 'square', vol = 0.06, slideTo = null, delay = 0) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.08, delay = 0) {
  const a = ac(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(), g = a.createGain();
  s.buffer = b; g.gain.value = vol; s.connect(g).connect(master); s.start(a.currentTime + delay);
}
const SOUNDS = {
  blip: () => tone(660, 0.08, 'triangle'),
  move: () => tone(180, 0.06, 'triangle', 0.04, 140),
  shoot: () => { tone(520, 0.14, 'sawtooth', 0.05, 120); noise(0.08, 0.05); },
  hit: () => { noise(0.18, 0.09); tone(140, 0.18, 'square', 0.05, 70); },
  kill: () => { noise(0.45, 0.12); tone(110, 0.5, 'sawtooth', 0.07, 40); tone(70, 0.6, 'square', 0.05, 30, 0.1); },
  heal: () => { tone(523, 0.1, 'triangle'); tone(784, 0.14, 'triangle', 0.06, null, 0.09); },
  heart: () => { tone(659, 0.09, 'triangle'); tone(988, 0.16, 'triangle', 0.06, null, 0.08); },
  victory: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.06, null, i * 0.14))
};
export function play(name) {
  if (!sfxOn) return;
  try {
    if (buf[name]) { const a = ac(), s = a.createBufferSource(); s.buffer = buf[name]; s.connect(master); s.start(); return; }
    if (raw[name]) { decodeAll().then(() => buf[name] && play(name)); return; }
    if (SOUNDS[name]) SOUNDS[name]();
  } catch { /* audio blocked */ }
}
export function setSound(v) {
  sfxOn = !!v; LS.set('tt_sound', sfxOn ? '1' : '0');
  if (sfxOn) { loadAudioConfig().then(decodeAll); play('blip'); }
  emit();
}
export function setSfxVolume(v) { sfxVol = num(v, 0.8); LS.set('tt_sfx_vol', String(sfxVol)); if (master) master.gain.value = sfxVol; }

// ---------- music ----------
function loadTrack() { el.src = apath(tracks[idx]); el.loop = tracks.length === 1; emit(); }
function ensureEl() {
  if (el) return el;
  el = new Audio(); el.preload = 'auto'; el.volume = musicVol;
  el.addEventListener('ended', () => { idx = (idx + 1) % tracks.length; loadTrack(); el.play().catch(() => {}); });
  el.addEventListener('play', emit); el.addEventListener('pause', emit);
  el.addEventListener('error', () => { /* bad file: skip to the next one, but never loop forever */
    if (tracks.length > 1 && ++errorStreak < tracks.length) { idx = (idx + 1) % tracks.length; loadTrack(); el.play().catch(() => {}); }
  });
  el.addEventListener('playing', () => { errorStreak = 0; });
  return el;
}
let errorStreak = 0;
export async function setMusic(v) {
  musicOn = !!v; LS.set('tt_music', musicOn ? '1' : '0');
  if (!musicOn) { if (el) el.pause(); return emit(); }
  await loadAudioConfig();
  if (!tracks.length) return emit();
  ensureEl();
  if (!el.src) { idx = Math.floor(Math.random() * tracks.length); loadTrack(); }
  try { await el.play(); } catch { /* blocked until the next click; initAudio retries on first gesture */ }
  emit();
}
export function setMusicVolume(v) { musicVol = num(v, 0.5); LS.set('tt_music_vol', String(musicVol)); if (el) el.volume = musicVol; }
export function skipTrack() { if (!el || tracks.length < 2) return; idx = (idx + 1) % tracks.length; loadTrack(); el.play().catch(() => {}); }

// Call once at startup. Restores "music on" after a reload as soon as the browser allows audio (first click/tap).
export function initAudio() {
  loadAudioConfig().then(() => { if (musicOn) setMusic(true); if (sfxOn) decodeAll(); });
  const first = () => { if (musicOn && (!el || el.paused)) setMusic(true); if (sfxOn) { ac(); decodeAll(); } };
  document.addEventListener('pointerdown', first, { once: true, capture: true });
  document.addEventListener('keydown', first, { once: true, capture: true });
}
