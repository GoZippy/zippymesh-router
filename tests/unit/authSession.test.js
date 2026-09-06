/**
 * Unit tests for GET /api/auth/session
 * (src/app/api/auth/session/route.js, Sprint 5 task admin-dashboard-ui).
 *
 * The dashboard session JWT is httpOnly, so the browser cannot read its `role`
 * claim. This route is the tiny read-only seam that surfaces ONLY
 * { authenticated, username, role } to the client (for Sidebar nav gating).
 *
 * We drive the REAL route handler against the REAL getSessionClaims() jose
 * verify path, mocking exactly two seams (same approach as
 * rbacEnforcement.test.js / meshSettingsAuth.test.js):
 *   - next/headers cookies()  -> serves a JWT we sign in-test (HS256 verify runs)
 *   - ../../src/lib/localDb.js getSettings() -> controls requireLogin (open mode)
 *
 * Contract under test:
 *   - authed user -> { authenticated:true, username, role } surfaced from claims
 *   - no cookie (login required) -> { authenticated:false, username:null, role:null }
 *   - open mode (requireLogin===false) -> { authenticated:true, username:null,
 *       role:'superadmin' } (parity with requireRole's open-mode treatment)
 *   - NEVER leaks the token or any other claim.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-that-is-definitely-long-enough-0123456789";
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// ── Mock seams (hoisted) ────────────────────────────────────────────────────
const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const mockGetSettings = vi.fn();
vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: (...a) => mockGetSettings(...a),
}));

// Import AFTER the mocks are declared.
import { GET } from "../../src/app/api/auth/session/route.js";

async function signSession(role, extra = {}) {
  return new SignJWT({ authenticated: true, role, ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(SECRET);
}

function setCookieToken(token) {
  cookieStore.get.mockImplementation((name) =>
    name === "auth_token" && token ? { value: token } : undefined
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: login required (the secure, role-enforcing mode).
  mockGetSettings.mockResolvedValue({ requireLogin: true });
  setCookieToken(null);
});

describe("GET /api/auth/session", () => {
  it("surfaces the authed user's username + role from the verified JWT", async () => {
    setCookieToken(await signSession("admin", { userId: 7, username: "amy" }));
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ authenticated: true, username: "amy", role: "admin" });
  });

  it("returns authenticated:false with null username/role when there is no cookie", async () => {
    setCookieToken(null);
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ authenticated: false, username: null, role: null });
  });

  it("returns authenticated:false for a token signed with the wrong secret", async () => {
    const bad = await new SignJWT({ authenticated: true, role: "superadmin", username: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-totally-different-secret-value-1234567890"));
    setCookieToken(bad);
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ authenticated: false, username: null, role: null });
  });

  it("open mode (requireLogin===false) -> superadmin with no token read", async () => {
    mockGetSettings.mockResolvedValue({ requireLogin: false });
    setCookieToken(null); // no cookie, yet open mode treats owner as superadmin
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ authenticated: true, username: null, role: "superadmin" });
  });

  it("never leaks the token or extra claims (only authenticated/username/role)", async () => {
    setCookieToken(await signSession("user", { userId: 3, username: "bob", secretClaim: "nope" }));
    const res = await GET();
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(["authenticated", "role", "username"]);
    expect(data.role).toBe("user");
    expect(JSON.stringify(data)).not.toContain("nope");
    expect(JSON.stringify(data)).not.toContain("auth_token");
  });

  it("normalizes a non-string username/role to null", async () => {
    // authenticated:true but role omitted -> role should surface as null.
    const token = await new SignJWT({ authenticated: true, userId: 9 })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(SECRET);
    setCookieToken(token);
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ authenticated: true, username: null, role: null });
  });
});
