import { NextResponse } from "next/server";

/**
 * POST /api/sync/cloud
 * Cloud sync has been permanently removed for security.
 * This endpoint returns 410 Gone for any action.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Cloud sync has been removed" },
    { status: 410 }
  );
}

