import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import {
  peekIpRateLimit,
  recordIpRateLimitHit,
  clearIpRateLimit,
  getIpRateLimitCount,
} from "@/lib/auth/ipRateLimit";
import { clientPeer } from "@/lib/net/proxyTrust";
import { authenticate } from "@/lib/auth/login";
import { loginBackoffMs, sleep } from "@/lib/auth/loginBackoff";

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set. Refusing to start with no secret.");
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error("FATAL: JWT_SECRET is too short (minimum 32 characters). Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
}
const WEAK_SECRETS = new Set(["secret", "password", "changeme", "default", "jwt_secret", "your_secret_here"]);
if (WEAK_SECRETS.has(process.env.JWT_SECRET.toLowerCase())) {
  throw new Error("FATAL: JWT_SECRET appears to be a default/weak value. Please set a strong random secret.");
}

/**
 * Coarse ceiling: a hard 429 for the WHOLE peer bucket.
 *
 * Deliberately far out of reach of a handful of requests. Without TRUST_PROXY,
 * clientPeer() is the single literal "direct" (src/lib/net/proxyTrust.js), so
 * this bucket is shared by every caller. The old value here was 5, which meant
 * five unauthenticated POSTs from anyone who could reach the port locked the
 * operator out of their own dashboard for fifteen minutes — and the comment
 * that used to sit here claimed a successful login would clear the streak,
 * which the control flow made impossible: the 429 was returned before
 * authenticate() ever ran. See src/lib/auth/loginBackoff.js for the full
 * history. Throttling is now the progressive delay below; this ceiling only
 * stops a sustained script.
 */
const LOGIN_MAX_ATTEMPTS = 100;
const LOGIN_WINDOW_MS    = 15 * 60 * 1000; // 15 minutes

/** Effectively unbounded: the per-account bucket only counts, it never locks. */
const ACCOUNT_BUCKET_MAX = Number.MAX_SAFE_INTEGER;

/**
 * Per-account failure bucket key.
 *
 * The username is hashed so an operator reading a heap dump or a limiter dump
 * does not get a list of account names, and truncated because 64 bits of
 * collision resistance is ample for a rate-limit bucket. The legacy
 * password-only login path has no username; it gets the stable empty-string
 * bucket, which is correct — there is only one account on that path.
 */
function accountBucketKey(peer, username) {
  const h = createHash("sha256").update(String(username ?? "")).digest("hex").slice(0, 16);
  return `login:${peer}:${h}`;
}

export async function POST(request) {
  try {
    // Both buckets are keyed on the peer as src/lib/net/proxyTrust.js defines
    // it: a proxy-asserted address only under TRUST_PROXY=1, otherwise the
    // single shared "direct" bucket. Keying on x-forwarded-for directly (as
    // this route once did) let a guesser rotate the header and never be limited
    // at all (2026-08-30 e2e finding F2).
    const peer = clientPeer(request);
    const lockoutKey = `login:${peer}`;
    const rl = peekIpRateLimit(lockoutKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }

    const body = await request.json();
    // Accepts both the new { username, password } shape and the legacy
    // password-only body. The auth layer decides which path applies based on
    // whether any users exist (see authenticate()).
    const username = typeof body?.username === "string" ? body.username : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const accountKey = accountBucketKey(peer, username);

    const result = await authenticate({ username, password });

    if (!result.ok) {
      // Setup-required is not a guess; every other failure is.
      if (!result.setupRequired) {
        recordIpRateLimitHit(lockoutKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
        const priorFailures = getIpRateLimitCount(accountKey);
        recordIpRateLimitHit(accountKey, ACCOUNT_BUCKET_MAX, LOGIN_WINDOW_MS);
        // Progressive delay, per ACCOUNT, applied only to a FAILED attempt. A
        // caller who knows the password is never delayed and is never locked
        // out; a guesser is throttled to a couple of attempts a minute.
        await sleep(loginBackoffMs(priorFailures));
      }
      return NextResponse.json(
        {
          error: result.error,
          ...(result.setupRequired && { setupRequired: true }),
        },
        { status: result.status }
      );
    }

    // Success clears both buckets — and, unlike before, this line is reachable.
    clearIpRateLimit(lockoutKey);
    clearIpRateLimit(accountKey);

    // Same cookie conventions as before: httpOnly `auth_token`, lax, HTTP-allowed
    // for local-network access, root path.
    const cookieStore = await cookies();
    cookieStore.set("auth_token", result.token, {
      httpOnly: true,
      secure: false, // Allow HTTP for local network access
      sameSite: "lax",
      path: "/",
    });

    return NextResponse.json({
      success: true,
      ...(result.payload?.role && { role: result.payload.role }),
      // env-fallback (no stored hash) -> prompt the UI to store a permanent credential
      ...(result.usedEnvFallback && { needsPasswordSetup: true }),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
