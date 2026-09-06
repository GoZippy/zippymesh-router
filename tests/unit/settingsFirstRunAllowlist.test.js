/**
 * PATCH /api/settings — the first-run auth bypass is now one key wide.
 *
 * THE BUG (adversarial review 2026-08-30, item 1a): the route skips its auth
 * gate while `firstRun` is true so the setup wizard can set the initial
 * password without a session. That bypass covered EVERY key in
 * PATCH_ALLOWED_KEYS, and `firstRun` also exempted the admin-role gate — so on
 * a fresh install, before setup completed, an unauthenticated caller could send
 * `{requireLogin:false}` and turn the whole dashboard open, or write any other
 * system setting.
 *
 * The wizard sends exactly `{newPassword}` (src/app/setup/page.js:146-150) and
 * then logs in for the rest of the flow, so narrowing the bypass to
 * FIRST_RUN_ALLOWED_KEYS = {newPassword, currentPassword} costs it nothing.
 *
 * Only localDb and the auth middleware are mocked; the real route handler runs.
 * tests/unit/settingsPasswordRecovery.test.js pins the recovery path this must
 * not disturb.
 *
 * Run ONLY: npx vitest run tests/unit/settingsFirstRunAllowlist.test.js
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockGetFirstRun = vi.fn();
const mockWriteAuditLog = vi.fn();
vi.mock("@/lib/localDb", () => ({
  getSettings: (...a) => mockGetSettings(...a),
  updateSettings: (...a) => mockUpdateSettings(...a),
  getFirstRun: (...a) => mockGetFirstRun(...a),
  writeAuditLog: (...a) => mockWriteAuditLog(...a),
}));

const mockCheckAuth = vi.fn();
const mockGetSessionClaims = vi.fn();
vi.mock("@/lib/auth/middleware.js", () => ({
  checkAuth: (...a) => mockCheckAuth(...a),
  getSessionClaims: (...a) => mockGetSessionClaims(...a),
}));

import * as settingsRoute from "../../src/app/api/settings/route.js";

function patchRequest(body) {
  return { headers: { get: () => null }, json: async () => body };
}

/** Fresh install: firstRun flag set AND no password hash stored. */
function freshInstall() {
  mockGetFirstRun.mockResolvedValue(true);
  mockGetSettings.mockResolvedValue({ password: undefined, requireLogin: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAuth.mockResolvedValue(false); // unauthenticated by default
  mockGetSessionClaims.mockResolvedValue(null);
  mockUpdateSettings.mockImplementation(async (u) => ({ ...u }));
});

describe("unauthenticated first-run PATCH", () => {
  it("accepts {newPassword} — the wizard's only write", async () => {
    freshInstall();
    const res = await settingsRoute.PATCH(patchRequest({ newPassword: "first-run-password" }));
    expect(res.status).toBe(200);
    expect(mockUpdateSettings).toHaveBeenCalled();
    // The plaintext is hashed and both password fields are stripped.
    const written = mockUpdateSettings.mock.calls[0][0];
    expect(written.newPassword).toBeUndefined();
    expect(written.currentPassword).toBeUndefined();
    expect(written.password).toMatch(/^\$2[aby]\$/);
  });

  it("accepts {newPassword, currentPassword} — the recovery shape", async () => {
    freshInstall();
    const res = await settingsRoute.PATCH(
      patchRequest({ newPassword: "recovered", currentPassword: "whatever" })
    );
    expect(res.status).toBe(200);
  });

  it("REGRESSION: rejects {requireLogin:false} with 401 instead of writing it", async () => {
    freshInstall();
    const res = await settingsRoute.PATCH(patchRequest({ requireLogin: false }));
    expect(res.status).toBe(401);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("rejects a password write that SMUGGLES a system key alongside it", async () => {
    freshInstall();
    const res = await settingsRoute.PATCH(
      patchRequest({ newPassword: "pw", requireLogin: false })
    );
    expect(res.status).toBe(401);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("rejects every other writable key during first run", async () => {
    for (const body of [
      { requireApiKey: false },
      { routingMode: "manual" },
      { theme: "dark" },
      { ollamaUrl: "http://attacker.example/" },
      { isDemoMode: true },
      {},
    ]) {
      freshInstall();
      mockUpdateSettings.mockClear();
      const res = await settingsRoute.PATCH(patchRequest(body));
      expect(res.status, JSON.stringify(body)).toBe(401);
      expect(mockUpdateSettings, JSON.stringify(body)).not.toHaveBeenCalled();
    }
  });
});

describe("authenticated writes are unchanged", () => {
  it("an admin may still set requireLogin:false after setup", async () => {
    mockGetFirstRun.mockResolvedValue(false);
    mockGetSettings.mockResolvedValue({ password: "$2b$10$hash", requireLogin: true });
    mockCheckAuth.mockResolvedValue(true);
    mockGetSessionClaims.mockResolvedValue({ role: "superadmin" });

    const res = await settingsRoute.PATCH(patchRequest({ requireLogin: false }));
    expect(res.status).toBe(200);
    expect(mockUpdateSettings).toHaveBeenCalledWith({ requireLogin: false });
  });

  it("an admin may set a system key while the firstRun flag is still set", async () => {
    // The wizard logs in right after step 0, so this is the shape of every
    // later wizard/dashboard write before /api/setup/complete runs.
    mockGetFirstRun.mockResolvedValue(true);
    mockGetSettings.mockResolvedValue({ password: "$2b$10$hash", requireLogin: true });
    mockCheckAuth.mockResolvedValue(true);
    mockGetSessionClaims.mockResolvedValue({ role: "superadmin" });

    const res = await settingsRoute.PATCH(patchRequest({ routingMode: "auto" }));
    expect(res.status).toBe(200);
  });

  it("a non-admin session is still 403 on a system key, not 401", async () => {
    mockGetFirstRun.mockResolvedValue(false);
    mockGetSettings.mockResolvedValue({ password: "$2b$10$hash", requireLogin: true });
    mockCheckAuth.mockResolvedValue(true);
    mockGetSessionClaims.mockResolvedValue({ role: "viewer" });

    const res = await settingsRoute.PATCH(patchRequest({ requireLogin: false }));
    expect(res.status).toBe(403);
  });

  it("an unknown key is still a 400, not a 401, for an authenticated caller", async () => {
    mockGetFirstRun.mockResolvedValue(false);
    mockGetSettings.mockResolvedValue({ password: "$2b$10$hash", requireLogin: true });
    mockCheckAuth.mockResolvedValue(true);
    mockGetSessionClaims.mockResolvedValue({ role: "superadmin" });

    const res = await settingsRoute.PATCH(patchRequest({ nodeIdentity: { privateKey: "x" } }));
    expect(res.status).toBe(400);
  });
});
