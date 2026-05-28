import { NextResponse } from "next/server";
// NOTE: Cloud sync has been removed for security. The initializeCloudSync import
// previously pointed to a cloud scheduler that no longer exists. The route now
// returns a graceful "not available" response instead of crashing at import time.
// If local provider sync is needed on startup, call initLocalProviderConnections
// from @/lib/localDb directly.

// POST /api/sync/initialize - Run startup initialization
export async function POST(request) {
  // Cloud sync is not available in this build.
  return NextResponse.json({
    success: false,
    message: "Cloud sync is not available in this build"
  });
}

// GET /api/sync/status - Check initialization status
export async function GET(request) {
  return NextResponse.json({
    initialized: false,
    message: "Cloud sync is not available in this build"
  });
}
