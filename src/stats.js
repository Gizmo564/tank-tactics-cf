// Anonymous usage counts for the admin panel on 0801564.xyz (Traffic / Games tabs).
// Fire-and-forget: it never blocks a game and any failure is ignored. No usernames, codes or IDs are sent, only "a game started".
const SITE = 'tanks';

/** Off unless STATS_URL is set (production sets it in wrangler.jsonc). Local test runs must never count as real games. */
export function statsUrl(env) {
  if (!env.STATS_URL) return null;
  if (env.NAP_URL && /^https?:\/\/(127\.|localhost|\[::1\])/.test(env.NAP_URL) && /^https:\/\/0801564\.xyz/.test(env.STATS_URL)) return null;
  return env.STATS_URL;
}

/** type: 'game_created' | 'player_joined' | 'round_finished'; extra: { n, peak } */
export function reportEvent(env, waitUntil, type, extra = {}) {
  try {
    const url = statsUrl(env);
    if (!url) return;
    waitUntil(fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ site: SITE, type, ...extra }) }).then(r => r.arrayBuffer()).catch(() => {}));
  } catch { /* analytics must never break a game */ }
}
