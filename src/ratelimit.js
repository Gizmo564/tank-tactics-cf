// Tiny in-memory sliding-window limiter, per Durable Object instance.
// (Resets if the object is evicted — fine for anti-spam, not a security boundary.)
export class RateLimiter {
  constructor() { this.hits = new Map(); }
  allow(key, max, windowMs, now = Date.now()) {
    const arr = (this.hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) { this.hits.set(key, arr); return false; }
    arr.push(now); this.hits.set(key, arr);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some(t => now - t < windowMs)) this.hits.delete(k);
    return true;
  }
}
