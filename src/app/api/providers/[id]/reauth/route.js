import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { checkAuth } from "@/lib/auth/middleware.js";
import { apiError } from "@/lib/apiErrors.js";

// POST /api/providers/[id]/reauth - Clear needs_reauth status to prepare for re-authentication
export async function POST(request, { params }) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return apiError(request, 404, "Connection not found");
    }

    // Reset status to pending so the UI knows re-auth is in progress
    await updateProviderConnection(id, {
      testStatus: "pending",
      lastError: null,
      lastErrorAt: null,
    });

    return NextResponse.json({
      provider: connection.provider,
      authType: connection.authType,
    });
  } catch (error) {
    console.log("Error resetting reauth status:", error);
    return apiError(request, 500, "Failed to reset reauth status");
  }
}
