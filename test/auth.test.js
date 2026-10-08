import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signSession, verifySession, validateRegistration, signService, clearSsoCookie } from '../src/auth.js';
import { RateLimiter } from '../src/ratelimit.js';

test('password hash verifies, rejects wrong password, salts differ', async () => {
  const h1 = await hashPassword('hunter2'), h2 = await hashPassword('hunter2');
  assert.notEqual(h1, h2);
  assert.ok(await verifyPassword('hunter2', h1));
  assert.ok(!(await verifyPassword('hunter3', h1)));
  assert.ok(!(await verifyPassword('x', 'garbage')));
});
test('session tokens: valid, tampered, wrong secret, expired', async () => {
  const t = await signSession({ sub: 'u1', name: 'a' }, 's3cret', 1000);
  assert.equal((await verifySession(t, 's3cret', 2000)).sub, 'u1');
  const [b, s] = t.split('.');
  assert.equal(await verifySession(b + 'A.' + s, 's3cret', 2000), null);
  assert.equal(await verifySession(t, 'other', 2000), null);
  assert.equal(await verifySession(t, 's3cret', 1000 + 31 * 24 * 3600 * 1000), null);
  assert.equal(await verifySession(null, 's3cret'), null);
});
test('registration validation', () => {
  assert.match(validateRegistration('a', 'pass'), /2-20/);
  assert.match(validateRegistration('bad!name', 'pass'), /letters/);
  assert.match(validateRegistration('ok', 'abc'), /4 characters/);
  assert.equal(validateRegistration('ok name', 'abcd'), null);
});
test('rate limiter window', () => {
  const r = new RateLimiter();
  for (let i = 0; i < 3; i++) assert.ok(r.allow('k', 3, 1000, 100));
  assert.ok(!r.allow('k', 3, 1000, 200)); assert.ok(r.allow('k', 3, 1000, 1200));
});
test('shared sign-in cookie: clears across the domain, service signature matches the landing format', async () => {
  assert.match(clearSsoCookie('https://tanks.0801564.xyz/api/auth/logout'), /^ov_sess=; .*Domain=\.0801564\.xyz.*Secure/);
  assert.ok(!/Domain=/.test(clearSsoCookie('http://localhost:8787/x')));
  const a = await signService('k', '1', 'body'), b = await signService('k', '1', 'body');
  assert.equal(a, b); assert.notEqual(a, await signService('k', '1', 'body2')); assert.notEqual(a, await signService('k2', '1', 'body'));
});
