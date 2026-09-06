/**
 * GET /api/auth/session — surface the caller's identity to the browser.
 *
 * The dashboard session JWT is httpOnly, so client code (e.g. the Sidebar's
 * role-based nav gating) cannot read the `role` claim directly. This endpoint
 * is the tiny, read-only seam that exposes ONLY what the UI needs:
 *
 *     { authenticated: boolean, username: string|null, role: string|null }
 *
 * It NEVER returns the token, password_hash, or any other claim. The shape is
 * intentionally minimal — the UI gate is a convenience; real enforcement lives
 * server-side in the admin routes (requireRole).
 *
 * Behaviour (mirrors the open-mode posture in middleware.js requireRole):
 *   - open mode (settings.requireLogin === false): there may be no JWT, yet the
 *     rest of the app treats the implicit single-user owner as superadmin. We
 *     report { authenticated:true, username:null, role:'superadmin' } so the
 *     Sidebar shows the same privileged controls the APIs would honour.
 *   - login required + valid session: surface the verified claims' username/role.
 *   - login required + no/invalid session: { authenticated:false, username:null,
 *     role:null } — fail-closed (the UI hides privileged entries).
 */
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb.js";
import { getSessionClaims } from "@/lib/auth/middleware.js";
import { USER_ROLES } from "@/lib/auth/rbac.js";

export async function GET() {
  try {
    const settings = await getSettings();

    // Open mode: login disabled -> implicit owner is superadmin (parity with
    // requireRole()'s open-mode treatment). No token is read or returned.
    if (settings?.requireLogin === false) {
      return NextResponse.json({
        authenticated: true,
        username: null,
        role: USER_ROLES.SUPERADMIN,
      });
    }

    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({
        authenticated: false,
        username: null,
        role: null,
      });
    }

    // Surface ONLY username + role. Never echo the token or any sensitive claim.
    return NextResponse.json({
      authenticated: true,
      username: typeof claims.username === "string" ? claims.username : null,
      role: typeof claims.role === "string" ? claims.role : null,
    });
  } catch {
    // Fail-closed on any unexpected error: report unauthenticated so the UI
    // hides privileged controls rather than leaking them.
    return NextResponse.json({
      authenticated: false,
      username: null,
      role: null,
    });
  }
}
