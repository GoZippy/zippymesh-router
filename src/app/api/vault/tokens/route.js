import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware.js";
import { issueAgentToken, listAgentTokens } from "@/lib/vaultTokens.js";

/** GET /api/vault/tokens — list all active agent tokens (no raw values) */
async function getHandler() {
  const tokens = listAgentTokens();
  return NextResponse.json({ tokens });
}

/**
 * POST /api/vault/tokens — issue a new scoped agent token
 *
 * Body: { name, scopes, expiresInMs? }
 *   name        — human label (e.g. "kirocrew-telegram")
 *   scopes      — array of entry names, or ["*"] for all entries
 *   expiresInMs — optional TTL in milliseconds
 *
 * Returns: { tokenId, rawToken, name, scopes, createdAt, expiresAt }
 *   rawToken is shown ONCE — the caller must save it immediately.
 */
async function postHandler(request) {
  const body = await request.json().catch(() => ({}));
  const { name, scopes, expiresInMs } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return NextResponse.json(
      { error: "scopes must be a non-empty array of entry names, or [\"*\"] for all" },
      { status: 400 }
    );
  }

  try {
    const result = issueAgentToken(name, scopes, expiresInMs ?? undefined);
    return NextResponse.json({
      ok:        true,
      tokenId:   result.tokenId,
      rawToken:  result.rawToken,
      name:      result.name,
      scopes:    result.scopes,
      createdAt: result.createdAt,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export const GET  = requireAuth(getHandler);
export const POST = requireAuth(postHandler);
