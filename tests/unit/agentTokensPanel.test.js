/**
 * Unit tests for the ZippyVault Agent Tokens panel.
 *
 * The vitest config runs in a Node environment with no DOM and the repo has no
 * jsdom / @testing-library installed, so — following the existing convention in
 * meshSignatureBadge.test.js — we exercise the pure logic and the fetch client
 * rather than rendering the React component. Adding a DOM test runner would
 * mean new dependencies, which is out of scope here.
 *
 * Covered:
 *   1. scope payload construction ("*" wins, empty selection rejected)
 *   2. TTL option -> expiresInMs mapping
 *   3. the one-time reveal state machine (raw token exists only between
 *      issue_success and done)
 *   4. the two error envelopes these routes emit
 *   5. listTokens / issueToken / revokeToken / listEntryNames against a
 *      mocked global fetch
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  ALL_ENTRIES_SCOPE,
  ALL_ENTRIES_LABEL,
  DEFAULT_EXPIRY,
  EXPIRY_OPTIONS,
  REVEAL_INITIAL,
  buildIssuePayload,
  expiryToMs,
  extractErrorMessage,
  formatExpiry,
  formatLastUsed,
  formatScopeLabel,
  formatTimestamp,
  humanizeMs,
  isExpired,
  revealReducer,
  revealedToken,
} from "../../src/shared/components/vault/agentTokenLogic.js";

import {
  issueToken,
  listEntryNames,
  listTokens,
  revokeToken,
} from "../../src/shared/components/vault/agentTokensApi.js";

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

// ── fetch harness ─────────────────────────────────────────────────────────────

/** Minimal Response stand-in: safeFetchJson only uses ok/status/statusText/text(). */
function jsonResponse(status, body, statusText = "") {
  return {
    ok:         status >= 200 && status < 300,
    status,
    statusText,
    text:       async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ── 1. scope payload construction ─────────────────────────────────────────────

describe("buildIssuePayload — scopes", () => {
  it("requires a name", () => {
    const r = buildIssuePayload({ name: "", allEntries: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name/i);
  });

  it("rejects a whitespace-only name", () => {
    expect(buildIssuePayload({ name: "   ", allEntries: true }).ok).toBe(false);
  });

  it("trims the name", () => {
    const r = buildIssuePayload({ name: "  kirocrew-bridge  ", allEntries: true });
    expect(r.ok).toBe(true);
    expect(r.payload.name).toBe("kirocrew-bridge");
  });

  it("rejects an empty scope selection", () => {
    const r = buildIssuePayload({ name: "x", allEntries: false, selectedNames: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at least one/i);
  });

  it("treats blank-only entry names as no selection", () => {
    const r = buildIssuePayload({ name: "x", selectedNames: ["", "   "] });
    expect(r.ok).toBe(false);
  });

  it("sends the named entries when allEntries is off", () => {
    const r = buildIssuePayload({
      name: "x",
      selectedNames: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
    });
    expect(r.ok).toBe(true);
    expect(r.payload.scopes).toEqual(["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
  });

  it("de-duplicates repeated entry names", () => {
    const r = buildIssuePayload({ name: "x", selectedNames: ["A", "A", "B"] });
    expect(r.payload.scopes).toEqual(["A", "B"]);
  });

  it('"*" wins: the toggle collapses any selection to ["*"]', () => {
    const r = buildIssuePayload({
      name: "x",
      allEntries: true,
      selectedNames: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
    });
    expect(r.payload.scopes).toEqual([ALL_ENTRIES_SCOPE]);
  });

  it('"*" wins: a literal "*" among the checked names also collapses', () => {
    const r = buildIssuePayload({ name: "x", selectedNames: ["A", "*", "B"] });
    expect(r.payload.scopes).toEqual(["*"]);
  });
});

// ── 2. TTL mapping ────────────────────────────────────────────────────────────

describe("expiry options -> expiresInMs", () => {
  it("offers exactly the documented choices", () => {
    expect(EXPIRY_OPTIONS.map(o => o.value)).toEqual([
      "never", "1h", "24h", "7d", "30d", "90d",
    ]);
  });

  it("maps every option to the right millisecond span", () => {
    expect(expiryToMs("never")).toBeNull();
    expect(expiryToMs("1h")).toBe(HOUR);
    expect(expiryToMs("24h")).toBe(24 * HOUR);
    expect(expiryToMs("7d")).toBe(7 * DAY);
    expect(expiryToMs("30d")).toBe(30 * DAY);
    expect(expiryToMs("90d")).toBe(90 * DAY);
  });

  it("fails safe to no-expiry for an unknown value", () => {
    expect(expiryToMs("bogus")).toBeNull();
    expect(expiryToMs(undefined)).toBeNull();
  });

  it("omits expiresInMs entirely for 'never' (the route rejects non-positive TTLs)", () => {
    const r = buildIssuePayload({ name: "x", allEntries: true, expiry: "never" });
    expect(r.payload).toEqual({ name: "x", scopes: ["*"] });
    expect("expiresInMs" in r.payload).toBe(false);
  });

  it("includes a positive expiresInMs for a finite TTL", () => {
    const r = buildIssuePayload({ name: "x", allEntries: true, expiry: "7d" });
    expect(r.payload.expiresInMs).toBe(7 * DAY);
    expect(r.payload.expiresInMs).toBeGreaterThan(0);
  });

  it("uses a bounded default TTL rather than 'never'", () => {
    expect(DEFAULT_EXPIRY).toBe("30d");
    const r = buildIssuePayload({ name: "x", allEntries: true });
    expect(r.payload.expiresInMs).toBe(30 * DAY);
  });
});

// ── 3. reveal state machine ───────────────────────────────────────────────────

describe("one-time reveal state machine", () => {
  const issued = {
    tokenId:   "id-1",
    rawToken:  "a".repeat(64),
    name:      "kirocrew-bridge",
    scopes:    ["*"],
    createdAt: 1_700_000_000_000,
    expiresAt: null,
  };

  it("starts with no token", () => {
    expect(REVEAL_INITIAL.status).toBe("idle");
    expect(REVEAL_INITIAL.token).toBeNull();
    expect(revealedToken(REVEAL_INITIAL)).toBeNull();
  });

  it("holds no token while issuing", () => {
    const s = revealReducer(REVEAL_INITIAL, { type: "issue_start" });
    expect(s.status).toBe("issuing");
    expect(revealedToken(s)).toBeNull();
  });

  it("exposes the raw token only after issue_success", () => {
    const s = revealReducer(REVEAL_INITIAL, { type: "issue_success", token: issued });
    expect(s.status).toBe("revealed");
    expect(revealedToken(s)).toBe(issued.rawToken);
    expect(s.token.name).toBe("kirocrew-bridge");
  });

  it("clears the raw token on done", () => {
    const revealed = revealReducer(REVEAL_INITIAL, { type: "issue_success", token: issued });
    const done     = revealReducer(revealed, { type: "done" });
    expect(done.status).toBe("idle");
    expect(done.token).toBeNull();
    expect(revealedToken(done)).toBeNull();
    // and nothing recovers it
    expect(revealedToken(revealReducer(done, { type: "unknown" }))).toBeNull();
  });

  it("clears the raw token on reset (modal reopened)", () => {
    const revealed = revealReducer(REVEAL_INITIAL, { type: "issue_success", token: issued });
    expect(revealedToken(revealReducer(revealed, { type: "reset" }))).toBeNull();
  });

  it("never exposes a token on issue_error", () => {
    const s = revealReducer(
      revealReducer(REVEAL_INITIAL, { type: "issue_start" }),
      { type: "issue_error", error: "Vault is locked" }
    );
    expect(s.status).toBe("error");
    expect(s.error).toBe("Vault is locked");
    expect(revealedToken(s)).toBeNull();
  });

  it("refuses to enter 'revealed' when the server returned no rawToken", () => {
    const s = revealReducer(REVEAL_INITIAL, {
      type: "issue_success",
      token: { tokenId: "id-2", name: "x", scopes: ["*"] },
    });
    expect(s.status).toBe("error");
    expect(revealedToken(s)).toBeNull();
  });

  it("copies the token object rather than aliasing the caller's", () => {
    const src = { ...issued };
    const s   = revealReducer(REVEAL_INITIAL, { type: "issue_success", token: src });
    src.rawToken = "mutated";
    expect(revealedToken(s)).toBe("a".repeat(64));
  });
});

// ── 4. formatting ─────────────────────────────────────────────────────────────

describe("display helpers", () => {
  it('renders "*" as a human sentence and other scopes verbatim', () => {
    expect(formatScopeLabel("*")).toBe(ALL_ENTRIES_LABEL);
    expect(formatScopeLabel("*")).toBe("All entries (read + write)");
    expect(formatScopeLabel("OPENAI_API_KEY")).toBe("OPENAI_API_KEY");
  });

  it("formats expiry", () => {
    const now = 1_700_000_000_000;
    expect(formatExpiry(null, now)).toBe("Never");
    expect(formatExpiry(undefined, now)).toBe("Never");
    expect(formatExpiry(now - 1, now)).toBe("Expired");
    expect(formatExpiry(now, now)).toBe("Expired");
    expect(formatExpiry(now + 3 * HOUR, now)).toBe("in 3 hours");
    expect(formatExpiry(now + 1 * HOUR, now)).toBe("in 1 hour");
    expect(formatExpiry(now + 7 * DAY, now)).toBe("in 7 days");
  });

  it("formats last used", () => {
    const now = 1_700_000_000_000;
    expect(formatLastUsed(null, now)).toBe("Never");
    expect(formatLastUsed(undefined, now)).toBe("Never");
    expect(formatLastUsed(now - 5_000, now)).toBe("just now");
    expect(formatLastUsed(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(formatLastUsed(now - 2 * DAY, now)).toBe("2 days ago");
  });

  it("humanizes durations with correct singular/plural", () => {
    expect(humanizeMs(30_000)).toBe("less than a minute");
    expect(humanizeMs(60_000)).toBe("1 minute");
    expect(humanizeMs(HOUR)).toBe("1 hour");
    expect(humanizeMs(DAY)).toBe("1 day");
    expect(humanizeMs(2 * DAY)).toBe("2 days");
  });

  it("flags expired tokens from a list row", () => {
    const now = 1_700_000_000_000;
    expect(isExpired({ expires_at: now - 1 }, now)).toBe(true);
    expect(isExpired({ expires_at: now + 1 }, now)).toBe(false);
    expect(isExpired({ expires_at: null }, now)).toBe(false);
    expect(isExpired({}, now)).toBe(false);
  });

  it("renders a placeholder for a missing timestamp", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(undefined)).toBe("—");
    expect(typeof formatTimestamp(1_700_000_000_000)).toBe("string");
    expect(formatTimestamp(1_700_000_000_000).length).toBeGreaterThan(0);
  });
});

// ── 5. error envelopes ────────────────────────────────────────────────────────

describe("extractErrorMessage — both envelopes on these routes", () => {
  it("reads the vault routes' string envelope", () => {
    expect(extractErrorMessage({ data: { error: "name is required" } })).toBe("name is required");
  });

  it("reads requireAuth's OpenAI-style object envelope", () => {
    expect(
      extractErrorMessage({
        status: 401,
        data: { error: { message: "Unauthorized", type: "invalid_request_error", code: "" } },
      })
    ).toBe("Unauthorized");
  });

  it("falls back to safeFetchJson's own error string", () => {
    expect(extractErrorMessage({ status: 0, data: null, error: "fetch failed" })).toBe("fetch failed");
  });

  it("falls back to the supplied default", () => {
    expect(extractErrorMessage({ data: {} }, "Could not load agent tokens"))
      .toBe("Could not load agent tokens");
    expect(extractErrorMessage(null, "boom")).toBe("boom");
  });
});

// ── 6. API client ─────────────────────────────────────────────────────────────

describe("agentTokensApi — listTokens", () => {
  it("returns the token list on 200", async () => {
    const rows = [
      { id: "t1", name: "kirocrew-bridge", scopes: ["*"], created_at: 1, expires_at: null, last_used_at: null },
    ];
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { tokens: rows }));

    const r = await listTokens();
    expect(r.ok).toBe(true);
    expect(r.tokens).toEqual(rows);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/vault/tokens");
    expect(opts.credentials).toBe("include");
    expect(opts.method).toBeUndefined(); // GET
  });

  it("tolerates a missing/!array tokens field", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, {}));
    expect((await listTokens()).tokens).toEqual([]);
  });

  it("flags 401 as unauthorized with the object envelope's message", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(401, { error: { message: "Unauthorized", type: "invalid_request_error", code: "" } })
    );
    const r = await listTokens();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.unauthorized).toBe(true);
    expect(r.error).toBe("Unauthorized");
  });

  it("surfaces a 429 without marking it unauthorized", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(429, { error: "Rate limit exceeded" }));
    const r = await listTokens();
    expect(r.ok).toBe(false);
    expect(r.unauthorized).toBe(false);
    expect(r.error).toBe("Rate limit exceeded");
  });

  it("surfaces a network failure", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("network down"); });
    const r = await listTokens();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.error).toBe("network down");
  });
});

