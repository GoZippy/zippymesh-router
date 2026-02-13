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

/**
 * No-op stub — imported by ~14 API routes that call syncToCloud() after mutations.
 * Previously sent all provider credentials to the old cloud service. Now does nothing.
 */
export async function syncToCloud() {
  return { success: true, message: "Cloud sync disabled" };
}
