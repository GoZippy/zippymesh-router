/**
 * Rate limiting for the token-authenticated vault routes
 * (/api/vault/read-with-token, /api/vault/list-with-token).
 *
 * Two fixed-window buckets, in memory (reset on restart):
 *
 *   `${peer}:${fingerprint}`  60 / minute. `fingerprint` is the first 16 hex
 *       chars of SHA-256(presented token), so the identity being limited is
 *       the TOKEN, not a header the caller can set. It exists for the limiter
 *       only: never log it, never return it.
 *
 *   `auth-fail:${peer}`       30 / minute, counted only when a route answers
 *       401/403 for the token itself (bad, revoked, expired, out of scope). A
 *       guesser presents a fresh fingerprint on every try, so the per-token
 *       bucket alone would never slow it down; this one does. Once exhausted
 *       the peer is refused before any token lookup. A locked vault is NOT
 *       counted: the token was valid, and an agent polling a locked vault must
 *       not lock every other caller out.
 *
 * `peer` honours x-forwarded-for / x-real-ip ONLY when the deployment declares
 * a trusted reverse proxy with TRUST_PROXY=1|true. Otherwise it is the constant
 * "direct": Next's App Router exposes no socket address, and using a header
 * the caller controls would let it pick its own bucket.
 *
 * That rule now lives in src/lib/net/proxyTrust.js, which is the single proxy-
 * trust decision for the whole app; `isTrustedProxy` and `peerKey` are
 * re-exported here unchanged so this module's public surface is untouched.
 */

import { hashToken } from "./vaultTokens.js";
import { isTrustedProxy, clientPeer } from "./net/proxyTrust.js";

export const VAULT_TOKEN_RATE_LIMIT_MAX     = 60;     // requests per token per window
export const VAULT_AUTH_FAIL_RATE_LIMIT_MAX = 30;     // 401/403 answers per peer per window
export const VAULT_RATE_LIMIT_WINDOW_MS     = 60_000; // 1 minute

/** @type {Map<string, { count: number, windowStart: number }>} */
const _windows = new Map();

/** True when the deployment declares that proxy address headers can be trusted. */
export { isTrustedProxy };

/** Peer key for a request: the proxied client address when trusted, else "direct". */
export const peerKey = clientPeer;

/** Limiter-only identity of a presented token. Never log or return it. */
export function tokenFingerprint(rawToken) {
  return hashToken(rawToken).slice(0, 16);
}

function bucket(key, now) {
  const w = _windows.get(key);
  if (w && now - w.windowStart <= VAULT_RATE_LIMIT_WINDOW_MS) return w;
  const fresh = { count: 0, windowStart: now };
  _windows.set(key, fresh);
  return fresh;
}

function retryAfterSeconds(w, now) {
  return Math.max(1, Math.ceil((VAULT_RATE_LIMIT_WINDOW_MS - (now - w.windowStart)) / 1000));
}

/**
 * Admit or refuse a request presenting `rawToken`. Call once per request,
 * before the token is verified.
 *
 * @returns {{ allowed: true, peer: string } | { allowed: false, peer: string, retryAfter: number }}
 */
export function checkVaultTokenRequest(request, rawToken) {
  const now  = Date.now();
  const peer = peerKey(request);

  const fails = bucket(`auth-fail:${peer}`, now);
  if (fails.count >= VAULT_AUTH_FAIL_RATE_LIMIT_MAX) {
    return { allowed: false, peer, retryAfter: retryAfterSeconds(fails, now) };
  }

  const perToken = bucket(`${peer}:${tokenFingerprint(rawToken)}`, now);
  perToken.count += 1;
  if (perToken.count > VAULT_TOKEN_RATE_LIMIT_MAX) {
    return { allowed: false, peer, retryAfter: retryAfterSeconds(perToken, now) };
  }
  return { allowed: true, peer };
}

/** Count a 401/403 answered to `peer` (from checkVaultTokenRequest) against its auth-fail bucket. */
export function recordVaultAuthFailure(peer) {
  bucket(`auth-fail:${peer}`, Date.now()).count += 1;
}

/** Forget every window. Test seam only. */
export function resetVaultRateLimits() {
  _windows.clear();
}

// Sweep stale windows so an idle server does not accumulate them. unref so the
// timer never keeps a short-lived process (tests, scripts) alive.
setInterval(() => {
  const cutoff = Date.now() - VAULT_RATE_LIMIT_WINDOW_MS;
  for (const [key, w] of _windows) {
    if (w.windowStart < cutoff) _windows.delete(key);
  }
}, VAULT_RATE_LIMIT_WINDOW_MS).unref?.();
