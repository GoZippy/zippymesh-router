import { NextResponse } from "next/server";
import initializeCloudSync from "@/shared/services/initializeCloudSync";

let syncInitialized = false;

// POST /api/sync/initialize - Run startup initialization
export async function POST(request) {
  try {
    if (syncInitialized) {
      return NextResponse.json({
        message: "Already initialized"
      });
    }

    await initializeCloudSync();
    syncInitialized = true;

    return NextResponse.json({
      success: true,
      message: "Initialization complete"
    });
  } catch (error) {
    console.log("Error during initialization:", error);
    return NextResponse.json({
      error: "Failed to initialize"
    }, { status: 500 });
  }
}

// GET /api/sync/status - Check initialization status
export async function GET(request) {
  return NextResponse.json({
    initialized: syncInitialized,
    message: syncInitialized ? "Initialized" : "Not initialized"
  });
}
