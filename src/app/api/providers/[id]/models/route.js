import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getProviderConnectionById } from "@/lib/localDb";
import { fetchProviderModels } from "@/lib/providers/models";

/**
 * GET /api/providers/[id]/models - Get models list from provider
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return apiError(request, 404, "Connection not found");
    }

    try {
      const models = await fetchProviderModels(connection);
      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models
      });
    } catch (error) {
      console.log(`Error fetching models from ${connection.provider}:`, error.message);
      return apiError(request, 500, error.message || "Failed to fetch models");
    }
  } catch (error) {
    console.log("Error in models API:", error);
    return apiError(request, 500, "Internal server error");
  }
}
