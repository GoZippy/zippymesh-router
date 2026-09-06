/**
 * One place that decides whether this process may believe a request's claimed
 * client address.
 *
 * ## The problem
 *
 * A Next.js App Router route handler receives a `Request`, not a socket. There
 * is no `remoteAddress`, so the ONLY thing a handler can look at is headers —
 * and every header is written by whoever is on the other end of the connection.
 * `x-forwarded-for`, `x-real-ip` and friends are meaningful exactly when a
 * reverse proxy the operator controls sits in front of this process and
 * OVERWRITES them. Absent that proxy they are attacker-chosen strings.
 *
 * So the address is not "usually right, occasionally spoofed": it is either
 * asserted by infrastructure the operator vouched for, or it is unknown. There
 * is no third state, and code that treats a header as a fallback for the real
 * peer is making a security decision on attacker input.
 *
 * ## The model
 *
 * `TRUST_PROXY=1|true` is the operator declaring "a reverse proxy I control
 * terminates connections and rewrites the forwarding headers". Only then does
 * `clientPeer()` return an address. Otherwise it returns the constant
 * `DIRECT_PEER` ("direct") — an explicit "unknown", not an IP-shaped lie.
 *
 * Callers must therefore treat `"direct"` as "no address available" and NEVER
 * as a loopback/LAN address. In particular an address-based privilege (an
 * allowlist, a CIDR bypass, an ACL) must be gated on `isTrustedProxy()` and
 * must fail CLOSED when it is false. Rate limiting is the one thing that is
 * still useful with an unknown peer: everyone shares the `"direct"` bucket,
 * which is coarse but sound, because a caller cannot escape a shared bucket
 * into a private one by inventing a header.
 *
 * ## Caveat that survives TRUST_PROXY=1
 *
 * A proxy must OVERWRITE `x-forwarded-for`, not append to it. A proxy that
 * appends lets a remote client seed the first hop and therefore choose the
 * address this module reports. Nginx `proxy_set_header X-Forwarded-For $remote_addr`
 * and Caddy's defaults overwrite; `$proxy_add_x_forwarded_for` appends. This is
 * why `TRUST_PROXY` is opt-in and off by default.
 *
 * History: `src/lib/vaultRateLimit.js` established this model for the vault
 * token routes; `src/lib/auth/apiKey.js` previously used a different and unsafe
 * convention (trust `x-forwarded-for` when `x-real-ip` looks private — but
 * `x-real-ip` is itself a request header, so the check validated attacker input
 * with attacker input). This module is the convergence point for both.
 */

/** Returned by clientPeer() when no address can be established. Never an IP. */
export const DIRECT_PEER = "direct";

/**
 * True when the deployment declares that proxy address headers can be trusted.
 *
 * Reads `process.env` on every call rather than caching at module load, so a
 * test (or a process that mutates its own env before serving) sees the change.
 *
 * @returns {boolean}
 */
export function isTrustedProxy() {
  const v = String(process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * The client address for a request, or `DIRECT_PEER` when it cannot be known.
 *
 * With a trusted proxy: the first hop of `x-forwarded-for` (the original
 * client; later entries are the proxy chain), else `x-real-ip`. Without one:
 * always `DIRECT_PEER`, whatever headers the caller sent.
 *
 * @param {{ headers: { get(name: string): string | null } }} request
 * @returns {string} an address, or `DIRECT_PEER`
 */
export function clientPeer(request) {
  if (!isTrustedProxy()) return DIRECT_PEER;
  const forwarded = request?.headers?.get?.("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0].trim() : "";
  return first || request?.headers?.get?.("x-real-ip")?.trim() || DIRECT_PEER;
}

/**
 * True when `peer` is a real address this process is entitled to believe —
 * i.e. `clientPeer()` produced it from a trusted proxy's headers.
 *
 * The guard any address-based privilege must pass before it grants anything.
 *
 * @param {string} peer value returned by clientPeer()
 * @returns {boolean}
 */
export function isKnownPeer(peer) {
  return isTrustedProxy() && typeof peer === "string" && peer !== DIRECT_PEER && peer.length > 0;
}
