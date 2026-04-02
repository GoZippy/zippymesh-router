import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set.");
}
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// In-memory cache for activation status to prevent redirect loops during API downtime.
const MAX_ACTIVATION_CACHE_SIZE = 10000;
const activationCache = new Map();
const ACTIVATION_CACHE_TTL_MS = parseInt(process.env.ACTIVATION_CACHE_TTL_MS, 10) || 5 * 60 * 1000;

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

function isValidApiKey(authHeader) {
  if (!authHeader) return false;
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return false;
  return token.startsWith("sk-") || token.length >= 20;
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
    "/api/models/available",
    "/api/cli-tools/openclaw-settings",
    "/api/activation/check",
    "/api/provider-status",
    "/api/tokenbuddy/rate-limits",
    "/activate"
  ].includes(normalizedPath) || 
  normalizedPath.startsWith("/api/provider-status") || 
  normalizedPath.startsWith("/api/tokenbuddy/rate-limits") ||
  normalizedPath.startsWith("/api/setup/");

  const isV1Api = pathname.startsWith("/api/v1") || pathname.startsWith("/v1");
  const isDashboard = pathname.startsWith("/dashboard");
  const isManagementApi = (pathname.startsWith("/api") || pathname.startsWith("/setup") || pathname.startsWith("/dashboard")) && !isPublicApi && !isV1Api;

  if (isPublicApi) return NextResponse.next();

  if (isDashboard || isManagementApi) {
    if (isManagementApi && isValidApiKey(request.headers.get("authorization"))) {
      return NextResponse.next();
    }

    const token = request.cookies.get("auth_token")?.value;
    if (token) {
      try {
        await jwtVerify(token, SECRET);
        const apiUrl = process.env.ACTIVATION_API_URL;
        const apiKey = process.env.ACTIVATION_API_KEY;
        const wallet = request.cookies.get("zippymesh_wallet")?.value;
        if (apiUrl && apiKey && (isDashboard || isManagementApi) && !pathname.startsWith("/activate")) {
          if (!wallet) return NextResponse.redirect(new URL("/activate", request.url));
          const { activated } = await checkActivationStatus(wallet, apiUrl, apiKey, request.url);
          if (!activated) return NextResponse.redirect(new URL("/activate", request.url));
        }
        return NextResponse.next();
      } catch (err) {
        if (isManagementApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    if (isDashboard) {
      const origin = request.nextUrl.origin;
      try {
        const res = await fetch(`${origin}/api/settings/require-login`);
        const data = await res.json();
        if (data.requireLogin === false) return NextResponse.next();
      } catch (err) { }
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (isManagementApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
