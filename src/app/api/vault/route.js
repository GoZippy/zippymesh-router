import { NextResponse } from "next/server";
import { isVaultUnlocked, unlockVault, lockVault, verifyVaultPassword, listVaultEntries } from "@/lib/vault.js";

/** GET /api/vault — vault status */
export async function GET() {
  const entryCount = isVaultUnlocked() ? listVaultEntries().length : null;
  return NextResponse.json({
    unlocked: isVaultUnlocked(),
    entryCount,
  });
}

/** POST /api/vault — unlock or lock */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { action, password } = body;

  if (action === "lock") {
    lockVault();
    return NextResponse.json({ ok: true, unlocked: false });
  }

  if (action === "unlock") {
    if (!password) return NextResponse.json({ error: "password required" }, { status: 400 });
    // Verify password against existing entries before accepting
    if (!verifyVaultPassword(password)) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }
    const result = unlockVault(password, { totpCode: body.totpCode });
    if (!result.ok) {
      const status = result.requires_totp ? 401 : 403;
      return NextResponse.json({ error: result.error, requires_totp: !!result.requires_totp }, { status });
    }
    return NextResponse.json({ ok: true, unlocked: true, notice: result.notice });
  }

  return NextResponse.json({ error: "action must be 'unlock' or 'lock'" }, { status: 400 });
}
