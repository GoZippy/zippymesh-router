/**
 * POST /api/auth/login — brute-force policy.
 *
 * TWO bugs, one after the other, both fixed here:
 *
 *  1. (2026-08-30 e2e finding F2) the bucket was keyed on x-forwarded-for /
 *     x-real-ip, which the caller writes, so a guesser rotating the header was
 *     never limited. Fixed by keying on clientPeer() (src/lib/net/proxyTrust.js).
 *
 *  2. (adversarial review 2026-08-30, item 15) the replacement was a hard
 *     5-per-15-minutes window on that key — and WITHOUT TRUST_PROXY clientPeer()
 *     is the single literal string "direct", so the bucket is global. Five
 *     unauthenticated POSTs from anyone who could reach the port locked the
 *     operator out of their own dashboard for fifteen minutes. The route's
 *     comment claimed "a successful login clears the streak", but the 429 was
 *     returned at :32 before authenticate() at :47, so clearIpRateLimit() at :63
 *     was unreachable — the bucket only cleared on window expiry or a restart.
 *
 * The policy now under test:
 *   - failures are delayed, per ACCOUNT, on an exponential curve capped at 30 s;
 *   - the correct password ALWAYS works, however many failures preceded it, and
 *     is never delayed;
 *   - the coarse per-peer bucket still 429s, but at 100 failures, not 5;
 *   - a successful login clears both buckets.
 *
 * The auth layer, Next's cookies() and the backoff SLEEP are mocked; the
 * limiter, proxyTrust and the backoff CURVE are the real modules (the curve is
 * asserted separately, so no test here waits).
 *
 * Run ONLY: npx vitest run tests/unit/loginLockout.test.js
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
const backoff = vi.hoisted(() => ({ slept: [] }));

vi.mock("@/lib/auth/login", () => ({ authenticate }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => {} }),
}));
// Record what the route WOULD have waited, without waiting.
vi.mock("@/lib/auth/loginBackoff", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    sleep: async (ms) => { backoff.slept.push(ms); },
  };
});

const { POST } = await import("../../src/app/api/auth/login/route.js");
const { resetIpRateLimits } = await import("../../src/lib/auth/ipRateLimit.js");
const { loginBackoffMs, LOGIN_BACKOFF_MAX_MS } = await import("../../src/lib/auth/loginBackoff.js");

const FAIL = { ok: false, error: "Invalid password", status: 401 };
const OK   = { ok: true, token: "signed.jwt.token", payload: { role: "superadmin" } };

function login(password, headers = {}, extraBody = {}) {
  return POST(
    new Request("http://127.0.0.1/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ password, ...extraBody }),
    }),
  );
}

beforeEach(() => {
  resetIpRateLimits();
  authenticate.mockReset();
  backoff.slept.length = 0;
  delete process.env.TRUST_PROXY;
});

// ── the DoS that item 15 is about ────────────────────────────────────────────

describe("an anonymous flood can no longer lock the operator out", () => {
  it("REGRESSION: 5 wrong passwords then the correct one still logs in", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 1; i <= 5; i++) {
      expect((await login("wrong")).status, `failure ${i}`).toBe(401);
    }
    authenticate.mockResolvedValue(OK);
    const res = await login("right");
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("even 50 anonymous failures leave the correct password working", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 0; i < 50; i++) await login("wrong");
    authenticate.mockResolvedValue(OK);
    expect((await login("right")).status).toBe(200);
  });

  it("a successful login is never delayed", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 0; i < 5; i++) await login("wrong");
    backoff.slept.length = 0;
    authenticate.mockResolvedValue(OK);
    await login("right");
    expect(backoff.slept).toEqual([]);
  });
});

// ── the throttle that replaces the lockout ───────────────────────────────────

describe("failed attempts are delayed on a capped exponential curve", () => {
  it("grows 250, 500, 1000, 2000, 4000 ms across consecutive failures", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 0; i < 5; i++) await login("wrong");
    expect(backoff.slept).toEqual([250, 500, 1000, 2000, 4000]);
  });

  it("caps at 30 s no matter how long the streak runs", () => {
    expect(loginBackoffMs(0)).toBe(250);
    expect(loginBackoffMs(6)).toBe(16_000);
    expect(loginBackoffMs(7)).toBe(LOGIN_BACKOFF_MAX_MS);
    expect(loginBackoffMs(1000)).toBe(LOGIN_BACKOFF_MAX_MS);
    expect(loginBackoffMs(Number.POSITIVE_INFINITY)).toBe(LOGIN_BACKOFF_MAX_MS);
    expect(loginBackoffMs(-3)).toBe(250);
  });

  it("counts per ACCOUNT: another username starts its own curve", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 0; i < 3; i++) await login("wrong", {}, { username: "alice" });
    expect(backoff.slept).toEqual([250, 500, 1000]);

    backoff.slept.length = 0;
    await login("wrong", {}, { username: "bob" });
    expect(backoff.slept).toEqual([250]);
  });

  it("a successful login resets the curve for that account", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 0; i < 3; i++) await login("wrong", {}, { username: "alice" });
    authenticate.mockResolvedValue(OK);
    await login("right", {}, { username: "alice" });

    backoff.slept.length = 0;
    authenticate.mockResolvedValue(FAIL);
    await login("wrong", {}, { username: "alice" });
    expect(backoff.slept).toEqual([250]);
  });

  it("'setup required' answers are neither counted nor delayed", async () => {
    authenticate.mockResolvedValue({ ok: false, error: "Setup required", status: 403, setupRequired: true });
    for (let i = 0; i < 8; i++) {
      const res = await login("anything");
      expect(res.status).toBe(403);
      expect((await res.json()).setupRequired).toBe(true);
    }
    expect(backoff.slept).toEqual([]);
  });
});

// ── the coarse ceiling still exists ──────────────────────────────────────────

describe("the coarse per-peer bucket still stops a sustained script", () => {
  it("429s after 100 failures, and the 429 short-circuits before authenticate()", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 1; i <= 100; i++) {
      expect((await login("wrong")).status, `failure ${i}`).toBe(401);
    }
    expect(authenticate).toHaveBeenCalledTimes(100);

    const blocked = await login("wrong");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(authenticate).toHaveBeenCalledTimes(100); // never reached the auth layer
  });

  it("rotating x-forwarded-for does not escape the coarse bucket without TRUST_PROXY", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 0; i < 100; i++) await login("wrong", { "x-forwarded-for": `10.9.8.${i % 255}` });
    const blocked = await login("wrong", { "x-forwarded-for": "203.0.113.99", "x-real-ip": "192.168.1.77" });
    expect(blocked.status).toBe(429);
  });

  it("separates peers only when TRUST_PROXY=1 and the proxy asserts the address", async () => {
    process.env.TRUST_PROXY = "1";
    authenticate.mockResolvedValue(FAIL);
    for (let i = 0; i < 100; i++) await login("wrong", { "x-forwarded-for": "203.0.113.5" });
    expect((await login("wrong", { "x-forwarded-for": "203.0.113.5" })).status).toBe(429);
    // A different proxy-asserted client still has its own budget.
    expect((await login("wrong", { "x-forwarded-for": "203.0.113.6" })).status).toBe(401);
  });
});

describe("only failed attempts count", () => {
  it("successful logins never consume the budget", async () => {
    authenticate.mockResolvedValue(OK);
    for (let i = 0; i < 200; i++) {
      expect((await login("right")).status).toBe(200);
    }
  });

  it("a successful login clears an in-progress failure streak on the coarse bucket", async () => {
    authenticate.mockResolvedValue(FAIL);
    for (let i = 0; i < 99; i++) await login("wrong");
    authenticate.mockResolvedValue(OK);
    expect((await login("right")).status).toBe(200);

    // Streak reset: a full 100 more failures are allowed before the next 429.
    authenticate.mockResolvedValue(FAIL);
    for (let i = 1; i <= 100; i++) {
      expect((await login("wrong")).status, `post-reset failure ${i}`).toBe(401);
    }
    expect((await login("wrong")).status).toBe(429);
  });
});
