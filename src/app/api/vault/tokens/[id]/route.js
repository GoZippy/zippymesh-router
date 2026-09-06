import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware.js";
import { revokeAgentToken } from "@/lib/vaultTokens.js";

/** DELETE /api/vault/tokens/:id — revoke a token */
async function deleteHandler(_request, { params }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Token ID is required" }, { status: 400 });
  }
  const result = revokeAgentToken(id);
  if (!result.ok) {
    return NextResponse.json({ error: "Token not found or already revoked" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, revoked: id });
}

export const DELETE = requireAuth(deleteHandler);
