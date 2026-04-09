import { verifyRouterApiKey, isBlacklisted, addBlacklistEntry, getSettings } from "../localDb.js";

// simple in-memory rate limiter: { keyOrIp: { count, start } }
const rateCache = new Map();
const RATE_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

// Known proxy IPs that can be trusted for X-Forwarded-For
// Only trust X-Forwarded-For if the request comes from one of these
const TRUSTED_PROXY_IPS = [
  "127.0.0.1",     // localhost
  "::1",           // IPv6 localhost
  "10.0.0.0/8",   // Private Class A
  "172.16.0.0/12", // Private Class B  
  "192.168.0.0/16", // Private Class C
];

// Default trusted LAN CIDRs (can be overridden in settings.trustedLanCidrs)
// NOTE: These are ONLY applied to the actual client IP, not spoofable headers
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
 * Check if an IP is from a trusted proxy (internal network)
 * Only IPs from internal networks can be trusted to provide valid X-Forwarded-For
 */
function isTrustedProxyIp(ip) {
  if (!ip || ip === "unknown") return false;
  
  for (const cidr of TRUSTED_PROXY_IPS) {
    if (ipInCidr(ip, cidr)) return true;
  }
  return false;
}

/**
 * Extract the real client IP from request, with proper validation
 * SECURITY: Only trust X-Forwarded-For if the request comes from a trusted proxy
 */
function getClientIp(request) {
  // Get the direct connection IP (always trustworthy)
  const directIp = request.headers.get("x-real-ip") || 
                   request.headers.get("remote_addr") || 
                   "unknown";
  
  // Check if request came from a trusted proxy
  const forwardedFor = request.headers.get("x-forwarded-for");
  
  // Only trust X-Forwarded-For if direct connection is from a trusted proxy
  if (forwardedFor && isTrustedProxyIp(directIp)) {
    // X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2
    // The first IP is the original client
    const ips = forwardedFor.split(",").map(ip => ip.trim());
    if (ips.length > 0 && ips[0]) {
      return ips[0];
    }
  }
  
  // Fall back to direct IP; when unknown, return "unknown" so auth can proceed
  // (API key still required; Next.js route handlers don't expose socket.remoteAddress)
  return directIp !== "unknown" ? directIp : "unknown";
}

/**
 * Check if IP is from a trusted LAN (bypasses API key requirement)
 */
async function isTrustedLanIp(ip) {
  const settings = await getSettings();
  const cidrs = settings.trustedLanCidrs || DEFAULT_TRUSTED_LAN_CIDRS;
  
  for (const cidr of cidrs) {
    if (ipInCidr(ip, cidr)) return true;
  }
  return false;
}

export async function requireApiKey(request) {
  // Get the real client IP with proper validation (or "unknown" when not available)
  const ip = getClientIp(request);
  
  if (await isBlacklisted("ip", ip)) {
    const err = new Error("IP blacklisted");
    err.code = 403;
    throw err;
  }

  // Bypass API key for trusted LAN IPs (only if we have a validated internal IP)
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
