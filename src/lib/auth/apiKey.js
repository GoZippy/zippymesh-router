import { verifyRouterApiKey, isBlacklisted, addBlacklistEntry } from "../localDb.js";

// simple in-memory rate limiter: { keyOrIp: { count, start } }
const rateCache = new Map();
const RATE_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

export async function requireApiKey(request) {
  // extract client IP (X-Forwarded-For or remote address)
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
  if (await isBlacklisted("ip", ip)) {
    const err = new Error("IP blacklisted");
    err.code = 403;
    throw err;
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
