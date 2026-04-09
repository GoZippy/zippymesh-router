import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
// Fallback for removed isCloudEnabled function
const isCloudEnabled = async () => false;

import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/syncCloud";
import { apiError } from "@/lib/apiErrors.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// GET /api/combos - Get all combos
export async function GET(request) {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return apiError(request, 500, "Failed to fetch combos");
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models } = body;

    if (!name) {
      return apiError(request, 400, "Name is required");
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return apiError(request, 400, "Name can only contain letters, numbers, - and _");
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return apiError(request, 400, "Combo name already exists");
    }

    const combo = await createCombo({ name, models: models || [] });

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return apiError(request, 500, "Failed to create combo");
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
    console.log("Error syncing to cloud:", error);
  }
}
