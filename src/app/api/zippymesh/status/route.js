import { NextResponse } from "next/server";
import { getDb } from "@/lib/localDb";

/**
 * GET /api/zippymesh/status
 * Check ZippyMesh.com connection status
 */
export async function GET() {
  try {
    const db = await getDb();
    const connection = db.data.zippymeshConnection;

    if (!connection || !connection.connectionToken) {
      return NextResponse.json({ connected: false });
    }

    // Verify connection is still valid by pinging ZippyMesh.com
    const zippymeshUrl = process.env.NEXT_PUBLIC_ZIPPYMESH_URL || "https://zippymesh.com";
    
    try {
      const verifyRes = await fetch(`${zippymeshUrl}/api/connect/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionToken: connection.connectionToken,
          version: process.env.NEXT_PUBLIC_VERSION || "1.0.0",
        }),
      });

      if (!verifyRes.ok) {
        // Connection no longer valid
        delete db.data.zippymeshConnection;
        await db.write();
        return NextResponse.json({ connected: false });
      }

      const verifyData = await verifyRes.json();

      // Update last verified
      connection.lastVerified = new Date().toISOString();
      await db.write();

      return NextResponse.json({
        connected: true,
        userId: connection.userId,
        displayName: connection.displayName || verifyData.user?.displayName,
        connectedAt: connection.connectedAt,
        lastSync: connection.lastSync,
        permissions: connection.permissions,
      });
    } catch (fetchErr) {
      // Network error - assume still connected but offline
      return NextResponse.json({
        connected: true,
        offline: true,
        userId: connection.userId,
        displayName: connection.displayName,
        connectedAt: connection.connectedAt,
        lastSync: connection.lastSync,
        permissions: connection.permissions,
      });
    }
  } catch (error) {
    console.error("Status check error:", error);
    return NextResponse.json(
      { connected: false, error: "Failed to check status" },
      { status: 500 }
    );
  }
}
