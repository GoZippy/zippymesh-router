import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { apiError } from "@/lib/apiErrors.js";
import { requireRole } from "@/lib/auth/middleware.js";
import { USER_ROLES } from "@/lib/auth/rbac.js";

export const dynamic = "force-dynamic";

const VALID_MODES = ["private", "cluster", "public"];

/**
 * GET /api/settings/mesh
 *
 * Returns the current meshMode and meshAllowlist from persisted settings.
 * Defaults: meshMode = "private", meshAllowlist = []
 */
export async function GET(request) {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      meshMode: settings.meshMode ?? "private",
      meshAllowlist: settings.meshAllowlist ?? [],
    });
  } catch (err) {
    console.error("[settings/mesh] GET error:", err);
    return apiError(request, 500, "Failed to load mesh settings");
  }
}

/**
 * POST /api/settings/mesh
 *
 * Saves meshMode and/or meshAllowlist.
 *
 * Body (JSON):
 *   { meshMode?: "private"|"cluster"|"public", meshAllowlist?: string[] }
 *
 * meshAllowlist items may be bare nodeIds/endpoints or comma-separated strings —
 * we normalise to an array of trimmed non-empty strings.
 *
 * SECURITY: meshMode/meshAllowlist are system-sensitive keys (also gated as
 * PATCH_SYSTEM_KEYS in ../route.js). This dedicated route writes them directly,
 * so it MUST enforce the same admin+ role gate or it becomes a confused-deputy
 * bypass of that gate. Wrapped with requireRole(admin) at export.
 */
async function meshPostHandler(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return apiError(request, 400, "Invalid JSON body");
    }

    const updates = {};

    if (body.meshMode !== undefined) {
      if (!VALID_MODES.includes(body.meshMode)) {
        return apiError(
          request,
          400,
          `Invalid meshMode. Must be one of: ${VALID_MODES.join(", ")}`
        );
      }
      updates.meshMode = body.meshMode;
    }

    if (body.meshAllowlist !== undefined) {
      // Accept either an array or a single comma-separated string
      const raw = Array.isArray(body.meshAllowlist)
        ? body.meshAllowlist.join(",")
        : String(body.meshAllowlist);
      updates.meshAllowlist = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (Object.keys(updates).length === 0) {
      return apiError(request, 400, "No valid fields provided");
    }

    const saved = await updateSettings(updates);
    return NextResponse.json({
      meshMode: saved.meshMode ?? "private",
      meshAllowlist: saved.meshAllowlist ?? [],
    });
  } catch (err) {
    console.error("[settings/mesh] POST error:", err);
    return apiError(request, 500, "Failed to save mesh settings");
  }
}

// admin+ required to write system-sensitive mesh settings (open-mode/legacy
// owner is treated as superadmin by requireRole, preserving single-user UX).
export const POST = requireRole(USER_ROLES.ADMIN, meshPostHandler);
