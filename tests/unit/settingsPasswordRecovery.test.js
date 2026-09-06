/**
 * Regression test for the PATCH /api/settings password-recovery deadlock.
 *
 * Bug: the `firstRun` DB flag and `hasPassword` (settings.password truthiness)
 * can drift apart — e.g. the password field gets cleared/migrated without
 * resetting `firstRun` back to true. When that happens:
 *   - the /login page redirects to /setup based on hasPassword===false
 *   - but PATCH /api/settings gated purely on firstRun===false, so /setup's
 *     own unauthenticated newPassword write was rejected with 401
 * ...permanently locking the instance out with no way to create a session.
 *
 * Fix: the gate now also treats "no password stored yet" as first-run,
 * regardless of the persisted firstRun flag. This test drives the REAL route
 * handler, mocking only localDb and the auth middleware.
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
  return {
    headers: { get: () => null },
    json: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAuth.mockResolvedValue(false);
  mockUpdateSettings.mockImplementation(async (u) => ({ ...u }));
});

describe("PATCH /api/settings — password-recovery deadlock (regression)", () => {
  it("allows an unauthenticated newPassword write when firstRun=false but no password is stored", async () => {
    mockGetFirstRun.mockResolvedValue(false);
    mockGetSettings.mockResolvedValue({ password: undefined });

    const res = await settingsRoute.PATCH(patchRequest({ newPassword: "fresh-password-123" }));

    expect(res.status).toBe(200);
    expect(mockUpdateSettings).toHaveBeenCalled();
  });

  it("still rejects an unauthenticated write when a password IS already stored (security preserved)", async () => {
    mockGetFirstRun.mockResolvedValue(false);
    mockGetSettings.mockResolvedValue({ password: "$2b$10$existingHashHere" });

    const res = await settingsRoute.PATCH(patchRequest({ newPassword: "attacker-chosen" }));

    expect(res.status).toBe(401);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("still allows real first-run setup (firstRun=true, no password) unauthenticated", async () => {
    mockGetFirstRun.mockResolvedValue(true);
    mockGetSettings.mockResolvedValue({ password: undefined });

    const res = await settingsRoute.PATCH(patchRequest({ newPassword: "first-run-password" }));

    expect(res.status).toBe(200);
    expect(mockUpdateSettings).toHaveBeenCalled();
  });

  it("still requires an authenticated session for non-password writes once a password exists", async () => {
    mockGetFirstRun.mockResolvedValue(false);
    mockGetSettings.mockResolvedValue({ password: "$2b$10$existingHashHere" });

    const res = await settingsRoute.PATCH(patchRequest({ theme: "dark" }));

    expect(res.status).toBe(401);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });
});
