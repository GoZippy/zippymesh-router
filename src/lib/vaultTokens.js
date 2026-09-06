/**
 * ZippyVault Agent Token System
 *
 * Scoped bearer tokens that let agents (crons, MCP callers, scripts) read
 * specific vault entries without knowing the master passphrase.
 *
 * Architecture:
 *   - issueAgentToken() generates a random 32-byte bearer token, stores only
 *     its SHA-256 hash in vault_agent_tokens, and returns the raw token ONCE.
 *   - readVaultEntryWithToken() verifies the bearer token, checks scope, calls
 *     readVaultEntry() (vault must already be unlocked), and logs usage.
 *   - Scopes are an array of entry names, or ["*"] for all entries.
 *   - Tokens can have an optional TTL (expires_at) or be permanent.
 *
 * Security properties:
 *   - Raw tokens are never stored; only SHA-256 hashes are persisted.
 *   - Token verification is constant-time via timingSafeEqual.
 *   - Every successful read is logged to vault_token_usage.
 *   - Revoked or expired tokens are rejected before any DB read.
 *   - The vault master password is never exposed to token holders.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  vaultTokenInsert,
  vaultTokenList,
  vaultTokenFindByHash,
  vaultTokenRevoke,
  vaultTokenTouchLastUsed,
  vaultTokenLogUsage,
} from "./localDb.js";
import { readVaultEntry, listVaultEntries, storeVaultEntry, isVaultUnlocked } from "./vault.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** SHA-256 hex of a raw token: the only form of a token that is ever persisted. */
export function hashToken(rawToken) {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Constant-time comparison of two hex strings to prevent timing attacks.
 * Both must be the same length (they will be — both are SHA-256 hex).
 */
function secureCompare(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Issue a new scoped agent token.
 *
 * @param {string} name          Human-readable label (e.g. 'kirocrew-telegram')
 * @param {string[]} scopes      Entry names this token may read, or ['*'] for all
 * @param {number} [expiresInMs] TTL in milliseconds from now; omit for no expiry
 *
 * @returns {{ tokenId, rawToken, name, scopes, createdAt, expiresAt }}
 *   rawToken is shown ONCE — the caller must save it.
 */
export function issueAgentToken(name, scopes, expiresInMs) {
  if (!name || typeof name !== "string") throw new Error("name is required");
  if (!Array.isArray(scopes) || scopes.length === 0) throw new Error("scopes must be a non-empty array");
  if (!scopes.every(s => typeof s === "string" && s.length > 0)) {
    throw new Error("scopes must be non-empty strings (entry names, or '*' for all)");
  }
  // A non-numeric TTL would be string-concatenated onto the timestamp and the
  // token would never expire; a non-positive one is already dead. Reject both.
  if (expiresInMs !== undefined && expiresInMs !== null &&
      (typeof expiresInMs !== "number" || !Number.isFinite(expiresInMs) || expiresInMs <= 0)) {
    throw new Error("expiresInMs must be a positive number of milliseconds");
  }

  const rawToken  = randomBytes(32).toString("hex"); // 256 bits of entropy
  const tokenId   = randomUUID();
  const createdAt = Date.now();
  const expiresAt = expiresInMs ? createdAt + expiresInMs : null;

  vaultTokenInsert({
    id:          tokenId,
    name,
    token_hash:  hashToken(rawToken),
    scopes,
    created_at:  createdAt,
    expires_at:  expiresAt,
  });

  return {
    tokenId,
    rawToken,   // shown once — caller must store it
    name,
    scopes,
    createdAt,
    expiresAt,
  };
}

/**
 * List all non-revoked tokens (metadata only — raw tokens are never stored).
 *
 * @returns {Array<{ id, name, scopes, created_at, expires_at, last_used_at, revoked }>}
 */
export function listAgentTokens() {
  return vaultTokenList()
    .filter(t => !t.revoked)
    .map(t => ({
      id:           t.id,
      name:         t.name,
      scopes:       parseScopes(t.scopes),
      created_at:   t.created_at,
      expires_at:   t.expires_at ?? null,
      last_used_at: t.last_used_at ?? null,
    }));
}

/**
 * Revoke a token by ID. Returns true if a token was found and revoked.
 */
export function revokeAgentToken(id) {
  const changes = vaultTokenRevoke(id);
  return { ok: changes > 0 };
}

/**
 * Verify a raw bearer token.
 *
 * @returns {{ ok: true, tokenId, scopes } | { ok: false, error, code: "unauthorized" }}
 */
export function verifyAgentToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    return { ok: false, error: "Token is required", code: "unauthorized" };
  }

  const hash = hashToken(rawToken);
  const row  = vaultTokenFindByHash(hash);

  if (!row) return { ok: false, error: "Invalid token", code: "unauthorized" };
  if (row.revoked) return { ok: false, error: "Token has been revoked", code: "unauthorized" };
  if (row.expires_at && Date.now() > row.expires_at) {
    return { ok: false, error: "Token has expired", code: "unauthorized" };
  }

  // Constant-time verify (hash already fetched by exact hash lookup, but
  // re-comparing prevents hash oracle attacks if lookup ever becomes fuzzy)
  if (!secureCompare(hash, row.token_hash)) {
    return { ok: false, error: "Invalid token", code: "unauthorized" };
  }

  return { ok: true, tokenId: row.id, scopes: parseScopes(row.scopes) };
}

