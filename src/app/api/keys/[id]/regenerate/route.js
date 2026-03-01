import { NextResponse } from "next/server";
import { getRouterApiKey, revokeRouterApiKey, createRouterApiKey } from "@/lib/localDb.js";
import { isAuthenticated } from "@/lib/auth/login.js";
import { getSettings } from "@/lib/localDb.js";

// cloud sync helpers
const isCloudEnabled = async () => false;

// POST /api/keys/[id]/regenerate - Revoke old key, create new one, return new key
export async function POST(request, { params }) {
  const auth = await isAuthenticated();
  const settings = await getSettings();
  if (settings.requireLogin !== false && !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const existing = await getRouterApiKey(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
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
    return NextResponse.json({ error: "Failed to regenerate key" }, { status: 500 });
  }
}
