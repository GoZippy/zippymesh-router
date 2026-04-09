/**
 * Unit tests for open-sse/services/accountFallback.js
 *
 * All functions are pure (no I/O), so no mocking is required.
 * Tests verify cooldown/fallback logic and rate-limit state helpers.
 */
import { describe, it, expect } from "vitest";
import {
  checkFallbackError,
  isAccountUnavailable,
  getUnavailableUntil,
  getEarliestRateLimitedUntil,
  filterAvailableAccounts,
  resetAccountState,
  applyErrorState,
  getQuotaCooldown,
} from "../../open-sse/services/accountFallback.js";

// ---------------------------------------------------------------------------
// checkFallbackError
// ---------------------------------------------------------------------------

describe("checkFallbackError()", () => {
  it("returns shouldFallback=true and cooldown > 0 for a 429 status", () => {
    const result = checkFallbackError(429, "rate limited", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("increments backoffLevel for a 429 at level 0", () => {
    const result = checkFallbackError(429, "rate limited", 0);
    expect(result.newBackoffLevel).toBe(1);
  });

  it("returns shouldFallback=true for a 500 server error", () => {
    const result = checkFallbackError(500, "internal server error", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("returns shouldFallback=true for a 400 bad request (all errors trigger fallback)", () => {
    // Note: the source falls through to the catch-all at line 85 which returns
    // shouldFallback:true. There is no special exemption for 400 bad request.
    const result = checkFallbackError(400, "bad request", 0);
    expect(result.shouldFallback).toBe(true);
  });

  it("returns shouldFallback=true for a 401 unauthorized with a non-zero cooldown", () => {
    const result = checkFallbackError(401, "", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("returns shouldFallback=true for a 403 forbidden", () => {
    const result = checkFallbackError(403, "", 0);
    expect(result.shouldFallback).toBe(true);
  });

  it("returns shouldFallback=true for a 404 not found", () => {
    const result = checkFallbackError(404, "", 0);
    expect(result.shouldFallback).toBe(true);
  });

  it("detects rate-limit keywords in errorText even when status is not 429", () => {
    const result = checkFallbackError(200, "quota exceeded for this model", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("detects 'no credentials' error keyword", () => {
    const result = checkFallbackError(200, "no credentials available", 0);
    expect(result.shouldFallback).toBe(true);
  });

  it("applies exponential backoff: level 2 cooldown > level 0 cooldown", () => {
    const level0 = checkFallbackError(429, "", 0);
    const level2 = checkFallbackError(429, "", 2);
    expect(level2.cooldownMs).toBeGreaterThan(level0.cooldownMs);
  });

  it("caps the backoff level at BACKOFF_CONFIG.maxLevel (15)", () => {
    const result = checkFallbackError(429, "", 15);
    expect(result.newBackoffLevel).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// getQuotaCooldown
// ---------------------------------------------------------------------------

describe("getQuotaCooldown()", () => {
  it("returns 1000ms (1s) at level 0", () => {
    expect(getQuotaCooldown(0)).toBe(1000);
  });

  it("doubles each level: level 1 = 2000ms", () => {
    expect(getQuotaCooldown(1)).toBe(2000);
  });

  it("doubles each level: level 2 = 4000ms", () => {
    expect(getQuotaCooldown(2)).toBe(4000);
  });

  it("caps at 2 minutes (120000ms)", () => {
    expect(getQuotaCooldown(20)).toBe(120000);
  });
});

// ---------------------------------------------------------------------------
// isAccountUnavailable
// ---------------------------------------------------------------------------

describe("isAccountUnavailable()", () => {
  it("returns true when rateLimitedUntil is in the future", () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    expect(isAccountUnavailable(future)).toBe(true);
  });

  it("returns false when rateLimitedUntil is null", () => {
    expect(isAccountUnavailable(null)).toBe(false);
  });

  it("returns false when rateLimitedUntil is undefined", () => {
    expect(isAccountUnavailable(undefined)).toBe(false);
  });

  it("returns false when rateLimitedUntil is in the past", () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    expect(isAccountUnavailable(past)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEarliestRateLimitedUntil
// ---------------------------------------------------------------------------

describe("getEarliestRateLimitedUntil()", () => {
  it("returns null when given an empty list", () => {
    expect(getEarliestRateLimitedUntil([])).toBeNull();
  });

  it("returns null when no connections have rateLimitedUntil set", () => {
    const accounts = [{ id: "a" }, { id: "b", rateLimitedUntil: null }];
    expect(getEarliestRateLimitedUntil(accounts)).toBeNull();
  });

  it("returns null when all rateLimitedUntil values are in the past", () => {
    const past = new Date(Date.now() - 30 * 1000).toISOString();
    const accounts = [{ rateLimitedUntil: past }];
    expect(getEarliestRateLimitedUntil(accounts)).toBeNull();
  });

  it("returns the earliest future timestamp from a list", () => {
    const sooner = new Date(Date.now() + 30 * 1000).toISOString();
    const later = new Date(Date.now() + 120 * 1000).toISOString();
    const accounts = [
      { rateLimitedUntil: later },
      { rateLimitedUntil: sooner },
    ];
    const result = getEarliestRateLimitedUntil(accounts);
    // Result should match the earlier of the two timestamps
    expect(new Date(result).getTime()).toBeCloseTo(new Date(sooner).getTime(), -2);
  });

  it("skips entries with no rateLimitedUntil and returns the only valid entry", () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    const accounts = [
      { id: "a" },
      { id: "b", rateLimitedUntil: null },
      { id: "c", rateLimitedUntil: future },
    ];
    const result = getEarliestRateLimitedUntil(accounts);
    expect(new Date(result).getTime()).toBeCloseTo(new Date(future).getTime(), -2);
  });
});

// ---------------------------------------------------------------------------
// filterAvailableAccounts
// ---------------------------------------------------------------------------

describe("filterAvailableAccounts()", () => {
  it("returns all accounts when none are rate limited and none are excluded", () => {
    const accounts = [{ id: "a" }, { id: "b" }];
    expect(filterAvailableAccounts(accounts)).toHaveLength(2);
  });

  it("excludes accounts currently rate limited", () => {
    const rateLimited = { id: "a", rateLimitedUntil: new Date(Date.now() + 60000).toISOString() };
    const available = { id: "b" };
    const result = filterAvailableAccounts([rateLimited, available]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("excludes the account matching excludeId", () => {
    const accounts = [{ id: "a" }, { id: "b" }];
    const result = filterAvailableAccounts(accounts, "a");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("includes accounts whose rateLimitedUntil has already passed", () => {
    const expired = { id: "a", rateLimitedUntil: new Date(Date.now() - 60000).toISOString() };
    expect(filterAvailableAccounts([expired])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resetAccountState
// ---------------------------------------------------------------------------

describe("resetAccountState()", () => {
  it("clears cooldown fields and resets backoffLevel to 0", () => {
    const account = {
      id: "x",
      rateLimitedUntil: new Date(Date.now() + 60000).toISOString(),
      backoffLevel: 3,
      lastError: "previous error",
      status: "error",
    };
    const reset = resetAccountState(account);
    expect(reset.rateLimitedUntil).toBeNull();
    expect(reset.backoffLevel).toBe(0);
    expect(reset.lastError).toBeNull();
    expect(reset.status).toBe("active");
  });

  it("returns the original value when account is null", () => {
    expect(resetAccountState(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyErrorState
// ---------------------------------------------------------------------------

describe("applyErrorState()", () => {
  it("sets rateLimitedUntil in the future for a 429 error", () => {
    const account = { id: "x", backoffLevel: 0 };
    const updated = applyErrorState(account, 429, "rate limited");
    expect(updated.status).toBe("error");
    expect(new Date(updated.rateLimitedUntil).getTime()).toBeGreaterThan(Date.now());
    expect(updated.lastError).toMatchObject({ status: 429 });
  });

  it("preserves original fields not related to error state", () => {
    const account = { id: "x", backoffLevel: 0, apiKey: "secret-key" };
    const updated = applyErrorState(account, 500, "server error");
    expect(updated.apiKey).toBe("secret-key");
  });
});
