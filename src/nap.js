// Nap Guard client: asks the shared guard (the landing Worker) whether the games may run.
//   open -> normal;  no-new -> no new games;  asleep -> everything paused until resetAt.
// Fail-open: if the guard cannot be reached, the game keeps running.
const DEFAULT_URL = 'https://0801564.xyz/api/nap';
let cache = null;

export async function getNap(env, now = Date.now()) {
  const ttl = env.NAP_TTL_MS ? Number(env.NAP_TTL_MS) : 30_000; // per isolate; tests shorten it
  if (cache && now - cache.at < ttl) return cache.nap;
  let nap = { level: 'open', percent: 0, resetAt: 0, source: 'failopen' };
  try {
    // the edge caches this for 60 s, so most calls never reach the guard Worker at all
    const res = await fetch(env.NAP_URL || DEFAULT_URL, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (res.ok) {
      const j = await res.json();
      if (j.level === 'open' || j.level === 'no-new' || j.level === 'asleep') nap = { level: j.level, percent: Number(j.percent) || 0, resetAt: Number(j.resetAt) || 0, source: 'guard' };
      else nap.err = 'guard answered with an unexpected level';
    } else nap.err = `guard answered ${res.status}`;
  } catch (e) { nap.err = String((e && e.message) || e).slice(0, 120); /* fail open */ }
  cache = { at: now, nap };
  return nap;
}

export const napMessage = nap => nap.level === 'asleep'
  ? 'The games are napping: the free daily server limit is nearly used up. Your game is paused and safe; it picks up after the daily reset.'
  : 'Busy day: new games are paused until the daily reset. Games already running are fine.';
