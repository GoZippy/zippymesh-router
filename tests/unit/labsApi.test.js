/**
 * Tests for the /api/labs route: requireAuth gating + catalog-validated writes.
 * Mocks the auth/settings seams; the REAL requireAuth + jose verify run.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-that-is-definitely-long-enough-0123456789";
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));

const store = { settings: { requireLogin: true, experimentalFeatures: {} } };
const mockGetSettings = vi.fn(async () => store.settings);
const mockUpdateSettings = vi.fn(async (patch) => {
  store.settings = { ...store.settings, ...patch };
  return store.settings;
});
vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: (...a) => mockGetSettings(...a),
  updateSettings: (...a) => mockUpdateSettings(...a),
}));

import * as labsRoute from "../../src/app/api/labs/route.js";

function setCookieToken(token) {
  cookieStore.get.mockImplementation((n) => (n === "auth_token" && token ? { value: token } : undefined));
}
function req(body) {
  return { headers: { get: () => null }, json: async () => body };
}
async function token() {
  return new SignJWT({ authenticated: true, role: "admin", userId: "u1" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
  store.settings = { requireLogin: true, experimentalFeatures: {} };
  setCookieToken(null);
});

describe("/api/labs auth", () => {
  it("GET without a session -> 401", async () => {
    const res = await labsRoute.GET(req(), {});
    expect(res.status).toBe(401);
  });
  it("PATCH without a session -> 401, nothing written", async () => {
    const res = await labsRoute.PATCH(req({ mesh: true }), {});
    expect(res.status).toBe(401);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });
});

describe("/api/labs with a session", () => {
  beforeEach(async () => setCookieToken(await token()));

  it("GET returns the catalog + defaults-merged flags", async () => {
    const res = await labsRoute.GET(req(), {});
    const data = await res.json();
    expect(Array.isArray(data.features)).toBe(true);
    expect(data.flags.mesh).toBe(false); // default OFF
  });

  it("PATCH enables a known feature and persists it", async () => {
    const res = await labsRoute.PATCH(req({ mesh: true }), {});
    const data = await res.json();
    expect(data.flags.mesh).toBe(true);
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      experimentalFeatures: expect.objectContaining({ mesh: true }),
    });
  });

  it("PATCH accepts the { experimentalFeatures: {...} } envelope too", async () => {
    const res = await labsRoute.PATCH(req({ experimentalFeatures: { wallet: true } }), {});
    const data = await res.json();
    expect(data.flags.wallet).toBe(true);
  });

  it("PATCH ignores unknown keys -> 400 when nothing known is provided", async () => {
    const res = await labsRoute.PATCH(req({ evilFeature: true }), {});
    expect(res.status).toBe(400);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("PATCH merges, preserving previously-enabled features", async () => {
    store.settings.experimentalFeatures = { mesh: true };
    const res = await labsRoute.PATCH(req({ wallet: true }), {});
    const data = await res.json();
    expect(data.flags.mesh).toBe(true);
    expect(data.flags.wallet).toBe(true);
  });
});
