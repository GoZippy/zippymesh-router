import { NextResponse } from "next/server";
import { revokeRouterApiKey, isCloudEnabled } from "@/lib/localDb.js";
import { isAuthenticated } from "@/lib/auth/login.js";
import { getSettings } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

// cloud sync helpers are left in case
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/syncCloud";

// DELETE /api/keys/[id] - revoke API key
export async function DELETE(request, { params }) {
  const auth = await isAuthenticated();
  const settings = await getSettings();
  if (settings.requireLogin !== false && !auth) {
    return apiError(request, 401, "Unauthorized");
  }

  const { id } = await params;
  try {
    const ok = await revokeRouterApiKey(id);
    if (!ok) {
      return apiError(request, 404, "Key not found");
    }
    // optional sync
    await syncKeysToCloudIfEnabled();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting key:", error);
    return apiError(request, 500, "Failed to delete key");
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
