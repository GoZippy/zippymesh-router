/**
 * src/middleware.js — the edge PUBLIC list.
 *
 * THE FIX under test (adversarial review 2026-08-30, item 16f):
 * `/api/cli-tools/openclaw-settings` was on the public list. Its POST fetches a
 * caller-supplied `baseUrl` with a caller-supplied bearer (SSRF) and then
 * persists a caller-supplied `apiKey` into `~/.openclaw/openclaw.json`. Its four
 * sibling `/api/cli-tools/*` routes were never public. It is now off the list,
 * and the route additionally wraps every verb in requireAuth().
 *
 * The only consumers are dashboard cards under
 * src/app/(dashboard)/dashboard/cli-tools/components/, which render behind
 * /dashboard and fetch same-origin with the session cookie — so the tests below
 * also pin that a VALID cookie still reaches the route (the card must keep
 * working), and that the endpoints the e2e runner depends on stay public.
 *
 * The middleware's requireLogin lookup is an internal HTTP fetch that fails in
 * this environment; it is caught and defaults to `requireLogin = true`, which
 * is exactly the posture being asserted.
 *
 * Run ONLY: npx vitest run tests/unit/middlewarePublicRoutes.test.js
 */
import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";

const ORIGIN = "http://127.0.0.1:20128";

let middleware;
let NextRequest;
let cookie;

beforeAll(async () => {
  ({ NextRequest } = await import("next/server"));
  middleware = (await import("../../src/middleware.js")).default;

  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  cookie = await new SignJWT({ authenticated: true, username: "op", role: "superadmin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
});

function req(pathname, { method = "GET", authCookie = null } = {}) {
  const r = new NextRequest(new Request(`${ORIGIN}${pathname}`, { method }));
  if (authCookie) r.cookies.set("auth_token", authCookie);
  return r;
}

/** 401 == the cookie gate rejected it; null status == NextResponse.next(). */
async function statusOf(pathname, opts) {
  const res = await middleware(req(pathname, opts));
  return res?.status ?? null;
}

describe("/api/cli-tools/* is no longer public", () => {
  it("openclaw-settings GET is 401 without a session", async () => {
    expect(await statusOf("/api/cli-tools/openclaw-settings")).toBe(401);
  });

  it("openclaw-settings POST — the SSRF + credential-write verb — is 401 without a session", async () => {
    expect(await statusOf("/api/cli-tools/openclaw-settings", { method: "POST" })).toBe(401);
  });

  it("a trailing slash does not re-open it", async () => {
    expect(await statusOf("/api/cli-tools/openclaw-settings/")).toBe(401);
  });

  it("the sibling cli-tools routes stay closed too", async () => {
    for (const p of [
      "/api/cli-tools/claude-settings",
      "/api/cli-tools/codex-settings",
      "/api/cli-tools/droid-settings",
      "/api/cli-tools/voidspec-settings",
    ]) {
      expect(await statusOf(p), p).toBe(401);
    }
  });

  it("the logged-in dashboard card still gets through — a valid cookie is passed to the route", async () => {
    // NextResponse.next() carries status 200 and the x-middleware-next marker;
    // what matters is that it is NOT the 401 JSON body.
    const res = await middleware(req("/api/cli-tools/openclaw-settings", { authCookie: cookie }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("a forged bearer does not substitute for the session", async () => {
    const r = req("/api/cli-tools/openclaw-settings", { method: "POST" });
    r.headers.set("authorization", "Bearer sk-not-a-real-router-key-0000000000");
    expect((await middleware(r)).status).toBe(401);
  });
});

describe("the endpoints that must stay public are untouched", () => {
  it("passes /api/health, /api/settings, /api/auth/login and the vault token routes straight through", async () => {
    for (const p of [
      "/api/health",
      "/api/settings",
      "/api/settings/require-login",
      "/api/auth/login",
      "/api/init",
      "/api/vault/read-with-token",
      "/api/vault/list-with-token",
      "/api/models/available",
      "/api/activation/check",
      "/api/provider-status",
      "/api/tokenbuddy/rate-limits",
    ]) {
      const res = await middleware(req(p));
      expect(res.headers.get("x-middleware-next"), `${p} must stay public`).toBe("1");
    }
  });

  it("still lets the unauthenticated /api/v1 surface past the edge", async () => {
    const res = await middleware(req("/api/v1/wallet"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
