import { NextResponse } from "next/server";
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
            return NextResponse.json({ error: "Connection ID is required" }, { status: 400 });
        }

        const connection = await getProviderConnectionById(id);
        if (!connection) {
            return NextResponse.json({ error: "Connection not found" }, { status: 404 });
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
        return NextResponse.json({ error: "Maintenance test failed" }, { status: 500 });
    }
}
