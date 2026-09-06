/**
 * POST /api/vault/list-with-token
 *
 * Token-authenticated listing — the bearer token IS the auth, exactly like
 * /api/vault/read-with-token. Returns the entries the token is scoped to,
 * metadata only (never values), plus whether the vault is currently unlocked.
 *
 * Why it exists: an agent integration (Kiro Crew's ZippyVault Bridge, a CLI
 * launcher, a sync job) needs to discover WHAT it may read and whether a read
 * would succeed right now, without reading anything. Before this route the
 * only probe was reading a sentinel entry and interpreting a 404.
 *
 * Body: { token: string }
 *
 * Returns: { ok: true, scopes, unlocked, entries: [{ name, label, category, tags, updated_at }] }
 *       or { ok: false, error: string }
 *
 * Rate limit (src/lib/vaultRateLimit.js; in-memory, resets on restart):
 * 60 requests per minute per presented token, plus 30 token auth failures
 * per minute per peer — the same policy as read-with-token.
 */
import { NextResponse } from "next/server";
import { listVaultEntriesWithToken } from "@/lib/vaultTokens.js";
import { checkVaultTokenRequest, recordVaultAuthFailure } from "@/lib/vaultRateLimit.js";

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { token } = body ?? {};
  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, error: "token is required" }, { status: 400 });
  }

  const rl = checkVaultTokenRequest(request, token);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const result = listVaultEntriesWithToken(token);
  if (!result.ok) {
    // Every failure here is an auth failure: invalid, revoked or expired token.
    recordVaultAuthFailure(rl.peer);
    return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  }

  return NextResponse.json({
    ok:       true,
    scopes:   result.scopes,
    unlocked: result.unlocked,
    entries:  result.entries,
  });
}
