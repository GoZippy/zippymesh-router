import { NextResponse } from "next/server";
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
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
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
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.log("Error in models API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
