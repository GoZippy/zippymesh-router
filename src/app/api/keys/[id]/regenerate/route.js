import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getRouterApiKey, revokeRouterApiKey, createRouterApiKey } from "@/lib/localDb.js";
import { isAuthenticated } from "@/lib/auth/login.js";
import { getSettings } from "@/lib/localDb.js";

// POST /api/keys/[id]/regenerate - Revoke old key, create new one, return new key
export async function POST(request, { params }) {
  const auth = await isAuthenticated();
  const settings = await getSettings();
  if (settings.requireLogin !== false && !auth) {
    return apiError(request, 401, "Unauthorized");
  }

  const { id } = await params;
  try {
    const existing = await getRouterApiKey(id);
    if (!existing) {
      return apiError(request, 404, "Key not found");
    }

    await revokeRouterApiKey(id);
    const { id: newId, rawKey } = await createRouterApiKey({
      name: existing.name,
      scopes: existing.scopes ? JSON.parse(existing.scopes) : undefined,
      expiresAt: existing.expiresAt,
    });

    return NextResponse.json({ id: newId, key: rawKey }, { status: 200 });
  } catch (error) {
    console.log("Error regenerating key:", error);
    return apiError(request, 500, "Failed to regenerate key");
  }
}
