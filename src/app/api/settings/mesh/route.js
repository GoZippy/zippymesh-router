import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { apiError } from "@/lib/apiErrors.js";

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
 */
export async function POST(request) {
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
