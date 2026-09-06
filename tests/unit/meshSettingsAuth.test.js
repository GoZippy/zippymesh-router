/**
 * Security regression test for POST /api/settings/mesh (security fix F2).
 *
 * meshMode/meshAllowlist are system-sensitive keys. The dedicated mesh route
 * writes them directly via updateSettings(), bypassing the PATCH /api/settings
 * role gate — so it was wrapped with requireRole('admin'). This test drives the
 * REAL requireRole wrapper on the REAL route handler, mocking only:
 *   - next/headers cookies()  -> serve a JWT we sign in-test (jose verify runs)
 *   - localDb getSettings()/updateSettings() -> control requireLogin + capture writes
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-that-is-definitely-long-enough-0123456789";
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: (...a) => mockGetSettings(...a),
  updateSettings: (...a) => mockUpdateSettings(...a),
}));

import * as meshRoute from "../../src/app/api/settings/mesh/route.js";

async function signSession(role) {
  return new SignJWT({ authenticated: true, role, userId: `${role}-1` })
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
function meshRequest(body) {
  return {
    headers: { get: () => null },
    json: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({ requireLogin: true });
  mockUpdateSettings.mockImplementation(async (u) => ({
    meshMode: u.meshMode ?? "private",
    meshAllowlist: u.meshAllowlist ?? [],
  }));
  setCookieToken(null);
});

describe("POST /api/settings/mesh — admin+ role gate (F2 fix)", () => {
  it("rejects a viewer with 403 and never writes", async () => {
    setCookieToken(await signSession("viewer"));
    const res = await meshRoute.POST(meshRequest({ meshMode: "public" }));
    expect(res.status).toBe(403);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("rejects a plain user with 403 and never writes", async () => {
    setCookieToken(await signSession("user"));
    const res = await meshRoute.POST(meshRequest({ meshAllowlist: ["evil-node"] }));
    expect(res.status).toBe(403);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401 when login is required", async () => {
    setCookieToken(null);
    const res = await meshRoute.POST(meshRequest({ meshMode: "public" }));
    expect(res.status).toBe(401);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("allows an admin to set meshMode (200) and writes", async () => {
    setCookieToken(await signSession("admin"));
    const res = await meshRoute.POST(meshRequest({ meshMode: "cluster" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.meshMode).toBe("cluster");
    expect(mockUpdateSettings).toHaveBeenCalledWith({ meshMode: "cluster" });
  });

  it("treats open mode (requireLogin=false) as superadmin and allows the write", async () => {
    mockGetSettings.mockResolvedValue({ requireLogin: false });
    setCookieToken(null);
    const res = await meshRoute.POST(meshRequest({ meshMode: "private" }));
    const data = await res.json();
    expect(data.meshMode).toBe("private");
    expect(mockUpdateSettings).toHaveBeenCalled();
  });
});
