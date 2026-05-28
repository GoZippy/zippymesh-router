import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection, deleteProviderConnection } from "@/models";
// Fallback for removed isCloudEnabled function
const isCloudEnabled = async () => false;

import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/syncCloud";
import { toSafeProviderConnection } from "@/shared/utils/providerSecurity";
import { apiError } from "@/lib/apiErrors";

// GET /api/providers/[id] - Get single connection
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return apiError(request, 404, "Connection not found");
    }

    const result = toSafeProviderConnection(connection);

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error fetching connection:", error);
    return apiError(request, 500, "Failed to fetch connection");
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      priority,
      globalPriority,
      defaultModel,
      isActive,
      isEnabled,
      apiKey,
      testStatus,
      lastError,
      lastErrorAt,
      group,
      rateLimitedUntil,
    } = body;

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return apiError(request, 404, "Connection not found");
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
    if (isEnabled !== undefined && isActive === undefined) {
      updateData.isActive = isEnabled;
    }
    if (group !== undefined) updateData.group = group;
    if (rateLimitedUntil !== undefined) updateData.rateLimitedUntil = rateLimitedUntil;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;

    const updated = await updateProviderConnection(id, updateData);

    const result = toSafeProviderConnection(updated);

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error updating connection:", error);
    return apiError(request, 500, "Failed to update connection");
  }
}

// DELETE /api/providers/[id] - Delete connection
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteProviderConnection(id);
    if (!deleted) {
      return apiError(request, 404, "Connection not found");
    }

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.log("Error deleting connection:", error);
    return apiError(request, 500, "Failed to delete connection");
  }
}

/**
 * Sync to Cloud if enabled
 */
async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing providers to cloud:", error);
  }
}
