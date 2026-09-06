/**
 * Labs / experimental feature toggles.
 *
 *   GET   /api/labs  -> { features: catalog, flags: { key: boolean } }
 *   PATCH /api/labs  -> merge {key: boolean} updates (validated against the
 *                       catalog) into settings.experimentalFeatures
 *
 * Stored in settings.experimentalFeatures so it persists across version updates
 * (db.json shape-repair leaves unknown keys alone; new features default OFF).
 * requireAuth-gated (not edge-only) so a revoked/forged key can't flip features.
 */
import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { apiError } from "@/lib/apiErrors.js";
import { requireAuth } from "@/lib/auth/middleware.js";
import {
  LABS_FEATURES,
  DEFAULT_LABS_FLAGS,
  normalizeLabsFlags,
} from "@/lib/labs/features.js";

/** Current flags = defaults (all off) overlaid with whatever is persisted. */
async function currentFlags() {
  const settings = await getSettings();
  const stored = settings && typeof settings.experimentalFeatures === "object" && settings.experimentalFeatures
    ? settings.experimentalFeatures
    : {};
  return { ...DEFAULT_LABS_FLAGS, ...normalizeLabsFlags(stored) };
}

async function getHandler() {
  return NextResponse.json({ features: LABS_FEATURES, flags: await currentFlags() });
}

async function patchHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(request, 400, "Invalid JSON body");
  }
  // Accept either { experimentalFeatures: {...} } or a flat {key: bool} object.
  const updates = normalizeLabsFlags(
    body && typeof body === "object" && body.experimentalFeatures && typeof body.experimentalFeatures === "object"
      ? body.experimentalFeatures
      : body
  );
  if (Object.keys(updates).length === 0) {
    return apiError(request, 400, "No known experimental feature keys provided");
  }
  const merged = { ...(await currentFlags()), ...updates };
  await updateSettings({ experimentalFeatures: merged });
  return NextResponse.json({ flags: merged });
}

export const GET = requireAuth(getHandler);
export const PATCH = requireAuth(patchHandler);
