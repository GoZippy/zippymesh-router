/**
 * Security regression test: the vault routes must enforce route-level session
 * auth (not rely solely on the edge, which cannot check key revocation).
 * GET /api/vault/entries/[name] returns DECRYPTED secrets, so an unauthenticated
 * request must be rejected and must NEVER reach readVaultEntry().
 *
 * Mocks only the auth/settings/vault seams; the REAL requireAuth + jose verify run.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-that-is-definitely-long-enough-0123456789";
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));

const mockGetSettings = vi.fn();
vi.mock("../../src/lib/localDb.js", () => ({ getSettings: (...a) => mockGetSettings(...a) }));

const vault = {
  listVaultEntries: vi.fn(() => [{ name: "x", label: "X" }]),
  storeVaultEntry: vi.fn(() => ({ ok: true })),
  isVaultUnlocked: vi.fn(() => true),
  readVaultEntry: vi.fn(() => ({ ok: true, value: "SUPER-SECRET" })),
  deleteVaultEntry: vi.fn(() => ({ deleted: true })),
};
// Defer access to `vault` to call-time (avoids TDZ when the hoisted factory runs
// during the route's import — same pattern as the localDb getSettings mock above).
vi.mock("../../src/lib/vault.js", () => ({
  listVaultEntries: (...a) => vault.listVaultEntries(...a),
  storeVaultEntry: (...a) => vault.storeVaultEntry(...a),
  isVaultUnlocked: (...a) => vault.isVaultUnlocked(...a),
  readVaultEntry: (...a) => vault.readVaultEntry(...a),
  deleteVaultEntry: (...a) => vault.deleteVaultEntry(...a),
}));

import * as entriesRoute from "../../src/app/api/vault/entries/route.js";
import * as nameRoute from "../../src/app/api/vault/entries/[name]/route.js";

function setCookieToken(token) {
  cookieStore.get.mockImplementation((n) => (n === "auth_token" && token ? { value: token } : undefined));
}
function req() {
  return { headers: { get: () => null }, json: async () => ({}) };
}
async function authedToken() {
  return new SignJWT({ authenticated: true, role: "admin", userId: "u1" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({ requireLogin: true });
  vault.isVaultUnlocked.mockReturnValue(true);
  vault.readVaultEntry.mockReturnValue({ ok: true, value: "SUPER-SECRET" });
  vault.listVaultEntries.mockReturnValue([{ name: "x", label: "X" }]);
  setCookieToken(null);
});

describe("vault routes require session auth (F-1 hardening)", () => {
  it("GET /api/vault/entries/[name] WITHOUT a session -> 401, decrypted value never read", async () => {
    const res = await nameRoute.GET(req(), { params: { name: "x" } });
    expect(res.status).toBe(401);
    expect(vault.readVaultEntry).not.toHaveBeenCalled(); // no secret leak
  });

  it("GET /api/vault/entries/[name] WITH a valid session -> returns the value", async () => {
    setCookieToken(await authedToken());
    const res = await nameRoute.GET(req(), { params: { name: "x" } });
    const data = await res.json();
    expect(vault.readVaultEntry).toHaveBeenCalledWith("x");
    expect(data.value).toBe("SUPER-SECRET");
  });

  it("GET /api/vault/entries (list) WITHOUT a session -> 401", async () => {
    const res = await entriesRoute.GET(req(), {});
    expect(res.status).toBe(401);
    expect(vault.listVaultEntries).not.toHaveBeenCalled();
  });

  it("POST /api/vault/entries WITHOUT a session -> 401, nothing stored", async () => {
    const res = await entriesRoute.POST(req(), {});
    expect(res.status).toBe(401);
    expect(vault.storeVaultEntry).not.toHaveBeenCalled();
  });

  it("DELETE /api/vault/entries/[name] WITHOUT a session -> 401", async () => {
    const res = await nameRoute.DELETE(req(), { params: { name: "x" } });
    expect(res.status).toBe(401);
    expect(vault.deleteVaultEntry).not.toHaveBeenCalled();
  });

  it("open mode (requireLogin=false) still allows the authed handler through", async () => {
    mockGetSettings.mockResolvedValue({ requireLogin: false });
    const res = await nameRoute.GET(req(), { params: { name: "x" } });
    const data = await res.json();
    expect(data.value).toBe("SUPER-SECRET"); // local-first single-user (now loopback-bound by default)
  });
});
