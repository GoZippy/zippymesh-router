import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { verifyBearerApiKey } from "./lib/auth/edgeApiKey.js";

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set.");
}
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// In-memory cache for activation status to prevent redirect loops during API downtime.
const MAX_ACTIVATION_CACHE_SIZE = 10000;
const activationCache = new Map();
const ACTIVATION_CACHE_TTL_MS = parseInt(process.env.ACTIVATION_CACHE_TTL_MS, 10) || 5 * 60 * 1000;

// Short-lived cache for the requireLogin setting so unauthenticated requests
// don't make an extra internal HTTP fetch on every call.
let requireLoginCache = null;
let requireLoginCacheAt = 0;
const REQUIRE_LOGIN_CACHE_TTL_MS = 30_000; // 30 seconds

console.log("[Middleware] Initializing middleware module...");

function getCachedActivation(wallet) {
  const cached = activationCache.get(wallet);
  if (cached && Date.now() - cached.timestamp < ACTIVATION_CACHE_TTL_MS) {
    activationCache.delete(wallet);
    activationCache.set(wallet, cached);
    return cached.activated;
  }
  if (cached) activationCache.delete(wallet);
  return null;
}

function setCachedActivation(wallet, activated) {
  if (activationCache.has(wallet)) {
    activationCache.delete(wallet);
  } else if (activationCache.size >= MAX_ACTIVATION_CACHE_SIZE) {
    const firstKey = activationCache.keys().next().value;
    if (firstKey) activationCache.delete(firstKey);
  }
  activationCache.set(wallet, { activated, timestamp: Date.now() });
}

