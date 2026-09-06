/**
 * Unit tests for per-user usage attribution (Sprint 4, task
 * admin-usage-attribution; PORT_AND_ADMIN_SYSTEM_PLAN.md §4).
 *
 * Two layers are exercised, isolated differently:
 *
 *   1. DATA LAYER — src/lib/usageDb.js summarizeUsage().
 *      usageDb resolves its data dir from process.env.DATA_DIR at module-load
 *      time (getUserDataDir() honours DATA_DIR first) and caches a singleton.
 *      So, exactly like tests/unit/usersTable.test.js, we point DATA_DIR at a
 *      fresh temp dir and seed usage.json on disk BEFORE importing usageDb. This
 *      lets us assert legacy records (no userId) bucket as 'unattributed' and
 *      that filtering by userId works — against the real aggregation code.
 *
 *   2. ROUTE LAYER — src/app/api/admin/usage/summary/route.js.
 *      The route touches the auth_token cookie (via getSessionClaims) and
 *      settings (via requireRole). We keep it hermetic by mocking the same three
 *      seams rbacEnforcement.test.js uses (next/headers, localDb getSettings)
 *      PLUS the usageDb module, so we can prove the authz behaviour — that a
 *      non-admin is forced to their own userId and a spoofed ?userId is ignored,
 *      and that an admin's ?userId is honoured — by inspecting the exact
 *      argument the route passes to summarizeUsage().
 *
 * Run ONLY: npx vitest run tests/unit/usageAttribution.test.js
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — DATA LAYER (real usageDb against an isolated temp DATA_DIR)
// ─────────────────────────────────────────────────────────────────────────────

// Unique temp data dir for this run (set BEFORE importing usageDb).
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zippymesh-usage-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const USAGE_FILE = path.join(TEST_DATA_DIR, "usage.json");

// Seed a usage.json mixing records WITH and WITHOUT userId, plus legacy/partial
// token shapes, written directly to disk so the real loader reads it.
const SEED = {
  history: [
    // user "alice": 2 requests
    {
      requestId: "r1", provider: "openai", model: "gpt-4o", userId: "alice",
      ourPromptTokens: 100, ourCompletionTokens: 50, ourExpectedCostUsd: 0.5,
      tokens: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      timestamp: "2026-06-01T00:00:00.000Z",
    },
    {
      requestId: "r2", provider: "openai", model: "gpt-4o", userId: "alice",
      ourPromptTokens: 10, ourCompletionTokens: 5, ourExpectedCostUsd: 0.05,
      tokens: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      timestamp: "2026-06-01T01:00:00.000Z",
    },
    // user "bob": 1 request
    {
      requestId: "r3", provider: "anthropic", model: "claude", userId: "bob",
      ourPromptTokens: 200, ourCompletionTokens: 80, ourExpectedCostUsd: 1.0,
      tokens: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
      timestamp: "2026-06-01T02:00:00.000Z",
    },
    // LEGACY record: no userId field at all -> must bucket as 'unattributed'.
    {
      requestId: "r4", provider: "openai", model: "gpt-4o",
      ourPromptTokens: 7, ourCompletionTokens: 3,
      tokens: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      timestamp: "2026-06-01T03:00:00.000Z",
    },
    // LEGACY/partial record: only a tokens object, userId explicitly null.
    {
      requestId: "r5", provider: "openai", model: "gpt-4o", userId: null,
      tokens: { prompt_tokens: 1, completion_tokens: 1 },
      timestamp: "2026-06-01T04:00:00.000Z",
    },
  ],
};

let usageDb;

beforeAll(async () => {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(SEED, null, 2), "utf8");
  usageDb = await import("../../src/lib/usageDb.js");
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("summarizeUsage() — attribution + back-compat", () => {
  it("aggregates records with and without userId; legacy bucketed as 'unattributed'", async () => {
    const { totals, byUser } = await usageDb.summarizeUsage();

    // Unfiltered totals span ALL records (3 attributed + 2 legacy = 5).
    expect(totals.requests).toBe(5);
    expect(totals.prompt_tokens).toBe(100 + 10 + 200 + 7 + 1);
    expect(totals.completion_tokens).toBe(50 + 5 + 80 + 3 + 1);
    expect(totals.cost).toBeCloseTo(0.5 + 0.05 + 1.0, 6);

    // Per-user breakdown includes attributed users AND the legacy bucket.
    expect(byUser.alice.requests).toBe(2);
    expect(byUser.alice.prompt_tokens).toBe(110);
    expect(byUser.bob.requests).toBe(1);

    // Both legacy records (missing userId + explicit null) land in 'unattributed'.
    expect(byUser[usageDb.UNATTRIBUTED].requests).toBe(2);
    expect(byUser[usageDb.UNATTRIBUTED].prompt_tokens).toBe(7 + 1);
    expect(byUser[usageDb.UNATTRIBUTED].completion_tokens).toBe(3 + 1);
  });

  it("filters totals by userId without dropping the full breakdown", async () => {
    const { totals, byUser, filteredUserId } = await usageDb.summarizeUsage({ userId: "alice" });

    expect(filteredUserId).toBe("alice");
    // totals reflect ONLY alice.
    expect(totals.requests).toBe(2);
    expect(totals.prompt_tokens).toBe(110);
    expect(totals.completion_tokens).toBe(55);
    expect(totals.cost).toBeCloseTo(0.55, 6);

    // byUser still exposes every bucket (admin view), bob + unattributed present.
    expect(byUser.bob).toBeTruthy();
    expect(byUser[usageDb.UNATTRIBUTED]).toBeTruthy();
  });

  it("can target legacy records explicitly via UNATTRIBUTED", async () => {
    const { totals } = await usageDb.summarizeUsage({ userId: usageDb.UNATTRIBUTED });
    expect(totals.requests).toBe(2);
  });

  it("an unknown userId yields zeroed totals (never throws)", async () => {
    const { totals } = await usageDb.summarizeUsage({ userId: "nobody" });
    expect(totals.requests).toBe(0);
    expect(totals.prompt_tokens).toBe(0);
  });

  it("normalizeUsageEntry attaches userId (default null) without breaking legacy calls", () => {
    // Existing call site shape (no userId) -> null, record still well-formed.
    const legacy = usageDb.normalizeUsageEntry({ provider: "openai", model: "gpt-4o" });
    expect(legacy.userId).toBeNull();
    expect(legacy.provider).toBe("openai");

    // New call site shape -> userId carried through.
    const attributed = usageDb.normalizeUsageEntry({ provider: "openai", model: "gpt-4o", userId: "carol" });
    expect(attributed.userId).toBe("carol");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — ROUTE LAYER (assert authz/forced-userId behaviour)
// ─────────────────────────────────────────────────────────────────────────────
//
// The route runs against the REAL usageDb (seeded above into TEST_DATA_DIR), so
// we do NOT mock usageDb — mocking it here would be hoisted module-wide and would
// clobber the data-layer tests above. Instead we assert the FORCED-userId rule by
// the SHAPE of the response computed from the known seed: alice has 2 requests /
// 110 prompt tokens, bob has 1 / 200, and the legacy bucket has 2. Only auth I/O
// is mocked (next/headers cookie jar + localDb getSettings), matching
// rbacEnforcement.test.js; the real jose HS256 verify path runs.

// Same HS256 secret encoding login.js / middleware.js use (env-driven, lazy).
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-that-is-definitely-long-enough-0123456789";

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const mockGetSettings = vi.fn();
vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: (...a) => mockGetSettings(...a),
}));

// Imports AFTER mocks are declared.
let SignJWT;
let routeGET;

beforeAll(async () => {
  ({ SignJWT } = await import("jose"));
  ({ GET: routeGET } = await import("../../src/app/api/admin/usage/summary/route.js"));
});

const SECRET = () => new TextEncoder().encode(process.env.JWT_SECRET);

async function signSession(role, extra = {}) {
  return new SignJWT({ authenticated: true, role, ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(SECRET());
}

function setCookieToken(token) {
  cookieStore.get.mockImplementation((name) =>
    name === "auth_token" && token ? { value: token } : undefined
  );
}

/** Build a request the route can read url + headers from. */
function fakeRequest(query = "") {
  const url = `http://localhost/api/admin/usage/summary${query}`;
  return { url, headers: { get: () => null } };
}

