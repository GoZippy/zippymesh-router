import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, deleteModelAlias } from "@/models";
// Fallback for removed isCloudEnabled function
const isCloudEnabled = async () => false;

import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/syncCloud";
import { apiError } from "@/lib/apiErrors.js";

// GET /api/models/alias - Get all aliases
export async function GET(request) {
  try {
    const aliases = await getModelAliases();
    return NextResponse.json({ aliases });
  } catch (error) {
    console.log("Error fetching aliases:", error);
    return apiError(request, 500, "Failed to fetch aliases");
  }
}

// PUT /api/models/alias - Set model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return apiError(request, 400, "Model and alias required");
    }

    const aliases = await getModelAliases();

    // Check if alias already used by different model
    const existingModel = aliases[alias];
    if (existingModel && existingModel !== model) {
      return apiError(request, 400, `Alias '${alias}' already in use for model '${existingModel}'`);
    }

    // Delete old alias for this model (if exists and different from new alias)
    const oldAlias = Object.entries(aliases).find(([a, m]) => m === model && a !== alias)?.[0];
    if (oldAlias) {
      await deleteModelAlias(oldAlias);
    }

    await setModelAlias(alias, model);
    await syncToCloudIfEnabled();

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return apiError(request, 500, "Failed to update alias");
  }
}

// DELETE /api/models/alias?alias=xxx - Delete alias
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return apiError(request, 400, "Alias required");
    }

    await deleteModelAlias(alias);
    await syncToCloudIfEnabled();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting alias:", error);
    return apiError(request, 500, "Failed to delete alias");
  }
}

async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing aliases to cloud:", error);
  }
}
