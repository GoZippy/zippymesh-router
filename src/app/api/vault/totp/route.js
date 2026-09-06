import { NextResponse } from "next/server";
import {
  isTotpEnabled,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
} from "@/lib/vault-totp.js";
import { isVaultUnlocked, verifyVaultPassword } from "@/lib/vault.js";
import { requireAuth } from "@/lib/auth/middleware.js";

/** GET /api/vault/totp — status */
async function getHandler() {
  return NextResponse.json({ enabled: isTotpEnabled() });
}

/**
 * POST /api/vault/totp — actions for TOTP enrollment / disable.
 *
 * Body: { action: "begin" | "confirm" | "disable", ... }
 *
 *   action: "begin"      → returns { secret, otpauthUrl, backupCodes }
 *                          (secret + backup codes shown ONCE — caller must save)
 *
 *   action: "confirm"    → body must include password, secret, code, backupCodes
 *                          (the values returned from begin + a fresh 6-digit code)
 *
 *   action: "disable"    → body must include password + valid current code
 */
async function postHandler(request) {
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  if (action === "begin") {
    // Vault must be unlocked OR not yet have any entries (initial setup).
    // We allow begin without unlock so the user can enroll TOTP at first vault init.
    const enrollment = beginTotpEnrollment({
      accountLabel: body.accountLabel || "ZippyVault",
      issuer:       body.issuer       || "ZippyMesh",
    });
    return NextResponse.json(enrollment);
  }

  if (action === "confirm") {
    // Close the enrollment-lockout DoS: the vault must be unlocked and the
    // supplied password must be the real vault password, so TOTP can only be
    // enrolled under credentials that actually decrypt the vault. (Without
    // this, anyone could enroll TOTP under a bogus password and permanently
    // brick unlock.)
    if (!isVaultUnlocked()) {
      return NextResponse.json({ error: "Vault must be unlocked to enroll TOTP" }, { status: 403 });
    }
    const { password, secret, code, backupCodes } = body;
    if (!password || !verifyVaultPassword(password)) {
      return NextResponse.json({ error: "Incorrect vault password" }, { status: 401 });
    }
    const r = confirmTotpEnrollment({ password, secret, code, backupCodes });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "disable") {
    if (!isVaultUnlocked()) {
      return NextResponse.json({ error: "Vault must be unlocked to disable TOTP" }, { status: 403 });
    }
    const { password, code } = body;
    const r = disableTotp({ password, code });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "action must be one of: begin, confirm, disable" },
    { status: 400 },
  );
}

// Route-level auth: TOTP enrollment/disable and status must enforce session
// auth at the route (the edge alone doesn't prove key revocation / login mode).
export const GET = requireAuth(getHandler);
export const POST = requireAuth(postHandler);
