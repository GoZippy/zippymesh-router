/**
 * Shared authentication utilities for API routes
 */

import { isAuthenticated } from "./login.js";
import { getSettings } from "../localDb.js";
import { NextResponse } from "next/server";
import { apiError } from "../apiErrors.js";
import { checkIpRateLimit } from "./ipRateLimit.js";
import { clientPeer } from "../net/proxyTrust.js";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { hasUserRole, USER_ROLES } from "./rbac.js";

/**
 * HS256 secret for verifying the dashboard session JWT.
 *
 * Read lazily per-call and mirrored EXACTLY from src/lib/auth/login.js
 * getSecret(): `new TextEncoder().encode(process.env.JWT_SECRET || "")`. We do
 * NOT re-implement secret handling differently — using the same encoding keeps
 * tokens signed by login.js verifiable here, and the lazy read lets unit tests
 * set JWT_SECRET before exercising these helpers.
 */
function getSessionSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET || "");
}

/**
 * Check if the request is authorized
 * Checks if login is required and if the user is authenticated
 * @returns {Promise<boolean>}
 */
export async function checkAuth() {
  const settings = await getSettings();
  if (settings.requireLogin === false) {
    return true;
  }
  const auth = await isAuthenticated();
  return !!auth;
}

/**
 * Require authentication for an API route handler
 * Returns a 401 response if not authenticated, otherwise executes the handler
 * @param {Function} handler - The route handler to execute if authenticated
 * @returns {Function} Wrapped handler with auth check
 */
export function requireAuth(handler) {
  return async function(request, context) {
    // Peer per src/lib/net/proxyTrust.js: a proxy-asserted address only under
    // TRUST_PROXY=1, else the shared "direct" bucket. A caller-chosen header
    // must never pick its own bucket (2026-08-30 audit).
    const ip = clientPeer(request);

    // Rate limit dashboard APIs: max 300 requests per minute per peer
    const rl = checkIpRateLimit(`dashboard:${ip}`, 300, 60 * 1000);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { 
        status: 429, 
        headers: {
          "Content-Type": "application/json",
          "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString()
        }
      });
    }

    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }
    return handler(request, context);
  };
}

/**
 * Decode the dashboard session JWT and return its claims, or null.
 *
 * Returns the FULL verified payload `{ authenticated, userId, username, role }`
 * (unlike isAuthenticated(), which collapses it to a boolean). Verification
 * uses the same jose HS256 path and secret encoding as login.js, so this only
 * succeeds for tokens this app signed. Any failure (no cookie, bad signature,
 * expired, or `authenticated` not strictly true) returns null — fail-closed.
 *
 * NOTE: this does NOT consult settings.requireLogin. It strictly reports who
 * the cookie proves you are. The requireLogin===false "open" mode is handled in
 * the role wrappers below so the decision is explicit at each call site.
 *
 * @returns {Promise<{authenticated:boolean,userId:any,username:any,role:string}|null>}
 */
export async function getSessionClaims() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (payload.authenticated !== true) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Require a minimum USER-ACCOUNT role for an API route handler.
 *
 * Behaviour layers on top of requireAuth():
 *   1. Same per-IP rate limit (300/min) as requireAuth.
 *   2. Same auth gate via checkAuth().
 *   3. ALSO enforces that the session role >= `minRole`, else 403.
 *
 * requireLogin===false decision: when login is disabled we PRESERVE the current
 * open behaviour by treating the caller as superadmin. checkAuth() already
 * returns true unconditionally in that mode (so single-user installs are never
 * locked out); to keep that contract we grant the top role rather than denying
 * on a missing JWT. This intentionally mirrors checkAuth()'s open-mode posture.
 *
 * When login IS required, the role is read from the verified JWT and is
 * fail-closed: a missing/invalid token or an unknown/lower role yields 403
 * (401 first if checkAuth() itself fails).
 *
 * @param {string} minRole  minimum user-account role (e.g. 'admin','superadmin')
 * @param {Function} handler route handler to run when authorized
 */
export function requireRole(minRole, handler) {
  return async function(request, context) {
    const ip = clientPeer(request); // see requireAuth

    // Rate limit dashboard APIs: max 300 requests per minute per peer (same as requireAuth).
    const rl = checkIpRateLimit(`dashboard:${ip}`, 300, 60 * 1000);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString()
        }
      });
    }

    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    // Open mode: login disabled -> treat caller as superadmin (preserve current
    // open behaviour; never lock out single-user installs).
    const settings = await getSettings();
    const effectiveRole = settings.requireLogin === false
      ? USER_ROLES.SUPERADMIN
      : (await getSessionClaims())?.role;

    if (!hasUserRole(effectiveRole, minRole)) {
      return apiError(request, 403, "Forbidden: insufficient role");
    }

    return handler(request, context);
  };
}

/**
 * Require the SUPERADMIN user-account role for an API route handler.
 * Thin convenience over requireRole('superadmin', handler).
 *
 * @param {Function} handler route handler to run when authorized
 */
export function requireSuperadmin(handler) {
  return requireRole(USER_ROLES.SUPERADMIN, handler);
}
