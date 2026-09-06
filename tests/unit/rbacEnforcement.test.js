/**
 * Unit tests for USER-ACCOUNT RBAC enforcement (Sprint 3,
 * task admin-rbac-enforcement; PORT_AND_ADMIN_SYSTEM_PLAN.md §3c).
 *
 * Two layers are exercised:
 *
 *   1. Pure helpers in src/lib/auth/rbac.js — hasUserRole() across the 4-role
 *      hierarchy and canAssignRole() escalation rules. No mocking needed.
 *
 *   2. The role-aware route wrappers in src/lib/auth/middleware.js —
 *      requireRole() / requireSuperadmin(). These touch I/O (settings + the
 *      auth_token cookie), so we keep the test hermetic by mocking exactly two
 *      seams:
 *        - next/headers cookies()  -> serves a JWT we sign in-test (covers BOTH
 *          checkAuth()'s isAuthenticated() and getSessionClaims(), which both
 *          read the auth_token cookie; the real jose HS256 verify path runs).
 *        - ../localDb.js getSettings() -> controls requireLogin so we can prove
 *          the open-mode (login-disabled) back-compat branch.
 *      No real network, sockets, filesystem, or DB.
 *
 * IMPORTANT: this file asserts the USER-ACCOUNT model only. It also pins that
 * the PRE-EXISTING team-key exports (ROLES / hasRole) are untouched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

// Same HS256 secret encoding login.js / middleware.js use (env-driven, lazy).
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

// Imports AFTER the mocks are declared.
import {
  USER_ROLES,
  USER_ROLE_LEVELS,
  hasUserRole,
  canAssignRole,
  ROLES,
  hasRole,
} from "../../src/lib/auth/rbac.js";
import {
  getSessionClaims,
  requireRole,
  requireSuperadmin,
} from "../../src/lib/auth/middleware.js";

/** Sign an auth_token JWT carrying a user-account role. */
async function signSession(role, extra = {}) {
  return new SignJWT({ authenticated: true, role, ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(SECRET);
}

/** Point the mocked cookie jar at a token (or clear it). */
function setCookieToken(token) {
  cookieStore.get.mockImplementation((name) =>
    name === "auth_token" && token ? { value: token } : undefined
  );
}

/** A minimal fake request the wrappers can read headers from. */
function fakeRequest(headers = {}) {
  const h = new Map(Object.entries(headers));
  return { headers: { get: (k) => h.get(k) ?? null } };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: login required (the secure, role-enforcing mode).
  mockGetSettings.mockResolvedValue({ requireLogin: true });
  setCookieToken(null);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("hasUserRole() — superadmin > admin > user > viewer", () => {
  const order = ["superadmin", "admin", "user", "viewer"];

  it("levels are strictly descending and unique", () => {
    const levels = order.map((r) => USER_ROLE_LEVELS[r]);
    expect(levels).toEqual([4, 3, 2, 1]);
    expect(new Set(levels).size).toBe(4);
  });

  it("a role satisfies its own level and every level below it", () => {
    for (let i = 0; i < order.length; i++) {
      const actual = order[i];
      for (let j = 0; j < order.length; j++) {
        const required = order[j];
        // actual satisfies required iff actual is at-or-above required.
        expect(hasUserRole(actual, required)).toBe(i <= j);
      }
    }
  });

  it("spot-checks key cells of the role × requirement matrix", () => {
    expect(hasUserRole("superadmin", "superadmin")).toBe(true);
    expect(hasUserRole("admin", "superadmin")).toBe(false);
    expect(hasUserRole("admin", "admin")).toBe(true);
    expect(hasUserRole("user", "admin")).toBe(false);
    expect(hasUserRole("viewer", "user")).toBe(false);
    expect(hasUserRole("superadmin", "viewer")).toBe(true);
  });

  it("fails closed on unknown / missing roles", () => {
    expect(hasUserRole(undefined, "viewer")).toBe(false);
    expect(hasUserRole(null, "viewer")).toBe(false);
    expect(hasUserRole("wizard", "viewer")).toBe(false);
    // Unknown REQUIRED role can never be satisfied (sentinel above the top).
    expect(hasUserRole("superadmin", "godmode")).toBe(false);
  });
});

describe("canAssignRole() — privilege-escalation rules", () => {
  it("superadmin may assign ANY valid role", () => {
    for (const target of Object.values(USER_ROLES)) {
      expect(canAssignRole("superadmin", target)).toBe(true);
    }
  });

  it("admin may assign user/viewer but NOT admin or superadmin", () => {
    expect(canAssignRole("admin", "user")).toBe(true);
    expect(canAssignRole("admin", "viewer")).toBe(true);
    expect(canAssignRole("admin", "admin")).toBe(false); // no peer escalation
    expect(canAssignRole("admin", "superadmin")).toBe(false); // no upward escalation
  });

  it("user and viewer may never assign roles", () => {
    for (const actor of ["user", "viewer"]) {
      for (const target of Object.values(USER_ROLES)) {
        expect(canAssignRole(actor, target)).toBe(false);
      }
    }
  });

  it("fails closed on unknown actor or unknown target role", () => {
    expect(canAssignRole("wizard", "user")).toBe(false);
    expect(canAssignRole("superadmin", "godmode")).toBe(false);
    expect(canAssignRole(undefined, "user")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getSessionClaims() — decodes the verified session JWT", () => {
  it("returns the full payload for a valid token", async () => {
    setCookieToken(await signSession("admin", { userId: 7, username: "amy" }));
    const claims = await getSessionClaims();
    expect(claims).not.toBeNull();
    expect(claims.authenticated).toBe(true);
    expect(claims.role).toBe("admin");
    expect(claims.userId).toBe(7);
    expect(claims.username).toBe("amy");
  });

  it("returns null when there is no cookie", async () => {
    setCookieToken(null);
    expect(await getSessionClaims()).toBeNull();
  });

  it("returns null for a token signed with the wrong secret (bad signature)", async () => {
    const badToken = await new SignJWT({ authenticated: true, role: "superadmin" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("a-totally-different-secret-value-1234567890"));
    setCookieToken(badToken);
    expect(await getSessionClaims()).toBeNull();
  });

  it("returns null when authenticated is not strictly true", async () => {
    const token = await new SignJWT({ authenticated: false, role: "superadmin" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(SECRET);
    setCookieToken(token);
    expect(await getSessionClaims()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("requireRole() / requireSuperadmin() — route enforcement", () => {
  // Inspect the wrapper's outcome via HTTP status; 200 means the handler ran.
  const handler = vi.fn(async () => new Response("ok", { status: 200 }));

  beforeEach(() => handler.mockClear());

  async function callWith(wrapper, role) {
    setCookieToken(role ? await signSession(role) : null);
    const res = await wrapper(fakeRequest());
    return res.status;
  }

  it("requireSuperadmin: only superadmin reaches the handler", async () => {
    const guarded = requireSuperadmin(handler);

    expect(await callWith(guarded, "superadmin")).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);

    handler.mockClear();
    for (const role of ["admin", "user", "viewer"]) {
      expect(await callWith(guarded, role)).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("requireRole('admin'): admin+ pass, user/viewer get 403", async () => {
    const guarded = requireRole(USER_ROLES.ADMIN, handler);

    expect(await callWith(guarded, "superadmin")).toBe(200);
    expect(await callWith(guarded, "admin")).toBe(200);

    handler.mockClear();
    expect(await callWith(guarded, "user")).toBe(403);
    expect(await callWith(guarded, "viewer")).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 (not 403) when login is required but no/invalid session", async () => {
    const guarded = requireSuperadmin(handler);
    // No cookie at all -> checkAuth() fails -> 401 before the role check.
    setCookieToken(null);
    const res = await guarded(fakeRequest());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed: an unknown role in a valid token is rejected (403)", async () => {
    const guarded = requireRole(USER_ROLES.ADMIN, handler);
    setCookieToken(await signSession("wizard"));
    const res = await guarded(fakeRequest());
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("back-compat: requireLogin===false treats caller as superadmin (open mode)", async () => {
    mockGetSettings.mockResolvedValue({ requireLogin: false });
    const guarded = requireSuperadmin(handler);
    // No session cookie present, yet open mode must not lock out single-user installs.
    setCookieToken(null);
    const res = await guarded(fakeRequest());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("team-key RBAC left intact (regression guard)", () => {
  it("ROLES / hasRole still describe admin > operator > viewer", () => {
    expect(ROLES).toEqual({ ADMIN: "admin", OPERATOR: "operator", VIEWER: "viewer" });
    expect(hasRole("admin", "viewer")).toBe(true);
    expect(hasRole("operator", "admin")).toBe(false);
    // The team-key model has NO 'superadmin' tier — proving it is distinct from
    // the user-account model.
    expect(hasRole("superadmin", "admin")).toBe(false);
  });
});
