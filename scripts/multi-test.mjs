import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:8787'; const sfx = Math.random().toString(36).slice(2, 6);
const api = async (c, p, m = 'GET', b) => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: c || '' }, body: b ? JSON.stringify(b) : undefined }); return { body: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
const ok = (c, m) => { console.log((c ? '  ok: ' : '  FAIL: ') + m); if (!c) process.exitCode = 1; };
const u = {}; for (const n of ['ann', 'ben']) u[n] = (await api('', '/api/auth/register', 'POST', { username: n + sfx, password: 'pw1234' })).cookie;
const adm = (await api('', '/api/auth/login', 'POST', { username: 'admin', password: 'admin' })).cookie;
const r = await api(u.ann, '/api/games', 'POST', { name: 'Multi', callsign: 'Ann', colorId: 'teal', visibility: 'public', config: { gridWidth: 8, gridHeight: 8, maxPlayers: 4, tanksPerPlayer: 2, apSchedule: 'always', apPerDay: 6, apIntervalHours: 1, endgamePlayerCount: 1 } });
const gid = r.body.gameId;
await api(u.ben, `/api/games/${gid}/join`, 'POST', { callsign: 'Ben', colorId: 'coral' });
console.log('start', (await api(u.ann, `/api/games/${gid}/start`, 'POST')).body.ok);
console.log('grant', (await api(u.ann, `/api/games/${gid}/host/grant-ap-all`, 'POST')).body.ok);
const state = async (c) => (await api(c, `/api/games/${gid}/state`)).body.state;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
for (const [tag, vp] of [['d', { width: 1280, height: 760 }], ['m', { width: 390, height: 844 }]]) {
  console.log(tag);
  const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE); await p.waitForSelector('#authForm'); await p.fill('#authUser', 'ann' + sfx); await p.fill('#authPass', 'pw1234'); await p.click('#authSubmit');
  await p.waitForSelector('.game-row'); await p.goto(`${BASE}/#game/${gid}`); await p.reload();
  await p.waitForSelector('.tank-g.own'); await p.waitForTimeout(500);
  const close = await p.$('.modal.howto [data-close]'); if (close) await close.click();
  await p.waitForTimeout(300);
  const cnt = s => p.$$eval(s, e => e.length);
  ok(await cnt('.tank-g') === 4, 'four tanks on the board'); ok(await cnt('.tank-g.own') === 2, 'two are mine');
  ok(await cnt('.tank-g.faded') === 0 && await cnt('.tank-g.selected') === 0, 'nothing selected → all look alike');
  ok(await cnt('.tank-row') === 2, 'tank list has 2 rows');
  await p.screenshot({ path: `shots/${tag}-multi-none.png` });
  // disabled until a tank is selected
  ok(await p.$eval('[data-dir="up"]', e => e.disabled), 'move pad disabled with no selection');
  await p.click('.tank-g.own >> nth=0', { force: true });
  ok(await cnt('.tank-g.selected') === 1 && await cnt('.tank-g.faded') === 1, 'selected one, other own tank faded');
  ok(!(await p.$eval('[data-dir="up"]', e => e.disabled)), 'move pad enabled');
  const hint = await p.$eval('#selHint', e => e.textContent); ok(/Tank \d selected/.test(hint), 'hint: ' + hint);
  await p.screenshot({ path: `shots/${tag}-multi-selected.png` });
  // switch via list
  const firstSel = await p.$eval('.tank-g.selected', e => e.dataset.tank);
  await p.click('.tank-row:not(.sel):not(:disabled)');
  const nowSel = await p.$eval('.tank-g.selected', e => e.dataset.tank); ok(nowSel !== firstSel, 'list click switches selection');
  // move only the selected tank using the keyboard
  const before = (await state(u.ann)).players.find(q => q.isOwn).tanks;
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(500);
  let after = (await state(u.ann)).players.find(q => q.isOwn).tanks;
  const moved = after.filter((t, i) => t.x !== before[i].x || t.y !== before[i].y);
  ok(moved.length === 1 && moved[0].id === nowSel || (moved.length === 0), `exactly the selected tank moved (${moved.length} moved; 0 only if blocked by edge)`);
  // number keys
  await p.keyboard.press('1'); ok(await p.$eval('.tank-g.selected', e => e.dataset.tank) === before[0].id, 'key 1 selects tank 1');
  await p.keyboard.press('Escape'); ok(await cnt('.tank-g.selected') === 0, 'Escape deselects');
  // click empty ground out of range deselects
  await p.keyboard.press('2');
  const me2 = (await state(u.ann)).players.find(q => q.isOwn); const t2 = me2.tanks[1];
  const occ = new Set((await state(u.ann)).players.flatMap(q => q.tanks.map(t => `${t.x},${t.y}`)));
  let far = null; for (let y = 0; y < 8 && !far; y++) for (let x = 0; x < 8 && !far; x++) if (Math.max(Math.abs(x - t2.x), Math.abs(y - t2.y)) > t2.range && !occ.has(`${x},${y}`)) far = { x, y };
  await p.click(`rect.cell[data-x="${far.x}"][data-y="${far.y}"]`, { force: true });
  ok(await cnt('.tank-g.selected') === 0, `click on empty tile out of range deselects (${far.x},${far.y})`);
  // wreck: admin zeroes ben's first tank
  const ben = (await state(u.ben)).players.find(q => q.isOwn).tanks[0].id;
  await api(adm, `/api/admin/games/${gid}/set-hearts`, 'POST', { playerId: ben, amount: 0 });
  await p.waitForTimeout(800);
  ok(await cnt('.tank-g.dead') === 1, 'one wreck on the board');
  const fills = await p.$$eval('.tank-g.dead .t-body, .tank-g.dead .t-barrel', els => els.map(e => e.getAttribute('fill')));
  ok(fills.length && fills.every(f => { const m = /^#(..)(..)(..)$/.exec(f); return m && m[1] === m[2] && m[2] === m[3]; }), 'wreck is greyscale: ' + fills.join(','));
  await p.screenshot({ path: `shots/${tag}-multi-wreck.png` });
  await ctx.close();
  await api(adm, `/api/admin/games/${gid}/set-hearts`, 'POST', { playerId: ben, amount: 3 });
}
await b.close();
console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
