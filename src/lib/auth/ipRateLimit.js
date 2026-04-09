/**
 * Simple in-memory IP rate limiter for server-side route protection.
 * Uses a sliding window (fixed bucket, cleared on expiry).
 *
 * Each entry: { count, resetAt }
 * Not persisted — resets on server restart. Sufficient for brute-force protection
 * on a local/private-network deployment.
 */

const store = new Map(); // key → { count, resetAt }

// Prune stale entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now >= v.resetAt) store.delete(k);
    }
  }, 5 * 60 * 1000);
}

/**
 * Check and increment the rate limit counter for a key.
 * @param {string} key       — typically an IP address
 * @param {number} max       — max requests in the window
 * @param {number} windowMs  — window length in milliseconds
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
export function checkIpRateLimit(key, max, windowMs) {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}