/**
 * Read a vault entry using a scoped bearer token.
 * The vault must already be unlocked (by the server process at startup or
 * via a prior /api/vault unlock call).
 *
 * Failures carry a machine-readable `code`: "unauthorized" (bad, revoked or
 * expired token), "forbidden" (out of scope), "locked", "not_found", or the
 * vault's own code for anything else.
 *
 * @returns {{ ok: true, name, label, category, value } | { ok: false, error, code }}
 */
export function readVaultEntryWithToken(rawToken, entryName) {
  // 1. Verify token
  const auth = verifyAgentToken(rawToken);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  // 2. Check scope (before existence, so a scoped token cannot probe which
  //    entries exist outside its scope)
  const { tokenId, scopes } = auth;
  const scopeAllowed = scopes.includes("*") || scopes.includes(entryName);
  if (!scopeAllowed) {
    return {
      ok:    false,
      error: `Token is not scoped for entry '${entryName}'. Allowed scopes: ${scopes.join(", ")}`,
      code:  "forbidden",
    };
  }

  // 3. Read the entry (vault must be unlocked)
  const result = readVaultEntry(entryName);
  if (!result.ok) return { ok: false, error: result.error, code: result.code };

  // 4. Log usage and touch last_used_at
  vaultTokenLogUsage(tokenId, entryName);
  vaultTokenTouchLastUsed(tokenId);

  return {
    ok:       true,
    name:     result.name,
    label:    result.label,
    category: result.category,
    value:    result.value,
  };
}

/**
 * List the vault entries a scoped bearer token may read — metadata only, no values.
 *
 * Lets an agent discover WHAT it can read (and whether the vault is unlocked)
 * without reading anything, and lets a sync client pull exactly its scope.
 * Entry metadata is stored in the clear, so this works on a locked vault; the
 * `unlocked` flag tells the caller whether a follow-up read would succeed.
 *
 * @returns {{ ok: true, scopes: string[], unlocked: boolean, entries: Array<{name,label,category,tags,updated_at}> } | { ok: false, error, code: "unauthorized" }}
 */
export function listVaultEntriesWithToken(rawToken) {
  const auth = verifyAgentToken(rawToken);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };
  const { tokenId, scopes } = auth;
  const all     = listVaultEntries();
  const entries = scopes.includes("*") ? all : all.filter(e => scopes.includes(e.name));
  vaultTokenTouchLastUsed(tokenId);
  return {
    ok:       true,
    scopes,
    unlocked: isVaultUnlocked(),
    entries:  entries.map(({ name, label, category, tags, updated_at }) => ({ name, label, category, tags, updated_at })),
  };
}

/**
 * Store (create or update) a vault entry using a scoped bearer token.
 *
 * Writing is reserved for tokens scoped to "*": a token limited to named
 * entries could otherwise create or overwrite entries it will never read. The
 * vault must be unlocked (a token never carries the master password). The
 * write is logged to vault_token_usage like a read.
 *
 * @returns {{ ok: true, name } | { ok: false, error, code }}
 */
export function storeVaultEntryWithToken(rawToken, name, value, { label, category, tags } = {}) {
  const auth = verifyAgentToken(rawToken);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };
  const { tokenId, scopes } = auth;
  if (!scopes.includes("*")) {
    return { ok: false, error: "Writing requires a token scoped to '*' (all entries)", code: "forbidden" };
  }
  if (!isVaultUnlocked()) return { ok: false, error: "Vault is locked", code: "locked" };
  const result = storeVaultEntry(name, value, { label, category, tags });
  if (!result.ok) return { ok: false, error: result.error, code: "invalid" };
  vaultTokenLogUsage(tokenId, name);
  vaultTokenTouchLastUsed(tokenId);
  return { ok: true, name };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Scopes are persisted as JSON text. A corrupt column (unparseable, non-array
 * JSON, non-string members) fails CLOSED to no scopes rather than letting
 * `scopes.includes` throw on a non-array or match a non-string member.
 */
function parseScopes(raw) {
  let scopes = raw;
  if (!Array.isArray(scopes)) {
    try { scopes = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(scopes) ? scopes.filter(s => typeof s === "string") : [];
}
