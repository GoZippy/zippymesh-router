/**
 * src/lib/auth/apiKey.js — regression cover for the forged-header auth bypass.
 *
 * Before the 2026-08-30 security pass, `getClientIp()` returned the value of
 * the `x-real-ip` REQUEST HEADER, and `isTrustedLanIp()` matched that value
 * against `trustedLanCidrs` (default `127.0.0.0/8`) to decide whether to skip
 * the API key. So `curl -H 'x-real-ip: 127.0.0.1'` from anywhere on the
 * network satisfied `requireApiKey` without presenting a key at all.
 *
 * The first describe block is the bypass, asserted dead. The rest pins the
 * behaviour that must NOT have changed: the operator-configured LAN bypass
 * still works behind a declared reverse proxy, and a missing/invalid key is
 * still a 401.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  settings: {},
  /** raw key -> { valid, scopes } */
  keys: new Map(),
  blacklist: new Set(),   // `${type}:${value}`
  added: [],
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: vi.fn(async () => db.settings),
  verifyRouterApiKey: vi.fn(async (raw) => db.keys.get(raw) ?? { valid: false }),
  isBlacklisted: vi.fn(async (type, value) => db.blacklist.has(`${type}:${value}`)),
  addBlacklistEntry: vi.fn(async (type, value, reason) => { db.added.push({ type, value, reason }); }),
}));

const { requireApiKey, getClientIp } = await import("../../src/lib/auth/apiKey.js");

/** Minimal Request stand-in. */
function req(headers = {}) {
  const h = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { headers: { get: (k) => h[k.toLowerCase()] ?? null } };
}

/** Run requireApiKey and report the thrown code, or "ok" plus the scopes. */
async function attempt(headers) {
  try {
    return { outcome: "ok", scopes: await requireApiKey(req(headers)) };
  } catch (err) {
    return { outcome: "throw", code: err.code, message: err.message };
  }
}

const GOOD_KEY = "sk-machine-key-abcd1234";

const ORIGINAL = process.env.TRUST_PROXY;
beforeEach(() => {
  delete process.env.TRUST_PROXY;
  db.settings = {};
  db.keys.clear();
  db.keys.set(GOOD_KEY, { valid: true, scopes: [] });
  db.blacklist.clear();
  db.added.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = ORIGINAL;
});

// ── the bypass, asserted dead ────────────────────────────────────────────────

