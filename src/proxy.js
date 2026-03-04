import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set.");
}
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// In-memory cache for activation status to prevent redirect loops during API downtime.
// Uses a simple FIFO eviction policy when cache is full (LRU would require additional tracking).
// NOTE: In multi-instance deployments, each instance has its own cache. For consistent
// activation checks across instances, consider using a distributed cache (Redis) or
// short-lived signed activation tokens. To adjust TTL, set ACTIVATION_CACHE_TTL_MS.
const MAX_ACTIVATION_CACHE_SIZE = 10000; // Evict oldest entry when exceeding 10k entries
const activationCache = new Map(); // Using Map for ordered keys (insertion order)
const ACTIVATION_CACHE_TTL_MS = parseInt(process.env.ACTIVATION_CACHE_TTL_MS, 10) || 5 * 60 * 1000; // Default 5 minutes

function getCachedActivation(wallet) {
  const cached = activationCache.get(wallet);
  if (cached && Date.now() - cached.timestamp < ACTIVATION_CACHE_TTL_MS) {
    // Move key to end (most recently used) - simple LRU approximation
    activationCache.delete(wallet);
    activationCache.set(wallet, cached);
    return cached.activated;
  }
  // Stale entry - delete it
  if (cached) activationCache.delete(wallet);
  return null;
}

function setCachedActivation(wallet, activated) {
  // If key exists, delete first to move it to end (MRU position)
  if (activationCache.has(wallet)) {
    activationCache.delete(wallet);
  }
  // FIFO eviction when cache is full: delete oldest entry (first in Map)
  else if (activationCache.size >= MAX_ACTIVATION_CACHE_SIZE) {
    const firstKey = activationCache.keys().next().value;
    if (firstKey) activationCache.delete(firstKey);
  }
  activationCache.set(wallet, { activated, timestamp: Date.now() });
}

async function checkActivationStatus(wallet, apiUrl, apiKey, requestUrl) {
  // Check cache first
  const cached = getCachedActivation(wallet);
  if (cached !== null) {
    return { activated: cached, error: null };
  }

  // Use URL API for safe URL construction
  const checkUrl = new URL('/api/activation/status', apiUrl);
  checkUrl.searchParams.set('wallet', wallet);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const res = await fetch(checkUrl.toString(), {
      headers: { "x-activation-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      // If API returns error, use cached value if available, otherwise fail closed
      console.warn(`[Activation] API returned ${res.status}, failing closed`);
      return { activated: false, error: `API error: ${res.status}` };
    }

    const data = await res.json();
    const activated = !!data.activated;

    // Cache successful response
    setCachedActivation(wallet, activated);

    return { activated, error: null };
  } catch (err) {
    // Network error or timeout - fail closed to prevent unauthorized access
    console.warn("[Activation] API unreachable, failing closed:", err.message);
    return { activated: false, error: err.message };
  }
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Root redirect
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Public APIs (normalize path)
  const normalizedPath = pathname.replace(/\/$/, "");
  const isPublicApi = [
    "/api/auth/login",
    "/api/settings/require-login",
    "/api/init",
    "/api/health",
    "/api/models/available",
    "/api/cli-tools/openclaw-settings",
    "/api/activation/check",
    "/activate"  // Activation page must be publicly accessible
  ].includes(normalizedPath);

  // AI V1 APIs handle their own authentication (API Key check)
  const isV1Api = pathname.startsWith("/api/v1") || pathname.startsWith("/v1");

  // Protect all dashboard routes and management APIs
  const isDashboard = pathname.startsWith("/dashboard");
  const isManagementApi = pathname.startsWith("/api") && !isPublicApi && !isV1Api;

  if (isDashboard || isManagementApi) {
    const token = request.cookies.get("auth_token")?.value;

    if (token) {
      try {
        await jwtVerify(token, SECRET);
        // Activation check: when ACTIVATION_API_URL is set, verify user is activated
        const apiUrl = process.env.ACTIVATION_API_URL;
        const apiKey = process.env.ACTIVATION_API_KEY;
        const wallet = request.cookies.get("zippymesh_wallet")?.value;
        if (apiUrl && apiKey && (isDashboard || isManagementApi) && !pathname.startsWith("/activate")) {
          // Must have a wallet to check activation
          if (!wallet) {
            return NextResponse.redirect(new URL("/activate", request.url));
          }

          const { activated } = await checkActivationStatus(wallet, apiUrl, apiKey, request.url);

          if (!activated) {
            return NextResponse.redirect(new URL("/activate", request.url));
          }
        }
        return NextResponse.next();
      } catch (err) {
        if (isManagementApi) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    // Optional: Allow non-authenticated dashboard if require-login is false
    if (isDashboard) {
      const origin = request.nextUrl.origin;
      try {
        const res = await fetch(`${origin}/api/settings/require-login`);
        const data = await res.json();
        if (data.requireLogin === false) {
          return NextResponse.next();
        }
      } catch (err) { }
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // Management APIs always require authentication
    if (isManagementApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/api/:path*", "/v1/:path*"],
};