describe("agentTokensApi — issueToken", () => {
  const payload = { name: "kirocrew-bridge", scopes: ["*"], expiresInMs: 30 * DAY };

  it("POSTs the payload as JSON and returns the one-time token", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        tokenId: "t9",
        rawToken: "b".repeat(64),
        name: "kirocrew-bridge",
        scopes: ["*"],
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_000_000_000 + 30 * DAY,
      })
    );

    const r = await issueToken(payload);
    expect(r.ok).toBe(true);
    expect(r.token.rawToken).toBe("b".repeat(64));
    expect(r.token.tokenId).toBe("t9");
    expect(r.token.scopes).toEqual(["*"]);
    expect(r.token.expiresAt).toBe(1_700_000_000_000 + 30 * DAY);

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/vault/tokens");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual(payload);
  });

  it("normalises a missing expiresAt to null", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { ok: true, tokenId: "t9", rawToken: "c".repeat(64), name: "n", scopes: ["A"], createdAt: 1, expiresAt: null })
    );
    const r = await issueToken({ name: "n", scopes: ["A"] });
    expect(r.token.expiresAt).toBeNull();
  });

  it("returns the route's 400 string envelope", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(400, { error: "name is required" }));
    const r = await issueToken({ scopes: ["*"] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toBe("name is required");
  });

  it("treats a 200 without rawToken as a failure (never a fake reveal)", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { ok: true, tokenId: "t9", name: "n", scopes: ["*"] }));
    const r = await issueToken(payload);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/did not return a token value/i);
  });

  it("treats a 200 with ok:false as a failure", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { ok: false, error: "nope" }));
    const r = await issueToken(payload);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("nope");
  });

  it("flags 401 as unauthorized", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { error: { message: "Unauthorized" } }));
    const r = await issueToken(payload);
    expect(r.unauthorized).toBe(true);
  });
});

