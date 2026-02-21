import { NextResponse } from "next/server";
import { getRateLimitConfigs, updateRateLimitConfig, getProviderConnections } from "@/models";

// GET /api/routing/limits - Get all rate limit configs
export async function GET() {
    try {
        const [configs, connections] = await Promise.all([
            getRateLimitConfigs(),
            getProviderConnections()
        ]);

        // Build a complete list of configs, ensuring every active provider has at least an empty entry
        const allConfigs = { ...configs };
        const activeConnections = connections.filter(c => c.isActive !== false);

        for (const conn of activeConnections) {
            if (!allConfigs[conn.provider]) {
                allConfigs[conn.provider] = { buckets: [] };
            }
        }

        return NextResponse.json({ configs: allConfigs });
    } catch (error) {
        console.log("Error fetching rate limits:", error);
        return NextResponse.json({ error: "Failed to fetch rate limits" }, { status: 500 });
    }
}

// POST /api/routing/limits - Update rate limit config for a provider
export async function POST(request) {
    try {
        const body = await request.json();
        const { providerId, config } = body;

        if (!providerId || !config) {
            return NextResponse.json({ error: "Provider ID and config are required" }, { status: 400 });
        }

        const updated = await updateRateLimitConfig(providerId, config);

        return NextResponse.json({ config: updated });
    } catch (error) {
        console.log("Error updating rate limit:", error);
        return NextResponse.json({ error: "Failed to update rate limit" }, { status: 500 });
    }
}