async function checkActivationStatus(wallet, apiUrl, apiKey, requestUrl) {
  const cached = getCachedActivation(wallet);
  if (cached !== null) return { activated: cached, error: null };

  const checkUrl = new URL('/api/activation/status', apiUrl);
  checkUrl.searchParams.set('wallet', wallet);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(checkUrl.toString(), {
      headers: { "x-activation-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return { activated: false, error: `API error: ${res.status}` };
    const data = await res.json();
    setCachedActivation(wallet, !!data.activated);
    return { activated: !!data.activated, error: null };
  } catch (err) {
    return { activated: false, error: err.message };
  }
}

export default async function middleware(request) {
  const { pathname } = request.nextUrl;
  console.log(`[Middleware] ${request.method} ${pathname}`);

  // Root redirect
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Public APIs
  const normalizedPath = pathname.replace(/\/$/, "");
  const isPublicApi = [
    "/setup",
    "/api/auth/login",
    "/api/settings",
    "/api/settings/require-login",
    "/api/init",
    "/api/health",
    // Agent-token vault routes: the bearer agent token in the body IS the
    // auth (plus their own per-IP rate limit). Agents hold no session cookie,
    // so the cookie gate below must not apply — see the route files.
    "/api/vault/read-with-token",
    "/api/vault/list-with-token",
    "/api/models/available",
    // REMOVED 2026-08-30 (adversarial review item 16f): /api/cli-tools/openclaw-settings
    // was the only member of the /api/cli-tools/* group on this list, and its
    // POST fetches a caller-supplied baseUrl with a caller-supplied bearer
    // (SSRF) and then persists a caller-supplied apiKey into
    // ~/.openclaw/openclaw.json. Its four sibling routes were never public.
    // The only consumers are dashboard cards
    // (src/app/(dashboard)/dashboard/cli-tools/components/*ToolCard.js), which
    // are rendered behind /dashboard and fetch same-origin with the session
    // cookie, so the cookie gate below serves them. Do not re-add it.
    "/api/activation/check",
    "/api/provider-status",
    "/api/tokenbuddy/rate-limits",
    "/activate"
  ].includes(normalizedPath) ||
  normalizedPath.startsWith("/api/provider-status") ||
  normalizedPath.startsWith("/api/tokenbuddy/rate-limits") ||
  normalizedPath.startsWith("/api/setup/") ||
  // Static provider-logo PNGs served by /api/providers/icon/[id]. Not
  // sensitive (just branding assets) — needs to be public because
  // next/image's server-side optimizer fetches this URL without the
  // browser's session cookie, so gating it behind auth made every provider
  // logo 401 and silently fall back to the 2-letter initials avatar.
  normalizedPath.startsWith("/api/providers/icon/");

  const isV1Api = pathname.startsWith("/api/v1") || pathname.startsWith("/v1");
  const isDashboard = pathname.startsWith("/dashboard");
  // /dashboard is a PAGE, handled by isDashboard (redirect to /login on auth
  // failure). It must NOT be folded into isManagementApi — otherwise an
  // invalid/expired cookie makes the dashboard dead-end with a JSON
  // {"error":"Unauthorized"} 401 the browser can't recover from, instead of
  // sending the user to /login.
  const isManagementApi = (pathname.startsWith("/api") || pathname.startsWith("/setup")) && !isPublicApi && !isV1Api;

  if (isPublicApi) return NextResponse.next();

  if (isDashboard || isManagementApi) {
    // F3: only a cryptographically valid router API key (HMAC crc) may bypass
    // cookie auth for management APIs — NOT any "Bearer <20+ chars>" string.
    // NOTE: this proves key AUTHENTICITY only. The edge cannot check REVOCATION
    // (the crc is static and the edge has no DB), so a revoked-but-valid key
    // still passes here. Sensitive management routes MUST add their own
    // route-level guard (requireAuth / requireApiKey) — do not rely on this edge
    // check alone. See .autoclaw/orchestrator/reviews for the edge-only route audit.
    if (isManagementApi && (await verifyBearerApiKey(request.headers.get("authorization")))) {
      return NextResponse.next();
    }

    // Validate the session cookie. A missing OR invalid/expired token is
    // treated the same — as "unauthenticated" — and handled by the
    // requireLogin gate below, rather than hard-failing here.
    const token = request.cookies.get("auth_token")?.value;
    let tokenValid = false;
    if (token) {
      try {
        await jwtVerify(token, SECRET);
        tokenValid = true;
      } catch {
        tokenValid = false; // expired/tampered/secret-rotated → re-auth below
      }
    }

    if (tokenValid) {
      const apiUrl = process.env.ACTIVATION_API_URL;
      const apiKey = process.env.ACTIVATION_API_KEY;
      const wallet = request.cookies.get("zippymesh_wallet")?.value;
      if (apiUrl && apiKey && !pathname.startsWith("/activate")) {
        if (!wallet) return NextResponse.redirect(new URL("/activate", request.url));
        const { activated } = await checkActivationStatus(wallet, apiUrl, apiKey, request.url);
        if (!activated) return NextResponse.redirect(new URL("/activate", request.url));
      }
      return NextResponse.next();
    }

    // Unauthenticated (no token, or a stale one) — consult requireLogin, then
    // send PAGES to /login and APIs to 401. Clear any stale auth_token so the
    // browser stops replaying a dead session (otherwise the dashboard would
    // keep re-triggering the failure on every load).
    let requireLogin = true;
    const now = Date.now();
    if (requireLoginCache !== null && (now - requireLoginCacheAt) < REQUIRE_LOGIN_CACHE_TTL_MS) {
      requireLogin = requireLoginCache;
    } else {
      const origin = request.nextUrl.origin;
      try {
        const res = await fetch(`${origin}/api/settings/require-login`);
        const data = await res.json();
        requireLogin = data.requireLogin !== false;
        requireLoginCache = requireLogin;
        requireLoginCacheAt = now;
      } catch (err) { }
    }

    const withClearedCookie = (resp) => {
      if (token) resp.cookies.delete("auth_token");
      return resp;
    };

    if (!requireLogin) return withClearedCookie(NextResponse.next());
    if (isDashboard) return withClearedCookie(NextResponse.redirect(new URL("/login", request.url)));
    if (isManagementApi) return withClearedCookie(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
