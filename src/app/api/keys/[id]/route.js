import { NextResponse } from "next/server";
import { revokeRouterApiKey } from "@/lib/localDb.js";
import { isAuthenticated } from "@/lib/auth/login.js";
import { getSettings } from "@/lib/localDb.js";

// cloud sync helpers are left in case
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/app/api/sync/cloud/route";

// DELETE /api/keys/[id] - revoke API key
export async function DELETE(request, { params }) {
  const auth = await isAuthenticated();
  const settings = await getSettings();
  if (settings.requireLogin !== false && !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  try {
    const ok = await revokeRouterApiKey(id);
    if (!ok) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    // optional sync
    await syncKeysToCloudIfEnabled();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
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
