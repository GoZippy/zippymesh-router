/**
 * POST /api/vault/read-with-token
 *
 * Token-authenticated endpoint — the bearer token IS the auth.
 * No session/cookie auth required; this is designed for agents, crons,
 * and external tools that hold an agent token issued from /api/vault/tokens.
 *
 * Body: { token: string, entry: string }
 *
 * Returns: { ok: true, name, label, category, value }
 *       or { ok: false, error: string }
 *
 * Rate limit (src/lib/vaultRateLimit.js; in-memory, resets on restart):
 * 60 requests per minute per presented token, plus 30 token auth failures
 * (401/403) per minute per peer. Proxy address headers identify the peer
 * only when the deployment sets TRUST_PROXY; otherwise every caller is the
 * one "direct" peer.
 */

import { NextResponse } from "next/server";
import { readVaultEntryWithToken } from "@/lib/vaultTokens.js";
import { checkVaultTokenRequest, recordVaultAuthFailure } from "@/lib/vaultRateLimit.js";

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { token, entry } = body ?? {};

  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, error: "token is required" }, { status: 400 });
  }
  if (!entry || typeof entry !== "string") {
    return NextResponse.json({ ok: false, error: "entry is required" }, { status: 400 });
  }

  // Rate limit: keyed on the token itself, plus the peer's auth-failure budget
  const rl = checkVaultTokenRequest(request, token);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      }
    );
  }

  // Read the entry using the token
  const result = readVaultEntryWithToken(token, entry);

  if (!result.ok) {
    // 403 for scope failures, 404 for missing entries; everything else (bad,
    // revoked or expired token, locked vault) is 401. Mapped on the
    // machine-readable `code`, never on message text: the scope message
    // interpolates the caller-supplied entry name, so a substring match on
    // "not found" could be steered by the request itself.
    const status =
      result.code === "not_found" ? 404 :
      result.code === "forbidden" ? 403 :
      401;
    // Only failures of the TOKEN feed the guessing budget; a locked vault is
    // not an auth failure and must not lock other callers out.
    if (result.code === "unauthorized" || result.code === "forbidden") {
      recordVaultAuthFailure(rl.peer);
    }
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({
    ok:       true,
    name:     result.name,
    label:    result.label,
    category: result.category,
    value:    result.value,
  });
}
