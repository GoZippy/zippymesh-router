import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getProviderConnectionById } from "@/models";
import { connectionTester } from "@/lib/maintenance/connectionTester";

/**
 * POST /api/maintenance/test
 * Manually trigger a connection test
 */
export async function POST(request) {
    try {
        const { id } = await request.json();
        if (!id) {
            return apiError(request, 400, "Connection ID is required");
        }

        const connection = await getProviderConnectionById(id);
        if (!connection) {
            return apiError(request, 404, "Connection not found");
        }

        const result = await connectionTester.testConnection(connection);

        return NextResponse.json({
            success: result.success,
            latency: result.latency,
            tps: result.tps,
            error: result.lastError
        });
    } catch (error) {
        console.error("[API] Maintenance test failed:", error);
        return apiError(request, 500, "Maintenance test failed");
    }
}
