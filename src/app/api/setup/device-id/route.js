import { NextResponse } from "next/server";
import { getConsistentMachineId } from "@/shared/utils/machineId";

/**
 * GET /api/setup/device-id
 * Returns this instance's stable device id (derived from machine id + MACHINE_ID_SALT).
 * Use as X-Zippy-Device-Id in clients for device-aware routing.
 * Requires auth (dashboard session).
 */
export async function GET(request) {
  try {
    const deviceId = await getConsistentMachineId();
    return NextResponse.json({
      deviceId,
      hint: "Send this as X-Zippy-Device-Id header when calling /v1/chat/completions for device-aware routing.",
    });
  } catch (error) {
    console.error("[setup/device-id]", error?.message);
    return NextResponse.json(
      { error: "Failed to get device id" },
      { status: 500 }
    );
  }
}
