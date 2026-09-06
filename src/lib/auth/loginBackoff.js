/**
 * Progressive delay for failed dashboard logins.
 *
 * Why this exists (adversarial review 2026-08-30, item 15): the login route used
 * a hard "5 failures / 15 minutes then 429" window keyed on clientPeer(). Without
 * TRUST_PROXY that key is the single literal string "direct"
 * (src/lib/net/proxyTrust.js), so the bucket is GLOBAL — five unauthenticated
 * POSTs from anyone who can reach the port locked the operator out of their own
 * dashboard for fifteen minutes. The route's own comment claimed "a successful
 * login clears the streak, so a shared bucket cannot lock legitimate callers
 * out", but the 429 fired before authenticate(), so that clear was unreachable.
 *
 * The previous behaviour was worse in the other direction: the key came from
 * caller-supplied x-forwarded-for, so a guesser rotating the header was never
 * limited at all.
 *
 * Exponential backoff is the standard resolution of that bypass-vs-DoS trade:
 * it throttles a guesser to a couple of attempts per minute while never
 * preventing a caller who knows the password from logging in.
 *
 * Kept in its own module so unit tests can assert the curve without waiting,
 * and mock `sleep` without mocking timers.
 */

/** Base unit of the curve. The first failure waits this long. */
export const LOGIN_BACKOFF_BASE_MS = 250;

/** Hard ceiling. A guesser is throttled; a human retyping a password is not. */
export const LOGIN_BACKOFF_MAX_MS = 30_000;

/**
 * Delay to apply before answering a failed login.
 *
 * @param {number} priorFailures failures already recorded in this window for
 *   this account bucket, BEFORE the current attempt (so 0 on the first failure).
 * @returns {number} milliseconds: 250, 500, 1000, 2000 … capped at 30000.
 */
export function loginBackoffMs(priorFailures) {
  // Anything not a number, or <= 0, is the first failure. A non-finite positive
  // count is nonsense but must clamp UP to the ceiling, never down to the floor.
  if (typeof priorFailures !== "number" || Number.isNaN(priorFailures) || priorFailures <= 0) {
    return LOGIN_BACKOFF_BASE_MS;
  }
  if (!Number.isFinite(priorFailures)) return LOGIN_BACKOFF_MAX_MS;
  // 2 ** n overflows to Infinity long before it matters; Math.min handles it.
  return Math.min(LOGIN_BACKOFF_BASE_MS * 2 ** Math.floor(priorFailures), LOGIN_BACKOFF_MAX_MS);
}

/** Await-able delay. Separated so tests can replace it. */
export function sleep(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
