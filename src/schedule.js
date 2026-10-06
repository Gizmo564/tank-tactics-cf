// AP-grant and heart-spawn scheduling for a game, expressed as pure
// functions over db + `now`. The Durable Object arms one alarm for the
// earliest due time, so timers survive restarts and idle periods.
import { grantDailyAP, spawnHeartScheduled } from './engine.js';

const hours = h => h * 3600 * 1000;
const apInterval = cfg => hours(Math.max(0.1, cfg.apIntervalHours || 24));
const jitter = (windowH, rand) => Math.floor(rand() * hours(windowH || 0));

export function nextApTime(cfg, now, rand = Math.random) { return now + apInterval(cfg) + jitter(cfg.apGrantWindowHours, rand); }
export function nextHeartTime(cfg, now, rand = Math.random) {
  return now + hours(cfg.heartSpawnIntervalHours || 24) + jitter(cfg.heartSpawnRandomWindowHours, rand);
}

// Makes sure an active game has timers set. Returns true if db changed.
export function ensureSchedule(db, now = Date.now(), rand = Math.random) {
  if (db.meta.status !== 'active') return false;
  let changed = false;
  if (!db.meta.nextAPGrant) { db.meta.nextAPGrant = nextApTime(db.meta.config, now, rand); changed = true; }
  if (db.meta.config.heartSpawnEnabled && !db.meta.nextHeartSpawn) { db.meta.nextHeartSpawn = nextHeartTime(db.meta.config, now, rand); changed = true; }
  return changed;
}

// Runs whatever is due. Returns { changed, summaryChanged }.
export function runDue(db, now = Date.now(), rand = Math.random) {
  if (db.meta.status !== 'active') return { changed: false, summaryChanged: false };
  let changed = ensureSchedule(db, now, rand);
  if (db.meta.nextAPGrant && now >= db.meta.nextAPGrant) {
    grantDailyAP(db, false, 'system');
    db.meta.nextAPGrant = nextApTime(db.meta.config, now, rand);
    changed = true;
  }
  if (db.meta.nextHeartSpawn && now >= db.meta.nextHeartSpawn) {
    spawnHeartScheduled(db);
    db.meta.nextHeartSpawn = nextHeartTime(db.meta.config, now, rand);
    changed = true;
  }
  return { changed, summaryChanged: changed };
}

// The next moment the game needs waking, or null.
export function nextWake(db) {
  if (db.meta.status !== 'active') return null;
  const times = [db.meta.nextAPGrant, db.meta.config.heartSpawnEnabled ? db.meta.nextHeartSpawn : null].filter(Boolean);
  return times.length ? Math.min(...times) : null;
}
