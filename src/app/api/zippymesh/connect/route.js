import { NextResponse } from "next/server";
import { getDb } from "@/lib/localDb";

/**
 * POST /api/zippymesh/connect
 * Store connection details after OAuth flow
 */
export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.connectionToken) {
      return NextResponse.json(
        { error: "connectionToken is required" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Store connection
    db.data.zippymeshConnection = {
      connectionToken: body.connectionToken,
      connectionId: body.connectionId,
      userId: body.userId,
      displayName: body.displayName,
      permissions: body.permissions || {
        telemetry: false,
        remoteCommands: false,
        autoSync: true,
        shareAggregated: false,
      },
      connectedAt: new Date().toISOString(),
      lastSync: null,
      lastVerified: new Date().toISOString(),
    };

    await db.write();

    return NextResponse.json({
      success: true,
      message: "Connected to ZippyMesh.com",
    });
  } catch (error) {
    console.error("Connect error:", error);
    return NextResponse.json(
      { error: "Failed to connect" },
      { status: 500 }
    );
  }
}
