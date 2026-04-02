import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";
// Fallback for removed isCloudEnabled function
const isCloudEnabled = async () => false;

import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/syncCloud";
import { apiError } from "@/lib/apiErrors.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);

    if (!combo) {
      return apiError(request, 404, "Combo not found");
    }

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return apiError(request, 500, "Failed to fetch combo");
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return apiError(request, 400, "Name can only contain letters, numbers, - and _");
      }

      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return apiError(request, 400, "Combo name already exists");
      }
    }

    const combo = await updateCombo(id, body);

    if (!combo) {
      return apiError(request, 404, "Combo not found");
    }

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error updating combo:", error);
    return apiError(request, 500, "Failed to update combo");
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const success = await deleteCombo(id);

    if (!success) {
      return apiError(request, 404, "Combo not found");
    }

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return apiError(request, 500, "Failed to delete combo");
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
