/**
 * Vault agent-token tests: hashing + constant-time verify, scope parsing from
 * the JSON TEXT column, expiry, revocation, usage logging, metadata-only
 * listing, token-gated writes, the status mapping of the two
 * token-authenticated routes, their rate limiter (per-token buckets, the
 * per-peer auth-failure budget, TRUST_PROXY), the issue/revoke routes'
 * validation, and the edge middleware letting the token routes through
 * without a session cookie.
 *
 * The REAL vaultTokens.js, vaultRateLimit.js and route handlers run. Only the
 * DB accessors and the vault seam are mocked, in-memory, with rows shaped
 * exactly like SQLite returns them (scopes as JSON text, revoked as 0/1).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-that-is-definitely-long-enough-0123456789";

// ── In-memory replicas of the SQLite tables ──────────────────────────────────
const db = vi.hoisted(() => ({
  tokens: new Map(),   // id -> row (scopes: JSON text, revoked: 0|1)
  usage: [],           // { token_id, entry_name, accessed_at }
  entries: new Map(),  // name -> encrypted row (real vault.js only)
  meta: new Map(),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: vi.fn(async () => ({ requireLogin: false })),
  vaultTokenInsert: ({ id, name, token_hash, scopes, created_at, expires_at }) => {
    db.tokens.set(id, {
      id, name, token_hash,
      scopes: JSON.stringify(scopes),
      created_at,
      expires_at: expires_at ?? null,
      last_used_at: null,
      revoked: 0,
    });
  },
  vaultTokenList: () => [...db.tokens.values()].map(({ token_hash, ...rest }) => rest),
  vaultTokenFindByHash: (h) => [...db.tokens.values()].find((t) => t.token_hash === h) ?? null,
  vaultTokenRevoke: (id) => {
    const t = db.tokens.get(id);
    if (!t || t.revoked) return 0;
    t.revoked = 1;
    return 1;
  },
  vaultTokenTouchLastUsed: (id) => { const t = db.tokens.get(id); if (t) t.last_used_at = Date.now(); },
  vaultTokenLogUsage: (token_id, entry_name) => { db.usage.push({ token_id, entry_name, accessed_at: Date.now() }); },
  // Used only by the real vault.js (importActual) in the failure-code test.
  vaultListEntries: () => [...db.entries.values()],
  vaultStoreEntry: (row) => { db.entries.set(row.name, { ...row, created_at: 1, updated_at: 2 }); },
  vaultGetEntry: (name) => db.entries.get(name) ?? null,
  vaultDeleteEntry: (name) => (db.entries.delete(name) ? 1 : 0),
  vaultMetaGet: (k) => db.meta.get(k) ?? null,
  vaultMetaSet: (k, v) => { db.meta.set(k, v); },
}));

vi.mock("../../src/lib/vault-totp.js", () => ({
  isTotpEnabled: () => false,
  verifyTotpForUnlock: () => ({ ok: true }),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

// The vault seam: plaintext lives only here, never in listVaultEntries output.
const vault = vi.hoisted(() => ({ unlocked: true, entries: new Map() }));
vi.mock("../../src/lib/vault.js", () => ({
  isVaultUnlocked: vi.fn(() => vault.unlocked),
  listVaultEntries: vi.fn(() => [...vault.entries.values()].map(({ value, ...meta }) => meta)),
  readVaultEntry: vi.fn((name) => {
    if (!vault.unlocked) return { ok: false, error: "Vault is locked", code: "locked" };
    const e = vault.entries.get(name);
    if (!e) return { ok: false, error: `Entry not found: ${name}`, code: "not_found" };
    return { ok: true, name: e.name, label: e.label, category: e.category, value: e.value };
  }),
  storeVaultEntry: vi.fn((name, value, { label, category, tags } = {}) => {
    if (!vault.unlocked) return { ok: false, error: "Vault is locked" };
    if (!name || typeof name !== "string") return { ok: false, error: "name is required" };
    if (value === undefined || value === null) return { ok: false, error: "value is required" };
    vault.entries.set(name, {
      name, label: label || name, category: category || "api-key", tags: tags || [],
      value: String(value), created_at: 9, updated_at: 9,
    });
    return { ok: true };
  }),
}));

import {
  issueAgentToken,
  listAgentTokens,
  revokeAgentToken,
  verifyAgentToken,
  readVaultEntryWithToken,
  listVaultEntriesWithToken,
  storeVaultEntryWithToken,
  hashToken,
} from "../../src/lib/vaultTokens.js";
import {
  resetVaultRateLimits,
  isTrustedProxy,
  peerKey,
  tokenFingerprint,
  VAULT_TOKEN_RATE_LIMIT_MAX,
  VAULT_AUTH_FAIL_RATE_LIMIT_MAX,
} from "../../src/lib/vaultRateLimit.js";
import * as readRoute from "../../src/app/api/vault/read-with-token/route.js";
import * as listRoute from "../../src/app/api/vault/list-with-token/route.js";
import * as tokensRoute from "../../src/app/api/vault/tokens/route.js";
import * as tokenIdRoute from "../../src/app/api/vault/tokens/[id]/route.js";
import { readVaultEntry as mockedRead, storeVaultEntry as mockedStore } from "../../src/lib/vault.js";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function req({ body, headers = {}, badJson = false } = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (k) => h[k.toLowerCase()] ?? null },
    json: async () => { if (badJson) throw new SyntaxError("bad json"); return body; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.tokens.clear();
  db.usage.length = 0;
  vault.unlocked = true;
  vault.entries.clear();
  vault.entries.set("ALPHA", { name: "ALPHA", label: "Alpha", category: "api-key", tags: ["e2e"], value: "alpha-secret", created_at: 1, updated_at: 2 });
  vault.entries.set("BETA",  { name: "BETA",  label: "Beta",  category: "token",   tags: [],      value: "beta-secret",  created_at: 3, updated_at: 4 });
  resetVaultRateLimits();
  delete process.env.TRUST_PROXY;
});

// ── issueAgentToken ──────────────────────────────────────────────────────────

describe("issueAgentToken", () => {
  it("persists only the SHA-256 hash and returns a 256-bit hex token once", () => {
    const t = issueAgentToken("agent", ["ALPHA"]);
    expect(t.rawToken).toMatch(/^[0-9a-f]{64}$/);
    const row = db.tokens.get(t.tokenId);
    expect(row.token_hash).toBe(sha256(t.rawToken));
    expect(row.token_hash).toBe(hashToken(t.rawToken));
    expect(JSON.stringify(row)).not.toContain(t.rawToken);
    expect(row.scopes).toBe('["ALPHA"]'); // stored as JSON text
    expect(t.expiresAt).toBeNull();
  });

  it("computes expiresAt from a numeric TTL and accepts null for no expiry", () => {
    const t = issueAgentToken("agent", ["*"], 60_000);
    expect(t.expiresAt).toBe(t.createdAt + 60_000);
    expect(issueAgentToken("agent", ["*"], null).expiresAt).toBeNull();
  });

  it("rejects a non-numeric or non-positive TTL (would otherwise never expire)", () => {
    for (const bad of ["abc", "60000", -1, 0, NaN, Infinity, {}]) {
      expect(() => issueAgentToken("agent", ["*"], bad)).toThrow(/expiresInMs/);
    }
  });

  it("rejects scopes that are not non-empty strings", () => {
    expect(() => issueAgentToken("agent", [])).toThrow(/scopes/);
    expect(() => issueAgentToken("agent", ["*", 5])).toThrow(/scopes/);
    expect(() => issueAgentToken("agent", [""])).toThrow(/scopes/);
    expect(() => issueAgentToken("agent", [{ name: "ALPHA" }])).toThrow(/scopes/);
    expect(() => issueAgentToken("agent", "ALPHA")).toThrow(/scopes/);
    expect(() => issueAgentToken("", ["*"])).toThrow(/name/);
  });
});

// ── verifyAgentToken ─────────────────────────────────────────────────────────

describe("verifyAgentToken", () => {
  it("accepts the raw token and parses scopes back from JSON text", () => {
    const { rawToken, tokenId } = issueAgentToken("agent", ["ALPHA", "BETA"]);
    expect(verifyAgentToken(rawToken)).toEqual({ ok: true, tokenId, scopes: ["ALPHA", "BETA"] });
  });

  it("rejects unknown, empty and non-string tokens with code unauthorized", () => {
    issueAgentToken("agent", ["*"]);
    expect(verifyAgentToken("f".repeat(64))).toMatchObject({ ok: false, error: "Invalid token", code: "unauthorized" });
    expect(verifyAgentToken("")).toMatchObject({ ok: false, code: "unauthorized" });
    expect(verifyAgentToken(undefined)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(verifyAgentToken(12345)).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it("rejects a revoked token", () => {
    const { rawToken, tokenId } = issueAgentToken("agent", ["*"]);
    expect(revokeAgentToken(tokenId)).toEqual({ ok: true });
    expect(verifyAgentToken(rawToken)).toMatchObject({ ok: false, error: "Token has been revoked", code: "unauthorized" });
  });

  it("re-revoking an already revoked token reports not found", () => {
    const { tokenId } = issueAgentToken("agent", ["*"]);
    expect(revokeAgentToken(tokenId)).toEqual({ ok: true });
    expect(revokeAgentToken(tokenId)).toEqual({ ok: false });
    expect(revokeAgentToken("nope")).toEqual({ ok: false });
  });

  it("rejects an expired token and accepts one whose TTL is still running", () => {
    const { rawToken, tokenId } = issueAgentToken("agent", ["*"], 1);
    db.tokens.get(tokenId).expires_at = Date.now() - 1;
    expect(verifyAgentToken(rawToken)).toMatchObject({ ok: false, error: "Token has expired", code: "unauthorized" });
    db.tokens.get(tokenId).expires_at = Date.now() + 60_000;
    expect(verifyAgentToken(rawToken).ok).toBe(true);
  });

  it("fails closed on a corrupt scopes column", () => {
    const { rawToken, tokenId } = issueAgentToken("agent", ["*"]);
    const row = db.tokens.get(tokenId);
    row.scopes = "not json";
    expect(verifyAgentToken(rawToken).scopes).toEqual([]);
    row.scopes = '{"ALPHA":true}';
    expect(verifyAgentToken(rawToken).scopes).toEqual([]);
    row.scopes = '["ALPHA", 5, null, {"x":1}]';
    expect(verifyAgentToken(rawToken).scopes).toEqual(["ALPHA"]);
    // A non-array column must not make the read throw; it must deny.
    row.scopes = '{"ALPHA":true}';
    expect(readVaultEntryWithToken(rawToken, "ALPHA")).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("listAgentTokens shows metadata only and hides revoked tokens", () => {
    const a = issueAgentToken("a", ["ALPHA"]);
    const b = issueAgentToken("b", ["*"]);
    revokeAgentToken(b.tokenId);
    const list = listAgentTokens();
    expect(list.map((t) => t.id)).toEqual([a.tokenId]);
    expect(list[0]).toEqual({ id: a.tokenId, name: "a", scopes: ["ALPHA"], created_at: a.createdAt, expires_at: null, last_used_at: null });
    expect(JSON.stringify(list)).not.toMatch(/token_hash|rawToken/);
  });
});

// ── readVaultEntryWithToken ──────────────────────────────────────────────────

describe("readVaultEntryWithToken", () => {
  it("in-scope read returns the value, logs usage and touches last_used_at", () => {
    const { rawToken, tokenId } = issueAgentToken("agent", ["ALPHA"]);
    expect(readVaultEntryWithToken(rawToken, "ALPHA")).toEqual({
      ok: true, name: "ALPHA", label: "Alpha", category: "api-key", value: "alpha-secret",
    });
    expect(db.usage).toEqual([{ token_id: tokenId, entry_name: "ALPHA", accessed_at: expect.any(Number) }]);
    expect(db.tokens.get(tokenId).last_used_at).toEqual(expect.any(Number));
  });

  it("out-of-scope read is forbidden and never touches the entry or the audit log", () => {
    const { rawToken } = issueAgentToken("agent", ["ALPHA"]);
    const r = readVaultEntryWithToken(rawToken, "BETA");
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(r.error).toContain("not scoped");
    expect(mockedRead).not.toHaveBeenCalled();
    expect(db.usage).toEqual([]);
  });

  it("scope is checked before existence, so a scoped token cannot probe other names", () => {
    const { rawToken } = issueAgentToken("agent", ["ALPHA"]);
    expect(readVaultEntryWithToken(rawToken, "DOES_NOT_EXIST")).toMatchObject({ ok: false, code: "forbidden" });
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("wildcard scope reads any entry; a missing one is not_found", () => {
    const { rawToken } = issueAgentToken("agent", ["*"]);
    expect(readVaultEntryWithToken(rawToken, "BETA").value).toBe("beta-secret");
    expect(readVaultEntryWithToken(rawToken, "NOPE")).toMatchObject({ ok: false, code: "not_found" });
  });

  it("locked vault answers locked and logs no usage", () => {
    const { rawToken } = issueAgentToken("agent", ["ALPHA"]);
    vault.unlocked = false;
    expect(readVaultEntryWithToken(rawToken, "ALPHA")).toEqual({ ok: false, error: "Vault is locked", code: "locked" });
    expect(db.usage).toEqual([]);
  });

  it("bad token answers unauthorized before any vault access", () => {
    expect(readVaultEntryWithToken("bogus", "ALPHA")).toMatchObject({ ok: false, code: "unauthorized" });
    expect(mockedRead).not.toHaveBeenCalled();
  });
});

// ── listVaultEntriesWithToken ────────────────────────────────────────────────

describe("listVaultEntriesWithToken", () => {
  it("returns only in-scope entries, metadata only, with the unlocked flag", () => {
    const { rawToken, tokenId } = issueAgentToken("agent", ["ALPHA"]);
    const r = listVaultEntriesWithToken(rawToken);
    expect(r).toEqual({
      ok: true, scopes: ["ALPHA"], unlocked: true,
      entries: [{ name: "ALPHA", label: "Alpha", category: "api-key", tags: ["e2e"], updated_at: 2 }],
    });
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(db.tokens.get(tokenId).last_used_at).toEqual(expect.any(Number));
  });

  it("works on a locked vault and reports unlocked=false; wildcard lists everything", () => {
    const { rawToken } = issueAgentToken("agent", ["*"]);
    vault.unlocked = false;
    const r = listVaultEntriesWithToken(rawToken);
    expect(r.unlocked).toBe(false);
    expect(r.entries.map((e) => e.name)).toEqual(["ALPHA", "BETA"]);
  });

  it("rejects a bad token", () => {
    expect(listVaultEntriesWithToken("bogus")).toMatchObject({ ok: false, code: "unauthorized" });
  });
});

// ── storeVaultEntryWithToken ─────────────────────────────────────────────────

describe("storeVaultEntryWithToken", () => {
  it("a '*' token writes when the vault is unlocked, and the write is logged", () => {
    const { rawToken, tokenId } = issueAgentToken("writer", ["*"]);
    expect(storeVaultEntryWithToken(rawToken, "NEW", "new-secret", { label: "New", category: "token", tags: ["x"] }))
      .toEqual({ ok: true, name: "NEW" });
    expect(mockedStore).toHaveBeenCalledWith("NEW", "new-secret", { label: "New", category: "token", tags: ["x"] });
    expect(vault.entries.get("NEW").value).toBe("new-secret");
    expect(db.usage).toEqual([{ token_id: tokenId, entry_name: "NEW", accessed_at: expect.any(Number) }]);
    expect(db.tokens.get(tokenId).last_used_at).toEqual(expect.any(Number));
  });

  it("a token scoped to named entries cannot write, even to one of its own entries", () => {
    const { rawToken } = issueAgentToken("reader", ["ALPHA"]);
    expect(storeVaultEntryWithToken(rawToken, "ALPHA", "x")).toMatchObject({ ok: false, code: "forbidden" });
    expect(storeVaultEntryWithToken(rawToken, "OTHER", "x")).toMatchObject({ ok: false, code: "forbidden" });
    expect(mockedStore).not.toHaveBeenCalled();
    expect(db.usage).toEqual([]);
  });

  it("refuses on a locked vault and on a bad token before touching the vault", () => {
    const { rawToken } = issueAgentToken("writer", ["*"]);
    vault.unlocked = false;
    expect(storeVaultEntryWithToken(rawToken, "NEW", "x")).toEqual({ ok: false, error: "Vault is locked", code: "locked" });
    vault.unlocked = true;
    expect(storeVaultEntryWithToken("bogus", "NEW", "x")).toMatchObject({ ok: false, code: "unauthorized" });
    expect(mockedStore).not.toHaveBeenCalled();
  });

  it("surfaces the vault's own validation as code invalid", () => {
    const { rawToken } = issueAgentToken("writer", ["*"]);
    expect(storeVaultEntryWithToken(rawToken, "NEW", undefined)).toEqual({ ok: false, error: "value is required", code: "invalid" });
    expect(storeVaultEntryWithToken(rawToken, "", "x")).toEqual({ ok: false, error: "name is required", code: "invalid" });
  });
});

// ── Real vault.js failure codes ──────────────────────────────────────────────

describe("vault.readVaultEntry failure codes (real vault.js)", () => {
  it("reports locked / not_found / decrypt_failed as codes", async () => {
    const real = await vi.importActual("../../src/lib/vault.js");
    real.lockVault();
    expect(real.readVaultEntry("ALPHA")).toEqual({ ok: false, error: "Vault is locked", code: "locked" });
    expect(real.unlockVault("pw-one").ok).toBe(true);
    expect(real.readVaultEntry("NOPE")).toMatchObject({ ok: false, code: "not_found" });
    expect(real.storeVaultEntry("REAL", "v").ok).toBe(true);
    expect(real.readVaultEntry("REAL")).toMatchObject({ ok: true, value: "v" });
    real.lockVault();
    real.unlockVault("pw-two");
    expect(real.readVaultEntry("REAL")).toMatchObject({ ok: false, code: "decrypt_failed" });
    real.lockVault();
  }, 30_000);
});

// ── vaultRateLimit: peer identity and token fingerprint ──────────────────────

describe("vaultRateLimit peer key and fingerprint", () => {
  it("trusts proxy headers only when TRUST_PROXY is 1 or true", () => {
    expect(isTrustedProxy()).toBe(false);
    for (const v of ["1", "true", "TRUE", " true "]) { process.env.TRUST_PROXY = v; expect(isTrustedProxy()).toBe(true); }
    for (const v of ["0", "false", "yes", ""]) { process.env.TRUST_PROXY = v; expect(isTrustedProxy()).toBe(false); }
  });

  it("peer is the constant 'direct' when untrusted, whatever headers the caller sends", () => {
    expect(peerKey(req({ headers: { "x-forwarded-for": "10.1.1.1", "x-real-ip": "10.1.1.2" } }))).toBe("direct");
    expect(peerKey(req())).toBe("direct");
  });

  it("peer is the first forwarded hop, then x-real-ip, when the proxy is trusted", () => {
    process.env.TRUST_PROXY = "1";
    expect(peerKey(req({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }))).toBe("203.0.113.9");
    expect(peerKey(req({ headers: { "x-real-ip": "203.0.113.7" } }))).toBe("203.0.113.7");
    expect(peerKey(req())).toBe("direct");
  });

  it("fingerprint is the first 16 hex of the token hash, never the token", () => {
    const token = "t".repeat(64);
    expect(tokenFingerprint(token)).toBe(hashToken(token).slice(0, 16));
    expect(tokenFingerprint(token)).toMatch(/^[0-9a-f]{16}$/);
    expect(token).not.toContain(tokenFingerprint(token));
  });
});

// ── POST /api/vault/read-with-token ──────────────────────────────────────────

describe("POST /api/vault/read-with-token", () => {
  const post = (body, headers) => readRoute.POST(req({ body, headers }));

  it("400 on missing token, missing entry, invalid JSON", async () => {
    expect((await post({ entry: "ALPHA" })).status).toBe(400);
    expect((await post({ token: "x" })).status).toBe(400);
    expect((await readRoute.POST(req({ badJson: true }))).status).toBe(400);
    expect((await post({ token: 42, entry: "ALPHA" })).status).toBe(400);
  });

  it("200 with the value for an in-scope entry, nothing else", async () => {
    const { rawToken } = issueAgentToken("agent", ["ALPHA"]);
    const res = await post({ token: rawToken, entry: "ALPHA" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "ALPHA", label: "Alpha", category: "api-key", value: "alpha-secret" });
  });

  it("401 bad token, 403 out of scope, 404 missing, 401 'Vault is locked'", async () => {
    const { rawToken } = issueAgentToken("agent", ["ALPHA", "GHOST"]);
    expect((await post({ token: "f".repeat(64), entry: "ALPHA" })).status).toBe(401);
    expect((await post({ token: rawToken, entry: "BETA" })).status).toBe(403);
    expect((await post({ token: rawToken, entry: "GHOST" })).status).toBe(404);
    vault.unlocked = false;
    const locked = await post({ token: rawToken, entry: "ALPHA" });
    expect(locked.status).toBe(401);
    expect(await locked.json()).toEqual({ ok: false, error: "Vault is locked" });
  });

  it("maps on the failure code, not on caller-controlled message text", async () => {
    const { rawToken } = issueAgentToken("agent", ["ALPHA"]);
    // Out of scope: the entry name is interpolated into the message, so a
    // name containing "not found" must still be a 403, not a 404.
    expect((await post({ token: rawToken, entry: "x not found y" })).status).toBe(403);
  });

  it("revoked and expired tokens are 401 on both routes", async () => {
    const { rawToken, tokenId } = issueAgentToken("agent", ["ALPHA"]);
    revokeAgentToken(tokenId);
    expect((await post({ token: rawToken, entry: "ALPHA" })).status).toBe(401);
    expect((await listRoute.POST(req({ body: { token: rawToken } }))).status).toBe(401);
    const short = issueAgentToken("agent", ["ALPHA"], 1);
    db.tokens.get(short.tokenId).expires_at = Date.now() - 1;
    expect((await post({ token: short.rawToken, entry: "ALPHA" })).status).toBe(401);
    expect((await listRoute.POST(req({ body: { token: short.rawToken } }))).status).toBe(401);
  });

  it("429 after 60 requests in a minute for one token, with Retry-After", async () => {
    const { rawToken } = issueAgentToken("agent", ["ALPHA"]);
    for (let i = 0; i < VAULT_TOKEN_RATE_LIMIT_MAX; i++) {
      expect((await post({ token: rawToken, entry: "ALPHA" })).status).toBe(200);
    }
    const limited = await post({ token: rawToken, entry: "ALPHA" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ ok: false, error: "Rate limit exceeded. Try again shortly." });
  });

  it("two valid tokens never share a bucket", async () => {
    const a = issueAgentToken("a", ["ALPHA"]);
    const b = issueAgentToken("b", ["ALPHA"]);
    for (let i = 0; i < VAULT_TOKEN_RATE_LIMIT_MAX; i++) await post({ token: a.rawToken, entry: "ALPHA" });
    expect((await post({ token: a.rawToken, entry: "ALPHA" })).status).toBe(429);
    expect((await post({ token: b.rawToken, entry: "ALPHA" })).status).toBe(200);
  });

  it("x-forwarded-for / x-real-ip are ignored unless TRUST_PROXY is set: a caller cannot pick its bucket", async () => {
    const { rawToken } = issueAgentToken("agent", ["ALPHA"]);
    for (let i = 0; i < VAULT_TOKEN_RATE_LIMIT_MAX; i++) {
      expect((await post({ token: rawToken, entry: "ALPHA" }, { "x-forwarded-for": "10.1.1.1" })).status).toBe(200);
    }
    expect((await post({ token: rawToken, entry: "ALPHA" }, { "x-forwarded-for": "10.1.1.2" })).status).toBe(429);
    expect((await post({ token: rawToken, entry: "ALPHA" }, { "x-real-ip": "10.1.1.3" })).status).toBe(429);
    expect((await post({ token: rawToken, entry: "ALPHA" })).status).toBe(429);
  });

  it("with TRUST_PROXY=1 the proxied client address separates buckets", async () => {
    process.env.TRUST_PROXY = "1";
    const { rawToken } = issueAgentToken("agent", ["ALPHA"]);
    const a = { "x-forwarded-for": "203.0.113.1, 10.0.0.1" };
    for (let i = 0; i < VAULT_TOKEN_RATE_LIMIT_MAX; i++) {
      expect((await post({ token: rawToken, entry: "ALPHA" }, a)).status).toBe(200);
    }
    expect((await post({ token: rawToken, entry: "ALPHA" }, a)).status).toBe(429);
    expect((await post({ token: rawToken, entry: "ALPHA" }, { "x-forwarded-for": "203.0.113.2" })).status).toBe(200);
  });

  it("30 token auth failures exhaust the peer's budget even when every guess is a fresh token", async () => {
    const good = issueAgentToken("agent", ["ALPHA"]);
    for (let i = 0; i < VAULT_AUTH_FAIL_RATE_LIMIT_MAX; i++) {
      expect((await post({ token: `guess-${i}`, entry: "ALPHA" })).status).toBe(401);
    }
    const blocked = await post({ token: good.rawToken, entry: "ALPHA" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(mockedRead).not.toHaveBeenCalled();
    // The budget is shared by both routes.
    expect((await listRoute.POST(req({ body: { token: good.rawToken } }))).status).toBe(429);
  });

  it("scope failures (403) count toward the budget; a locked vault (401) does not", async () => {
    const scoped = issueAgentToken("agent", ["ALPHA"]);
    for (let i = 0; i < VAULT_AUTH_FAIL_RATE_LIMIT_MAX; i++) {
      expect((await post({ token: scoped.rawToken, entry: "BETA" })).status).toBe(403);
    }
    expect((await post({ token: scoped.rawToken, entry: "ALPHA" })).status).toBe(429);

    resetVaultRateLimits();
    vault.unlocked = false;
    for (let i = 0; i < VAULT_AUTH_FAIL_RATE_LIMIT_MAX; i++) {
      expect((await post({ token: scoped.rawToken, entry: "ALPHA" })).status).toBe(401);
    }
    expect((await post({ token: scoped.rawToken, entry: "ALPHA" })).status).toBe(401); // still not 429
    vault.unlocked = true;
    expect((await post({ token: scoped.rawToken, entry: "ALPHA" })).status).toBe(200);
  });
});

// ── POST /api/vault/list-with-token ──────────────────────────────────────────

describe("POST /api/vault/list-with-token", () => {
  const post = (body, headers) => listRoute.POST(req({ body, headers }));

  it("400 without a token, 401 with a bad one", async () => {
    expect((await post({})).status).toBe(400);
    expect((await listRoute.POST(req({ badJson: true }))).status).toBe(400);
    expect((await post({ token: "bogus" })).status).toBe(401);
  });

  it("200 with scoped metadata only and the unlocked flag", async () => {
    const { rawToken } = issueAgentToken("agent", ["BETA"]);
    const res = await post({ token: rawToken });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true, scopes: ["BETA"], unlocked: true,
      entries: [{ name: "BETA", label: "Beta", category: "token", tags: [], updated_at: 4 }],
    });
    vault.unlocked = false;
    expect((await (await post({ token: rawToken })).json()).unlocked).toBe(false);
  });

  it("429 after 60 requests in a minute for one token; another token is unaffected", async () => {
    const a = issueAgentToken("a", ["*"]);
    const b = issueAgentToken("b", ["*"]);
    let last;
    for (let i = 0; i < VAULT_TOKEN_RATE_LIMIT_MAX + 1; i++) last = await post({ token: a.rawToken });
    expect(last.status).toBe(429);
    expect((await post({ token: b.rawToken })).status).toBe(200);
  });

  it("bad tokens on the list route feed the shared auth-fail budget", async () => {
    const good = issueAgentToken("a", ["*"]);
    for (let i = 0; i < VAULT_AUTH_FAIL_RATE_LIMIT_MAX; i++) {
      expect((await post({ token: `guess-${i}` })).status).toBe(401);
    }
    expect((await post({ token: good.rawToken })).status).toBe(429);
    expect((await readRoute.POST(req({ body: { token: good.rawToken, entry: "ALPHA" } }))).status).toBe(429);
  });
});

// ── /api/vault/tokens (issue) and /api/vault/tokens/[id] (revoke) ────────────

describe("/api/vault/tokens routes (open mode)", () => {
  it("POST issues a token and returns the raw value once", async () => {
    const res = await tokensRoute.POST(req({ body: { name: "kirocrew", scopes: ["ALPHA"], expiresInMs: 1000 } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(body.expiresAt).toBe(body.createdAt + 1000);
  });

  it("POST rejects a non-numeric TTL and non-string scopes with 400", async () => {
    expect((await tokensRoute.POST(req({ body: { name: "a", scopes: ["*"], expiresInMs: "abc" } }))).status).toBe(400);
    expect((await tokensRoute.POST(req({ body: { name: "a", scopes: ["*", 5] } }))).status).toBe(400);
    expect((await tokensRoute.POST(req({ body: { name: "a", scopes: [] } }))).status).toBe(400);
    expect((await tokensRoute.POST(req({ body: { scopes: ["*"] } }))).status).toBe(400);
    expect(db.tokens.size).toBe(0);
  });

  it("DELETE revokes once (200) and answers 404 for a repeat or unknown id", async () => {
    const { tokenId } = issueAgentToken("agent", ["*"]);
    const del = (id) => tokenIdRoute.DELETE(req(), { params: Promise.resolve({ id }) });
    expect((await del(tokenId)).status).toBe(200);
    expect((await del(tokenId)).status).toBe(404);
    expect((await del("nope")).status).toBe(404);
  });
});

// ── Edge middleware: token routes must not be behind the cookie gate ─────────

describe("edge middleware lets the token-authenticated vault routes through", () => {
  const origin = "http://127.0.0.1:20128";

  it("passes read-with-token / list-with-token without a session; siblings stay gated", async () => {
    // No dashboard is running in unit tests: the requireLogin probe fails and
    // the middleware must fail CLOSED (requireLogin=true) for gated paths.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in unit test"); }));
    const { default: middleware } = await import("../../src/middleware.js");

    for (const p of ["/api/vault/read-with-token", "/api/vault/list-with-token"]) {
      const res = await middleware(new NextRequest(`${origin}${p}`, { method: "POST" }));
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.status).toBe(200);
    }
    const gated = await middleware(new NextRequest(`${origin}/api/vault/tokens`, { method: "POST" }));
    expect(gated.status).toBe(401);
    const entries = await middleware(new NextRequest(`${origin}/api/vault/entries/ALPHA`));
    expect(entries.status).toBe(401);
    vi.unstubAllGlobals();
  });
});
