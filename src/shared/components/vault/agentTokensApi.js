/**
 * Client for the ZippyVault agent-token routes.
 *
 * Wraps safeFetchJson so every caller gets the same normalised result shape:
 *   { ok: true,  status, ...data }
 *   { ok: false, status, unauthorized, error }
 *
 * `unauthorized` is set on 401 so the panel can fall back to the dashboard's
 * existing "session expired -> /login" pattern (see dashboard/profile/page.js).
 *
 * Imported deep from `@/shared/utils/http` rather than the `@/shared/utils`
 * barrel: http.js has no imports of its own, which keeps this module loadable
 * in the Node vitest environment without dragging in the rest of the barrel.
 */

import { safeFetchJson } from "@/shared/utils/http";
import { extractErrorMessage } from "./agentTokenLogic.js";

const TOKENS_URL  = "/api/vault/tokens";
const ENTRIES_URL = "/api/vault/entries";

const JSON_HEADERS = { "Content-Type": "application/json" };

function fail(result, fallback) {
  return {
    ok:           false,
    status:       result?.status ?? 0,
    unauthorized: result?.status === 401,
    error:        extractErrorMessage(result, fallback),
  };
}

/**
 * GET /api/vault/tokens -> { tokens: [{ id, name, scopes, created_at, expires_at, last_used_at }] }
 * Works whether or not the vault is unlocked (token metadata is not encrypted).
 */
export async function listTokens() {
  const r = await safeFetchJson(TOKENS_URL, { credentials: "include" });
  if (!r.ok) return fail(r, "Could not load agent tokens");
  const tokens = Array.isArray(r.data?.tokens) ? r.data.tokens : [];
  return { ok: true, status: r.status, tokens };
}

/**
 * GET /api/vault/entries -> { entries, unlocked }
 * Used only to populate the scope picker; values are never returned by this route.
 */
export async function listEntryNames() {
  const r = await safeFetchJson(ENTRIES_URL, { credentials: "include" });
  if (!r.ok) return fail(r, "Could not load vault entries");
  const raw = Array.isArray(r.data?.entries) ? r.data.entries : [];
  return {
    ok:       true,
    status:   r.status,
    unlocked: !!r.data?.unlocked,
    entries:  raw
      .filter(e => e && typeof e.name === "string" && e.name.length > 0)
      .map(e => ({ name: e.name, label: e.label || e.name })),
  };
}

/**
 * POST /api/vault/tokens -> { ok, tokenId, rawToken, name, scopes, createdAt, expiresAt }
 *
 * The returned `token.rawToken` is the ONLY time the value exists client-side;
 * hand it straight to the reveal state machine and never persist it.
 *
 * @param {{name: string, scopes: string[], expiresInMs?: number}} payload
 */
export async function issueToken(payload) {
  const r = await safeFetchJson(TOKENS_URL, {
    method:      "POST",
    credentials: "include",
    headers:     JSON_HEADERS,
    body:        JSON.stringify(payload),
  });
  if (!r.ok || !r.data?.ok) return fail(r, "Could not issue token");

  const d = r.data;
  if (typeof d.rawToken !== "string" || d.rawToken.length === 0) {
    return {
      ok:           false,
      status:       r.status,
      unauthorized: false,
      error:        "The server did not return a token value.",
    };
  }
  return {
    ok:     true,
    status: r.status,
    token: {
      tokenId:   d.tokenId,
      rawToken:  d.rawToken,
      name:      d.name,
      scopes:    Array.isArray(d.scopes) ? d.scopes : [],
      createdAt: typeof d.createdAt === "number" ? d.createdAt : null,
      expiresAt: typeof d.expiresAt === "number" ? d.expiresAt : null,
    },
  };
}

/** DELETE /api/vault/tokens/:id -> { ok: true, revoked: id } (404 when unknown/already revoked). */
export async function revokeToken(id) {
  if (!id || typeof id !== "string") {
    return { ok: false, status: 0, unauthorized: false, error: "Token ID is required" };
  }
  const r = await safeFetchJson(`${TOKENS_URL}/${encodeURIComponent(id)}`, {
    method:      "DELETE",
    credentials: "include",
  });
  if (!r.ok || !r.data?.ok) return fail(r, "Could not revoke token");
  return { ok: true, status: r.status, revoked: r.data.revoked ?? id };
}
