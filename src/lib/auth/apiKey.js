/**
 * Router API key enforcement for the OpenAI-compatible surface
 * (`/api/v1*`, `/v1*`, `src/sse/handlers/chat.js`). Only consulted when the
 * operator has switched `settings.requireApiKey` on; it is off by default.
 *
 * ## Proxy trust (security fix, 2026-08-30)
 *
 * This module used to derive the client IP from `x-real-ip` and then use that
 * IP to decide whether `x-forwarded-for` could be trusted — validating one
 * attacker-controlled header with another. The result was an outright auth
 * bypass: `isTrustedLanIp()` matched the default CIDR `127.0.0.0/8`, so
 * `curl -H 'x-real-ip: 127.0.0.1'` from anywhere on the network skipped the
 * API key entirely, and `requireApiKey` returned "allowed" before it ever
 * looked at the Authorization header.
 *
 * The address now comes from src/lib/net/proxyTrust.js, the one place that
 * decides whether a claimed address may be believed. A Next route handler has
 * no socket address, so an address exists ONLY when the operator has declared
 * a reverse proxy with `TRUST_PROXY=1|true`; otherwise the peer is the
 * sentinel `"direct"`, meaning unknown.
 *
 * Consequence for the LAN bypass: it is now gated on `isKnownPeer()`. With
 * `TRUST_PROXY` unset — the default, and the single-machine / LAN-reachable
 * install — there is no address, so there is no bypass and enabling
 * `requireApiKey` genuinely requires a key. With `TRUST_PROXY=1` the operator
 * has vouched for a proxy, and the documented `settings.trustedLanCidrs`
 * bypass behaves exactly as before. Nothing changes when `requireApiKey` is
 * off, because then no caller reaches this module at all.
 */

import { verifyRouterApiKey, isBlacklisted, addBlacklistEntry, getSettings } from "../localDb.js";
import { clientPeer, isKnownPeer } from "../net/proxyTrust.js";

// simple in-memory rate limiter: { keyOrIp: { count, start } }
const rateCache = new Map();
const RATE_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

// Default trusted LAN CIDRs (can be overridden in settings.trustedLanCidrs).
// Applied ONLY to an address established by a trusted proxy — never to a raw
// request header. See isTrustedLanIp() below.
const DEFAULT_TRUSTED_LAN_CIDRS = [
  "10.0.0.0/16",     // 10.0.x.x
  "127.0.0.0/8",     // localhost
  "::1/128",         // IPv6 localhost
];

/**
 * Check if an IP address falls within a CIDR range
 */
function ipInCidr(ip, cidr) {
  if (!ip || ip === "unknown") return false;
  
  // Handle IPv6 localhost
  if (ip === "::1" && cidr === "::1/128") return true;
  
  // Parse CIDR
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  
  // Handle IPv6 (simple check for now - return false for non-IPv4)
  if (ip.includes(":") && !ip.includes(".")) return false;
  
  // Convert IP to numeric (IPv4 only for now)
  const ipParts = ip.split(".").map(Number);
  const rangeParts = range.split(".").map(Number);
  
  if (ipParts.length !== 4 || rangeParts.length !== 4) return false;
  if (ipParts.some(isNaN) || rangeParts.some(isNaN)) return false;
  
  const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  
  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * The client address for this request, or the sentinel `"direct"` when none can
 * be established.
 *
 * Thin wrapper over `clientPeer()` so the whole app shares one proxy-trust
 * decision. Exported for tests. NOTE: `"direct"` means UNKNOWN — it is not an
 * address and must never be treated as loopback. Use `isKnownPeer()` before
 * granting anything on the strength of it.
 */
export function getClientIp(request) {
  return clientPeer(request);
}

/**
 * Check if an established client address falls in a trusted-LAN CIDR
 * (`settings.trustedLanCidrs`, else DEFAULT_TRUSTED_LAN_CIDRS) and may
 * therefore skip the API key.
 *
 * Fails closed unless the address came from a proxy the operator declared with
 * TRUST_PROXY. Without that declaration `peer` is `"direct"` and no CIDR can
 * match it, which is what stops a forged `x-real-ip: 127.0.0.1` from buying a
 * bypass.
 */
async function isTrustedLanIp(peer) {
  if (!isKnownPeer(peer)) return false;

  const settings = await getSettings();
  const cidrs = settings.trustedLanCidrs || DEFAULT_TRUSTED_LAN_CIDRS;

  for (const cidr of cidrs) {
    if (ipInCidr(peer, cidr)) return true;
  }
  return false;
}

export async function requireApiKey(request) {
  // The client address, or "direct" when no trusted proxy established one.
  const ip = getClientIp(request);

  if (await isBlacklisted("ip", ip)) {
    const err = new Error("IP blacklisted");
    err.code = 403;
    throw err;
  }

  // Bypass the API key only for an address a trusted proxy actually vouched
  // for. Unreachable when TRUST_PROXY is unset — see isTrustedLanIp().
  if (await isTrustedLanIp(ip)) {
    return []; // no scopes, but allowed
  }

  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    const err = new Error("Missing API key");
    err.code = 401;
    throw err;
  }
  const rawKey = auth.slice(7).trim();
  const result = await verifyRouterApiKey(rawKey);
  if (!result.valid) {
    const err = new Error("Invalid API key");
    err.code = 401;
    throw err;
  }

  if (await isBlacklisted("key", rawKey)) {
    const err = new Error("API key blacklisted");
    err.code = 403;
    throw err;
  }

  // rate limiting per key
  const now = Date.now();
  let entry = rateCache.get(rawKey);
  if (!entry || now - entry.start > RATE_WINDOW) {
    entry = { count: 0, start: now };
  }
  entry.count++;
  rateCache.set(rawKey, entry);
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    // add to blacklist automatically
    await addBlacklistEntry("key", rawKey, "rate limit exceeded");
    const err = new Error("Rate limit exceeded");
    err.code = 429;
    throw err;
  }

  return result.scopes;
}
