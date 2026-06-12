import { NextResponse } from "next/server";
import { readVaultEntry, deleteVaultEntry, isVaultUnlocked } from "@/lib/vault.js";

/** GET /api/vault/entries/[name] — read decrypted value */
export async function GET(request, { params }) {
  if (!isVaultUnlocked()) {
    return NextResponse.json({ error: "Vault is locked" }, { status: 403 });
  }
  const result = readVaultEntry(params.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}

/** DELETE /api/vault/entries/[name] — remove an entry */
export async function DELETE(request, { params }) {
  const result = deleteVaultEntry(params.name);
  if (!result.deleted) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
