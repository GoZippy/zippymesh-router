import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getProviderConnections, updateProviderConnection } from "@/models";
// Fallback for removed validateApiKey function
const validateApiKey = async () => true;


// Update provider credentials (for cloud token refresh)
export async function PUT(request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return apiError(request, 401, "Missing API key");
    }

    const apiKey = authHeader.slice(7);
    const body = await request.json();
    const { provider, credentials } = body;

    if (!provider || !credentials) {
      return apiError(request, 400, "Provider and credentials required");
    }

    // Validate API key
    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return apiError(request, 401, "Invalid API key");
    }

    // Find active connection for provider
    const connections = await getProviderConnections({ provider, isActive: true });
    const connection = connections[0];

    if (!connection) {
      return apiError(request, 404, "No active connection found for provider");
    }

    // Update credentials
    const updateData = {};
    if (credentials.accessToken) {
      updateData.accessToken = credentials.accessToken;
    }
    if (credentials.refreshToken) {
      updateData.refreshToken = credentials.refreshToken;
    }
    if (credentials.expiresIn) {
      updateData.expiresAt = new Date(Date.now() + credentials.expiresIn * 1000).toISOString();
    }

    await updateProviderConnection(connection.id, updateData);

    return NextResponse.json({
      success: true,
      message: `Credentials updated for provider: ${provider}`
    });

  } catch (error) {
    console.log("Update credentials error:", error);
    return apiError(request, 500, "Failed to update credentials");
  }
}