describe("agentTokensApi — revokeToken", () => {
  it("DELETEs the id and reports success", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { ok: true, revoked: "t1" }));
    const r = await revokeToken("t1");
    expect(r.ok).toBe(true);
    expect(r.revoked).toBe("t1");
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/vault/tokens/t1");
    expect(opts.method).toBe("DELETE");
    expect(opts.credentials).toBe("include");
  });

  it("URL-encodes the id", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { ok: true }));
    await revokeToken("a b/c");
    expect(globalThis.fetch.mock.calls[0][0]).toBe("/api/vault/tokens/a%20b%2Fc");
  });

  it("refuses an empty id without calling fetch", async () => {
    globalThis.fetch = vi.fn();
    const r = await revokeToken("");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/required/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("surfaces the route's 404", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(404, { error: "Token not found or already revoked" }));
    const r = await revokeToken("gone");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toBe("Token not found or already revoked");
  });
});

describe("agentTokensApi — listEntryNames (scope picker)", () => {
  it("maps entries to {name,label} and reports lock state", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        unlocked: false,
        entries: [
          { name: "OPENAI_API_KEY", label: "OpenAI API Key", category: "api-key" },
          { name: "PLAIN", category: "secret" },
          { bogus: true },
        ],
      })
    );
    const r = await listEntryNames();
    expect(r.ok).toBe(true);
    expect(r.unlocked).toBe(false);
    expect(r.entries).toEqual([
      { name: "OPENAI_API_KEY", label: "OpenAI API Key" },
      { name: "PLAIN", label: "PLAIN" },
    ]);
    expect(globalThis.fetch.mock.calls[0][0]).toBe("/api/vault/entries");
  });

  it("flags 401 as unauthorized", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { error: { message: "Unauthorized" } }));
    const r = await listEntryNames();
    expect(r.unauthorized).toBe(true);
  });
});
