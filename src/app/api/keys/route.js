import { NextResponse } from "next/server";
import { listRouterApiKeys, createRouterApiKey } from "@/lib/localDb.js";
import { isAuthenticated } from "@/lib/auth/login.js";
import { getSettings } from "@/lib/localDb.js";

// cloud sync utilities may remain for later
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/app/api/sync/cloud/route";

// GET /api/keys - List API keys
export async function GET(request) {
  const auth = await isAuthenticated();
  const settings = await getSettings();
  if (settings.requireLogin !== false && !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const keys = await listRouterApiKeys();
    const safe = keys.map(k => ({ id: k.id, name: k.name, scopes: k.scopes ? JSON.parse(k.scopes) : [], createdAt: k.createdAt, expiresAt: k.expiresAt, revoked: k.revoked }));
    return NextResponse.json({ keys: safe });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  const auth = await isAuthenticated();
  const settings = await getSettings();
  if (settings.requireLogin !== false && !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, scopes, expiresAt } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const { id, rawKey } = await createRouterApiKey({ name, scopes, expiresAt });

    // Auto sync to Cloud if enabled (existing logic)
    await syncKeysToCloudIfEnabled();

    return NextResponse.json({ id, key: rawKey }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}

/**
 * Sync API keys to Cloud if enabled
 */
async function syncKeysToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing keys to cloud:", error);
  }
}
