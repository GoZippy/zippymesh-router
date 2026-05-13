/**
 * Unit tests for src/sse/services/auth.js — getProviderCredentials()
 *
 * The function is tightly coupled to localDb and getSettings, so both are
 * fully mocked. No real DB connections are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — use vi.hoisted() so references are available inside
// vi.mock() factory functions (which are hoisted to top of file by vitest).
// ---------------------------------------------------------------------------

const { mockGetProviderConnections, mockUpdateProviderConnection, mockGetSettings } = vi.hoisted(() => ({
  mockGetProviderConnections: vi.fn(),
  mockUpdateProviderConnection: vi.fn().mockResolvedValue(undefined),
  mockGetSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mockGetProviderConnections,
  updateProviderConnection: mockUpdateProviderConnection,
  getSettings: mockGetSettings,
}));

// Mock the accountFallback helpers used inside auth.js
// (imported from open-sse/services/accountFallback.js)
// We let the real implementations run — they are pure and already tested.
// No additional mock needed here.

// Suppress logger output during tests
vi.mock("../utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Import the module AFTER mocks are declared
import { getProviderCredentials } from "../../src/sse/services/auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal active connection */
function makeConnection(overrides = {}) {
  return {
    id: "conn-" + Math.random().toString(36).slice(2, 8),
    provider: "openai",
    isActive: true,
    priority: 10,
    apiKey: "sk-test",
    accessToken: null,
    refreshToken: null,
    rateLimitedUntil: null,
    consecutiveUseCount: 0,
    lastUsedAt: null,
    testStatus: "active",
    lastError: null,
    providerSpecificData: null,
    ...overrides,
  };
}

/** ISO timestamp N milliseconds in the future */
function futureISO(ms) {
  return new Date(Date.now() + ms).toISOString();
}

/** ISO timestamp N milliseconds in the past */
function pastISO(ms) {
  return new Date(Date.now() - ms).toISOString();
}

