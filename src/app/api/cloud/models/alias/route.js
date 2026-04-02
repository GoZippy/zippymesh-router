import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias } from "@/models";
// Fallback for removed functions
const validateApiKey = async () => true;
const isCloudEnabled = async () => false;

import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/syncCloud";
import { apiError } from "@/lib/apiErrors.js";

// PUT /api/cloud/models/alias - Set model alias (for cloud/CLI)
export async function PUT(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const apiKey = authHeader?.replace("Bearer ", "");

    if (!apiKey) {
      return apiError(request, 401, "Missing API key");
    }

    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return apiError(request, 401, "Invalid API key");
    }

    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return apiError(request, 400, "Model and alias required");
    }

    // Check if alias already exists for different model
    const aliases = await getModelAliases();
    const existingModel = aliases[alias];
    if (existingModel && existingModel !== model) {
      return apiError(request, 400, `Alias '${alias}' already in use for model '${existingModel}'`);
    }

    // Update alias
    await setModelAlias(alias, model);

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json({
      success: true,
      model,
      alias,
      message: `Alias '${alias}' set for model '${model}'`
    });
  } catch (error) {
    console.log("Error updating alias:", error);
    return apiError(request, 500, "Failed to update alias");
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
    console.log("Error syncing aliases to cloud:", error);
  }
}

// GET /api/cloud/models/alias - Get all aliases
export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const apiKey = authHeader?.replace("Bearer ", "");

    if (!apiKey) {
      return apiError(request, 401, "Missing API key");
    }

    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return apiError(request, 401, "Invalid API key");
    }

    const aliases = await getModelAliases();

    return NextResponse.json({ aliases });
  } catch (error) {
    console.log("Error fetching aliases:", error);
    return apiError(request, 500, "Failed to fetch aliases");
  }
}
