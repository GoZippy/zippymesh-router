import { NextResponse } from "next/server";
import { getDb } from "@/lib/localDb";

/**
 * GET /api/zippymesh/permissions
 * Get current permission settings
 */
export async function GET() {
  try {
    const db = await getDb();
    const connection = db.data.zippymeshConnection;

    if (!connection) {
      return NextResponse.json(
        { error: "Not connected to ZippyMesh.com" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      permissions: connection.permissions,
    });
  } catch (error) {
    console.error("Get permissions error:", error);
    return NextResponse.json(
      { error: "Failed to get permissions" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/zippymesh/permissions
 * Update permission settings
 */
export async function PUT(request) {
  try {
    const body = await request.json();
    const db = await getDb();
    const connection = db.data.zippymeshConnection;

    if (!connection) {
      return NextResponse.json(
        { error: "Not connected to ZippyMesh.com" },
        { status: 404 }
      );
    }

    // Validate and update permissions
    const allowedPermissions = ["telemetry", "remoteCommands", "autoSync", "shareAggregated"];
    const newPermissions = { ...connection.permissions };

    for (const key of allowedPermissions) {
      if (typeof body[key] === "boolean") {
        newPermissions[key] = body[key];
      }
    }

    connection.permissions = newPermissions;
    await db.write();

    // Sync permission changes to ZippyMesh.com
    const zippymeshUrl = process.env.NEXT_PUBLIC_ZIPPYMESH_URL || "https://zippymesh.com";
    
    try {
      await fetch(`${zippymeshUrl}/api/connect/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionToken: connection.connectionToken,
          permissions: newPermissions,
        }),
      });
    } catch (syncErr) {
      console.warn("Failed to sync permissions to ZippyMesh.com:", syncErr);
    }

    return NextResponse.json({
      success: true,
      permissions: newPermissions,
    });
  } catch (error) {
    console.error("Update permissions error:", error);
    return NextResponse.json(
      { error: "Failed to update permissions" },
      { status: 500 }
    );
  }
}