describe("GET /api/admin/usage/summary — authz + forced userId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({ requireLogin: true });
    setCookieToken(null);
  });

  it("admin can filter ANY userId (honours ?userId) and totals match that user", async () => {
    setCookieToken(await signSession("admin", { userId: "admin1" }));
    const res = await routeGET(fakeRequest("?userId=bob"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.scope).toBe("all");
    expect(body.filteredUserId).toBe("bob");
    // totals scoped to bob (1 request, 200 prompt tokens) per the seed.
    expect(body.totals.requests).toBe(1);
    expect(body.totals.prompt_tokens).toBe(200);
    // Admin always gets the FULL breakdown (every bucket, incl. unattributed).
    expect(body.byUser.alice).toBeTruthy();
    expect(body.byUser.bob).toBeTruthy();
    expect(body.byUser.unattributed).toBeTruthy();
  });

  it("admin with no ?userId sees all users (totals span everyone)", async () => {
    setCookieToken(await signSession("superadmin", { userId: "root" }));
    const res = await routeGET(fakeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.scope).toBe("all");
    expect(body.filteredUserId).toBeNull();
    expect(body.totals.requests).toBe(5); // 2 alice + 1 bob + 2 legacy
  });

  it("non-admin is FORCED to own userId and a spoofed ?userId is ignored", async () => {
    // user 'alice' tries to read 'bob' via ?userId=bob.
    setCookieToken(await signSession("user", { userId: "alice" }));
    const res = await routeGET(fakeRequest("?userId=bob"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // The route forced the caller's OWN id, ignoring the spoofed 'bob':
    // totals are alice's (2 req / 110 prompt), NOT bob's (1 / 200).
    expect(body.scope).toBe("self");
    expect(body.filteredUserId).toBe("alice");
    expect(body.totals.requests).toBe(2);
    expect(body.totals.prompt_tokens).toBe(110);

    // Breakdown is collapsed to ONLY the caller's bucket — bob is never exposed.
    expect(Object.keys(body.byUser)).toEqual(["alice"]);
    expect(body.byUser.bob).toBeUndefined();
  });

  it("viewer (read-only) gets their own scope, never another user's", async () => {
    // 'vince' has no seeded usage; forcing his id must yield zero, NOT alice's.
    setCookieToken(await signSession("viewer", { userId: "vince" }));
    const res = await routeGET(fakeRequest("?userId=alice"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("self");
    expect(body.filteredUserId).toBe("vince");
    expect(body.totals.requests).toBe(0);
    expect(body.byUser).toEqual({}); // no own bucket -> nothing exposed
  });

  it("non-admin with no resolvable userId fails closed (empty, no leak)", async () => {
    setCookieToken(await signSession("user")); // no userId claim
    const res = await routeGET(fakeRequest("?userId=bob"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("self");
    expect(body.totals.requests).toBe(0);
    expect(body.byUser).toEqual({});
    expect(body.filteredUserId).toBeNull();
  });

  it("no session + login required -> 401 before any aggregation", async () => {
    setCookieToken(null);
    const res = await routeGET(fakeRequest());
    expect(res.status).toBe(401);
  });
});
