// Drives the real UI in headless Chromium against a running server and saves screenshots.
// Usage: node scripts/ui-shots.mjs [baseUrl] [outDir]   (needs playwright-core + its chromium)
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://127.0.0.1:8787', OUT = process.argv[3] || './shots';
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
const sfx = Math.random().toString(36).slice(2, 6);
const api = async (cookie, path, method = 'GET', body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: body ? JSON.stringify(body) : undefined });
  return { body: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const users = {};
for (const n of ['ann', 'ben', 'cy', 'dee']) { const r = await api('', '/api/auth/register', 'POST', { username: n + sfx, password: 'pw1234' }); users[n] = r.cookie; }
let r = await api(users.ann, '/api/games', 'POST', { name: 'Shot Test', callsign: 'Ann', colorId: 'teal', visibility: 'public', config: { gridWidth: 10, gridHeight: 8, maxPlayers: 6, apSchedule: 'always', apIntervalHours: 1, endgamePlayerCount: 1, startingHearts: 3, startingRange: 3 } });
const gid = r.body.gameId, code = r.body.code;
await api(users.ben, `/api/games/${gid}/join`, 'POST', { callsign: 'Ben', colorId: 'coral' });
await api(users.cy, `/api/games/${gid}/join`, 'POST', { callsign: 'Cy', colorId: 'gold' });
await api(users.dee, `/api/games/${gid}/join`, 'POST', { callsign: 'Dee', colorId: 'purple' });

const browser = await chromium.launch();
const errors = [];
const mk = async (viewport) => { const ctx = await browser.newContext({ viewport }); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); p.on('pageerror', e => errors.push('pageerror: ' + e.message)); return p; };
const page = await mk({ width: 1280, height: 900 });
await page.goto(BASE); await page.waitForSelector('#authForm');
await page.screenshot({ path: `${OUT}/01-auth.png` });
await page.fill('#authUser', 'ann' + sfx); await page.fill('#authPass', 'pw1234'); await page.click('#authSubmit');
await page.waitForSelector('.game-row', { timeout: 8000 });
await page.screenshot({ path: `${OUT}/02-lobby.png` });
await page.click(`[data-enter-lobby="${gid}"]`); await page.waitForSelector('.code-pill');
await page.screenshot({ path: `${OUT}/03-waiting.png` });
await page.click('#startBtn');
await page.waitForSelector('.board-svg .tank-g', { timeout: 8000 });
await api(users.ann, `/api/games/${gid}/host/grant-ap-all`, 'POST');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04-game.png` });
// keyboard move + click-adjacent move
const before = await page.evaluate(() => document.querySelector('.tank-g.own')?.style.transform);
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
const after = await page.evaluate(() => document.querySelector('.tank-g.own')?.style.transform);
console.log('own transform', before, '->', after);
// shoot mode
await page.click('[data-mode="shoot"]'); await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/05-shoot-mode.png` });
const targets = await page.$$('[data-target]'); console.log('shoot targets', targets.length);
// chat
await page.fill('#chatInput', 'hello from ann'); await page.click('[data-chat="send"]'); await page.waitForTimeout(400);
console.log('chat msgs', await page.$$eval('#chatFeed .chat-msg', e => e.length));
await page.screenshot({ path: `${OUT}/06-after.png`, fullPage: true });
// mobile
const m = await mk({ width: 390, height: 844 });
await m.goto(BASE); await m.waitForSelector('#authForm');
await m.fill('#authUser', 'ben' + sfx); await m.fill('#authPass', 'pw1234'); await m.click('#authSubmit');
await m.waitForSelector('.game-row'); await m.click(`[data-watch="${gid}"]`);
await m.waitForSelector('.board-svg .tank-g'); await m.waitForTimeout(500);
await m.screenshot({ path: `${OUT}/07-mobile.png`, fullPage: true });
await browser.close();
console.log('errors:', errors.length ? errors : 'none');
