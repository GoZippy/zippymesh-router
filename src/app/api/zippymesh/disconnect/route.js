import { NextResponse } from "next/server";
import { getDb } from "@/lib/localDb";

/**
 * POST /api/zippymesh/disconnect
 * Disconnect from ZippyMesh.com
 */
export async function POST() {
  try {
    const db = await getDb();

    // Clear connection
    delete db.data.zippymeshConnection;
    await db.write();

    return NextResponse.json({
      success: true,
      message: "Disconnected from ZippyMesh.com",
    });
  } catch (error) {
    console.error("Disconnect error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }
}
