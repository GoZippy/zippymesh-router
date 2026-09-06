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

/**
 * Read the state of a bucket WITHOUT counting a hit.
 *
 * For limiters that must count only failures (a login lockout): peek before the
 * attempt, then recordIpRateLimitHit() only when it fails, so successful callers
 * sharing a coarse bucket (see src/lib/net/proxyTrust.js — without a trusted
 * proxy every caller is the one "direct" peer) can never lock each other out.
 *
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
export function peekIpRateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    return { allowed: true, remaining: max, resetAt: now + windowMs };
  }
  return { allowed: entry.count < max, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt };
}

/** Count one hit against a bucket (same window semantics as checkIpRateLimit). */
export function recordIpRateLimitHit(key, max, windowMs) {
  return checkIpRateLimit(key, max, windowMs);
}

/**
 * Hits recorded against a bucket in the CURRENT window, without counting one.
 *
 * For a limiter whose response is graduated rather than binary — the login
 * route's progressive backoff derives its delay from this number — where
 * `peekIpRateLimit`'s `remaining` is the wrong shape because the ceiling is
 * effectively unbounded.
 *
 * @returns {number} 0 when the bucket is absent or its window has expired
 */
export function getIpRateLimitCount(key) {
  const entry = store.get(key);
  if (!entry || Date.now() >= entry.resetAt) return 0;
  return entry.count;
}

/** Forget a bucket — e.g. after a successful login clears the failure streak. */
export function clearIpRateLimit(key) {
  store.delete(key);
}

/** Test seam: forget every bucket. */
export function resetIpRateLimits() {
  store.clear();
}