const DEFAULT_SETTINGS = { fallbackStrategy: "fill-first", stickyRoundRobinLimit: 3 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getProviderCredentials()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getSettings returns fill-first strategy
    mockGetSettings.mockResolvedValue(DEFAULT_SETTINGS);
  });

  // ---- no connections at all ----

  it("returns null when no connections exist for the provider", async () => {
    // Both the active query and the all-connections query return empty
    mockGetProviderConnections.mockResolvedValue([]);

    const result = await getProviderCredentials("openai");
    expect(result).toBeNull();
  });

  // ---- all connections rate limited ----

  it("returns allRateLimited=true when all active connections are rate limited", async () => {
    const rateLimited = makeConnection({
      rateLimitedUntil: futureISO(60 * 1000),
    });

    // First call (active) returns the rate-limited connection
    // Second call (all) is not reached in this path since active > 0
    mockGetProviderConnections.mockResolvedValue([rateLimited]);

    const result = await getProviderCredentials("openai");

    expect(result).not.toBeNull();
    expect(result.allRateLimited).toBe(true);
    expect(typeof result.retryAfter).toBe("string");
  });

  it("returns allRateLimited=true when active connections are empty but all connections are rate limited", async () => {
    const rateLimited = makeConnection({
      isActive: false,
      rateLimitedUntil: futureISO(60 * 1000),
    });

    // First call: active filter → 0 connections
    // Second call: no filter → 1 connection (the rate-limited one)
    mockGetProviderConnections
      .mockResolvedValueOnce([])      // { provider, isActive: true }
      .mockResolvedValueOnce([rateLimited]); // { provider } — all connections

    const result = await getProviderCredentials("openai");

    expect(result).not.toBeNull();
    expect(result.allRateLimited).toBe(true);
  });

  // ---- fill-first strategy (default) ----

  it("returns the highest-priority (lowest number) available connection in fill-first mode", async () => {
    const connHigh = makeConnection({ id: "conn-high", priority: 1, apiKey: "key-high" });
    const connLow = makeConnection({ id: "conn-low", priority: 99, apiKey: "key-low" });

    // getProviderConnections already returns sorted by priority (ascending) per the DB contract
    mockGetProviderConnections.mockResolvedValue([connHigh, connLow]);

    const result = await getProviderCredentials("openai");

    expect(result).not.toBeNull();
    expect(result.apiKey).toBe("key-high");
    expect(result.connectionId).toBe("conn-high");
  });

  it("excludes the specified excludeConnectionId", async () => {
    const connA = makeConnection({ id: "conn-a", apiKey: "key-a", priority: 1 });
    const connB = makeConnection({ id: "conn-b", apiKey: "key-b", priority: 2 });

    mockGetProviderConnections.mockResolvedValue([connA, connB]);

    const result = await getProviderCredentials("openai", "conn-a");

    expect(result).not.toBeNull();
    expect(result.connectionId).toBe("conn-b");
    expect(result.apiKey).toBe("key-b");
  });

  it("skips connections whose rateLimitedUntil is in the future", async () => {
    const rateLimited = makeConnection({
      id: "conn-limited",
      apiKey: "key-limited",
      priority: 1,
      rateLimitedUntil: futureISO(60 * 1000),
    });
    const available = makeConnection({
      id: "conn-ok",
      apiKey: "key-ok",
      priority: 2,
    });

    mockGetProviderConnections.mockResolvedValue([rateLimited, available]);

    const result = await getProviderCredentials("openai");

    expect(result).not.toBeNull();
    expect(result.connectionId).toBe("conn-ok");
  });

  it("includes connections whose rateLimitedUntil has already expired", async () => {
    const recovered = makeConnection({
      id: "conn-recovered",
      apiKey: "key-recovered",
      rateLimitedUntil: pastISO(60 * 1000), // expired in the past
    });

    mockGetProviderConnections.mockResolvedValue([recovered]);

    const result = await getProviderCredentials("openai");

    expect(result).not.toBeNull();
    expect(result.connectionId).toBe("conn-recovered");
  });

  // ---- round-robin strategy ----

  it("stays with the current connection when consecutiveUseCount < stickyRoundRobinLimit", async () => {
    mockGetSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 3,
    });

    const current = makeConnection({
      id: "conn-current",
      apiKey: "key-current",
      lastUsedAt: new Date().toISOString(),
      consecutiveUseCount: 1, // below limit of 3
    });
    const other = makeConnection({
      id: "conn-other",
      apiKey: "key-other",
      lastUsedAt: pastISO(5 * 60 * 1000),
      consecutiveUseCount: 0,
    });

    mockGetProviderConnections.mockResolvedValue([current, other]);

    const result = await getProviderCredentials("openai");

    // Should stay with current (most recently used and count < limit)
    expect(result.connectionId).toBe("conn-current");
  });

  it("switches to least-recently-used when consecutiveUseCount >= stickyRoundRobinLimit", async () => {
    mockGetSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 3,
    });

    const exhausted = makeConnection({
      id: "conn-exhausted",
      apiKey: "key-exhausted",
      lastUsedAt: new Date().toISOString(),
      consecutiveUseCount: 3, // at the limit
    });
    const idle = makeConnection({
      id: "conn-idle",
      apiKey: "key-idle",
      lastUsedAt: pastISO(10 * 60 * 1000), // used 10 minutes ago
      consecutiveUseCount: 0,
    });

    mockGetProviderConnections.mockResolvedValue([exhausted, idle]);

    const result = await getProviderCredentials("openai");

    // Should switch to the least-recently-used (idle) connection
    expect(result.connectionId).toBe("conn-idle");
  });

  // ---- return shape ----

  it("returns the expected credential fields when a connection is found", async () => {
    const conn = makeConnection({
      id: "conn-xyz",
      apiKey: "api-key-value",
      accessToken: "at-value",
      refreshToken: "rt-value",
      projectId: "proj-123",
      providerSpecificData: { copilotToken: "copilot-tok" },
    });

    mockGetProviderConnections.mockResolvedValue([conn]);

    const result = await getProviderCredentials("openai");

    expect(result.apiKey).toBe("api-key-value");
    expect(result.accessToken).toBe("at-value");
    expect(result.refreshToken).toBe("rt-value");
    expect(result.projectId).toBe("proj-123");
    expect(result.copilotToken).toBe("copilot-tok");
    expect(result.connectionId).toBe("conn-xyz");
  });
});