describe("forged address headers no longer bypass the API key", () => {
  // Each of these was a working bypass before the fix: the header value landed
  // in a default trustedLanCidrs range and requireApiKey returned [] early.
  const forgeries = [
    { "x-real-ip": "127.0.0.1" },
    { "x-real-ip": "127.5.5.5" },
    { "x-real-ip": "10.0.0.1" },
    { "x-real-ip": "10.0.255.254" },
    { "x-real-ip": "::1" },
    { "x-forwarded-for": "127.0.0.1" },
    { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" },
    { "x-forwarded-for": "10.0.0.1, 8.8.8.8", "x-real-ip": "10.0.0.2" },
    { "remote_addr": "127.0.0.1" },
  ];

  it.each(forgeries)("401s for headers %j when no key is presented", async (headers) => {
    const r = await attempt(headers);
    expect(r).toMatchObject({ outcome: "throw", code: 401 });
    expect(r.message).toBe("Missing API key");
  });

  it("401s for a forged loopback header carrying an INVALID key", async () => {
    expect(await attempt({ "x-real-ip": "127.0.0.1", authorization: "Bearer sk-not-a-real-key" }))
      .toMatchObject({ outcome: "throw", code: 401, message: "Invalid API key" });
  });

  it("still admits a forged-header request that presents a VALID key", async () => {
    // The header is irrelevant either way; the key is what authorises.
    expect(await attempt({ "x-real-ip": "127.0.0.1", authorization: `Bearer ${GOOD_KEY}` }))
      .toMatchObject({ outcome: "ok" });
  });

  it("a caller cannot buy a bypass with a custom trustedLanCidrs range either", async () => {
    db.settings.trustedLanCidrs = ["203.0.113.0/24"];
    expect(await attempt({ "x-real-ip": "203.0.113.5" }))
      .toMatchObject({ outcome: "throw", code: 401 });
  });
});

describe("getClientIp reports 'direct' rather than an IP-shaped guess", () => {
  it("returns 'direct' for header-only addresses when TRUST_PROXY is unset", () => {
    expect(getClientIp(req({ "x-real-ip": "127.0.0.1" }))).toBe("direct");
    expect(getClientIp(req({ "x-forwarded-for": "10.0.0.1" }))).toBe("direct");
    expect(getClientIp(req())).toBe("direct");
  });

  it("returns the proxied client address when TRUST_PROXY is set", () => {
    process.env.TRUST_PROXY = "1";
    expect(getClientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });
});

// ── the operator-configured bypass, still working ────────────────────────────

describe("with TRUST_PROXY=1 the trusted-LAN bypass still applies", () => {
  beforeEach(() => { process.env.TRUST_PROXY = "1"; });

  it("a forwarded client inside a default trusted CIDR skips the key", async () => {
    // defaults: 10.0.0.0/16, 127.0.0.0/8, ::1/128
    for (const ip of ["10.0.0.1", "10.0.255.254", "127.0.0.1"]) {
      const r = await attempt({ "x-forwarded-for": `${ip}, 10.9.9.9` });
      expect(r, ip).toMatchObject({ outcome: "ok" });
      expect(r.scopes).toEqual([]);
    }
  });

  it("honours an operator-configured trustedLanCidrs list", async () => {
    db.settings.trustedLanCidrs = ["192.168.1.0/24"];
    expect(await attempt({ "x-forwarded-for": "192.168.1.50" })).toMatchObject({ outcome: "ok" });
    // and the defaults no longer apply once overridden
    expect(await attempt({ "x-forwarded-for": "10.0.0.1" })).toMatchObject({ outcome: "throw", code: 401 });
  });

  it("a forwarded client OUTSIDE the trusted CIDRs still needs a key", async () => {
    expect(await attempt({ "x-forwarded-for": "203.0.113.9" }))
      .toMatchObject({ outcome: "throw", code: 401 });
    expect(await attempt({ "x-forwarded-for": "203.0.113.9", authorization: `Bearer ${GOOD_KEY}` }))
      .toMatchObject({ outcome: "ok" });
  });

  it("a proxy that forwards nothing yields 'direct' and no bypass", async () => {
    expect(await attempt({})).toMatchObject({ outcome: "throw", code: 401 });
  });
});

// ── unchanged behaviour ──────────────────────────────────────────────────────

describe("key validation, blacklist and scopes are unchanged", () => {
  it("401 when the Authorization header is missing or not Bearer", async () => {
    expect(await attempt({})).toMatchObject({ code: 401, message: "Missing API key" });
    expect(await attempt({ authorization: GOOD_KEY })).toMatchObject({ code: 401, message: "Missing API key" });
    expect(await attempt({ authorization: `Basic ${GOOD_KEY}` })).toMatchObject({ code: 401, message: "Missing API key" });
  });

  it("accepts a case-insensitive Bearer prefix", async () => {
    expect(await attempt({ authorization: `bearer ${GOOD_KEY}` })).toMatchObject({ outcome: "ok" });
    expect(await attempt({ authorization: `BEARER ${GOOD_KEY}` })).toMatchObject({ outcome: "ok" });
  });

  it("401 for an unknown key", async () => {
    expect(await attempt({ authorization: "Bearer sk-nope" }))
      .toMatchObject({ code: 401, message: "Invalid API key" });
  });

  it("returns the key's scopes", async () => {
    db.keys.set("sk-scoped", { valid: true, scopes: ["mcp", "chat"] });
    expect(await attempt({ authorization: "Bearer sk-scoped" }))
      .toMatchObject({ outcome: "ok", scopes: ["mcp", "chat"] });
  });

  it("403 for a blacklisted key", async () => {
    db.blacklist.add(`key:${GOOD_KEY}`);
    expect(await attempt({ authorization: `Bearer ${GOOD_KEY}` }))
      .toMatchObject({ code: 403, message: "API key blacklisted" });
  });

  it("403 for a blacklisted peer, which is now 'direct' by default", async () => {
    db.blacklist.add("ip:direct");
    expect(await attempt({ authorization: `Bearer ${GOOD_KEY}` }))
      .toMatchObject({ code: 403, message: "IP blacklisted" });
  });

  it("403 for a blacklisted proxied address when TRUST_PROXY is set", async () => {
    process.env.TRUST_PROXY = "1";
    db.blacklist.add("ip:203.0.113.9");
    expect(await attempt({ "x-forwarded-for": "203.0.113.9", authorization: `Bearer ${GOOD_KEY}` }))
      .toMatchObject({ code: 403, message: "IP blacklisted" });
  });

  it("429s and self-blacklists a key past 100 requests in the window", async () => {
    const key = "sk-rate-limited";
    db.keys.set(key, { valid: true, scopes: [] });
    for (let i = 0; i < 100; i++) {
      expect(await attempt({ authorization: `Bearer ${key}` })).toMatchObject({ outcome: "ok" });
    }
    expect(await attempt({ authorization: `Bearer ${key}` }))
      .toMatchObject({ code: 429, message: "Rate limit exceeded" });
    expect(db.added).toContainEqual({ type: "key", value: key, reason: "rate limit exceeded" });
  });
});
