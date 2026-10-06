// Tiny synthesized sound effects (WebAudio, no files). Off by default;
// the choice is remembered per browser.
let ctx = null;
let on = false;
try { on = localStorage.getItem('tt_sound') === '1'; } catch { /* ignore */ }

export const soundOn = () => on;
export function setSound(v) {
  on = !!v;
  try { localStorage.setItem('tt_sound', on ? '1' : '0'); } catch { /* ignore */ }
  if (on) play('blip');
}
function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, dur, type = 'square', vol = 0.06, slideTo = null, delay = 0) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.08, delay = 0) {
  const a = ac(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(), g = a.createGain();
  s.buffer = buf; g.gain.value = vol; s.connect(g).connect(a.destination); s.start(a.currentTime + delay);
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
export function play(name) { if (on && SOUNDS[name]) { try { SOUNDS[name](); } catch { /* audio blocked */ } } }
