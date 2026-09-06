import { NextResponse } from "next/server";
import { readVaultEntry, deleteVaultEntry, isVaultUnlocked } from "@/lib/vault.js";
import { requireAuth } from "@/lib/auth/middleware.js";

/** GET /api/vault/entries/[name] — read decrypted value */
async function getHandler(request, { params }) {
  if (!isVaultUnlocked()) {
    return NextResponse.json({ error: "Vault is locked" }, { status: 403 });
  }
  const result = readVaultEntry(params.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}

/** DELETE /api/vault/entries/[name] — remove an entry */
async function deleteHandler(request, { params }) {
  const result = deleteVaultEntry(params.name);
  if (!result.deleted) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Route-level auth (defense-in-depth): GET returns DECRYPTED secret values, so
// it must require a session at the route — the edge cannot enforce key revocation.
export const GET = requireAuth(getHandler);
export const DELETE = requireAuth(deleteHandler);
