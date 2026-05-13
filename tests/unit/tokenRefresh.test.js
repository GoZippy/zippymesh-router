/**
 * Unit tests for src/lib/oauth/utils/refresh.js
 *
 * Tests refreshOAuthToken() and isTokenExpired() without making real HTTP calls.
 * fetch is replaced with a vi.fn() mock for each test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

// Mock the DB update so no real SQLite write happens
vi.mock("../../src/lib/localDb.js", () => ({
  updateProviderConnection: vi.fn().mockResolvedValue(undefined),
}));

// Mock secrets resolver — return null (no client secret needed for most tests)
vi.mock("../../src/lib/oauth/utils/secrets.js", () => ({
  resolveOAuthClientSecret: vi.fn().mockResolvedValue(null),
}));

// Import after mocks are in place
import { refreshOAuthToken, isTokenExpired } from "../../src/lib/oauth/utils/refresh.js";
import { updateProviderConnection } from "../../src/lib/localDb.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal connection object for a given provider */
function makeConnection(provider, overrides = {}) {
  return {
    id: "test-conn-id",
    provider,
    refreshToken: "valid-refresh-token",
    accessToken: "old-access-token",
    expiresAt: null,
    ...overrides,
  };
}

/** Build a fetch mock that returns a JSON response with the given status */
function makeFetchMock(status, body) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

/** Build a fetch mock that rejects with a network error */
function makeNetworkErrorMock(message = "Network failure") {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ---------------------------------------------------------------------------
// refreshOAuthToken — token refresh for a gemini-cli provider
// ---------------------------------------------------------------------------

describe("refreshOAuthToken()", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls the refresh endpoint and returns the new access token on success", async () => {
    global.fetch = makeFetchMock(200, {
      access_token: "new-access-token",
      expires_in: 3600,
      refresh_token: "new-refresh-token",
    });

    const connection = makeConnection("gemini-cli");
    const result = await refreshOAuthToken(connection);

    expect(result).toBe("new-access-token");
    expect(global.fetch).toHaveBeenCalledOnce();

    // Verify DB was updated with the new token data
    expect(updateProviderConnection).toHaveBeenCalledOnce();
    const [connId, updateData] = updateProviderConnection.mock.calls[0];
    expect(connId).toBe("test-conn-id");
    expect(updateData.accessToken).toBe("new-access-token");
    expect(updateData.refreshToken).toBe("new-refresh-token");
    expect(typeof updateData.expiresAt).toBe("string");
  });

  it("returns null when the refresh endpoint returns 401", async () => {
    global.fetch = makeFetchMock(401, { error: "invalid_grant" });

    const connection = makeConnection("gemini-cli");
    const result = await refreshOAuthToken(connection);

    expect(result).toBeNull();
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("returns null and does not throw on a network error", async () => {
    global.fetch = makeNetworkErrorMock("Connection refused");

    const connection = makeConnection("gemini-cli");
    await expect(refreshOAuthToken(connection)).resolves.toBeNull();
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("returns null when no refresh token is present", async () => {
    global.fetch = vi.fn(); // should never be called
    const connection = makeConnection("gemini-cli", { refreshToken: null });
    const result = await refreshOAuthToken(connection);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns null for an unknown provider", async () => {
    global.fetch = vi.fn();
    const connection = makeConnection("unknown-provider-xyz");
    const result = await refreshOAuthToken(connection);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("works correctly for the 'claude' provider", async () => {
    global.fetch = makeFetchMock(200, {
      access_token: "claude-access-token",
      expires_in: 7200,
    });

    const connection = makeConnection("claude");
    const result = await refreshOAuthToken(connection);

    expect(result).toBe("claude-access-token");
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("works correctly for the 'codex' provider", async () => {
    global.fetch = makeFetchMock(200, {
      access_token: "codex-access-token",
      expires_in: 3600,
    });

    const connection = makeConnection("codex");
    const result = await refreshOAuthToken(connection);

    expect(result).toBe("codex-access-token");
  });

  it("preserves the original refresh token when the server does not return a new one", async () => {
    global.fetch = makeFetchMock(200, {
      access_token: "new-at",
      expires_in: 3600,
      // no refresh_token in response
    });

    const connection = makeConnection("gemini-cli", { refreshToken: "original-rt" });
    await refreshOAuthToken(connection);

    const updateData = updateProviderConnection.mock.calls[0][1];
    expect(updateData.refreshToken).toBe("original-rt");
  });
});

// ---------------------------------------------------------------------------
// isTokenExpired
// ---------------------------------------------------------------------------

describe("isTokenExpired()", () => {
  it("returns true when expiresAt is in the past (well-expired token)", () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    expect(isTokenExpired({ expiresAt: pastDate })).toBe(true);
  });

  it("returns true when expiresAt is within the 5-minute buffer window", () => {
    // 3 minutes from now — inside the 5-minute buffer
    const soonDate = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    expect(isTokenExpired({ expiresAt: soonDate })).toBe(true);
  });

  it("returns false when expiresAt is 10+ minutes in the future", () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect(isTokenExpired({ expiresAt: futureDate })).toBe(false);
  });

  it("returns false when expiresAt is exactly 6 minutes away (just outside buffer)", () => {
    const slightlyFuture = new Date(Date.now() + 6 * 60 * 1000).toISOString();
    expect(isTokenExpired({ expiresAt: slightlyFuture })).toBe(false);
  });

  it("returns false when expiresAt is null — treated as 'never expires'", () => {
    // The source code (refresh.js line 189): if (!connection.expiresAt) return false
    // A null/undefined expiresAt means the token has no known expiry — NOT expired.
    expect(isTokenExpired({ expiresAt: null })).toBe(false);
  });

  it("returns false when expiresAt is undefined — treated as 'never expires'", () => {
    expect(isTokenExpired({})).toBe(false);
  });
});
