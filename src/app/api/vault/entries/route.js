import { NextResponse } from "next/server";
import { listVaultEntries, storeVaultEntry, isVaultUnlocked } from "@/lib/vault.js";
import { requireAuth } from "@/lib/auth/middleware.js";

/** GET /api/vault/entries — list entry metadata (no values) */
async function getHandler() {
  const entries = listVaultEntries();
  return NextResponse.json({ entries, unlocked: isVaultUnlocked() });
}

/** POST /api/vault/entries — add or update an entry */
async function postHandler(request) {
  if (!isVaultUnlocked()) {
    return NextResponse.json({ error: "Vault is locked" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const { name, value, label, category, tags } = body;
  if (!name || value === undefined) {
    return NextResponse.json({ error: "name and value are required" }, { status: 400 });
  }
  const result = storeVaultEntry(name, value, { label, category, tags });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// Route-level auth (defense-in-depth): the edge proves key authenticity but NOT
// revocation, so the vault (secret storage) enforces session auth at the route.
export const GET = requireAuth(getHandler);
export const POST = requireAuth(postHandler);
