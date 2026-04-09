import { NextResponse } from "next/server";
import { getRateLimitConfigs, updateRateLimitConfig, getRateLimitState, getProviderConnections } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

// GET /api/routing/limits - Get rate limit configs, state, and connection cooldowns
export async function GET(request) {
    try {
        const [configs, state, connections] = await Promise.all([
            getRateLimitConfigs(),
            getRateLimitState(),
            getProviderConnections({ isActive: true })
        ]);

        // Build a complete list of configs, ensuring every active provider has at least an empty entry
        const allConfigs = { ...configs };
        for (const conn of connections) {
            if (!allConfigs[conn.provider]) {
                allConfigs[conn.provider] = { buckets: [] };
            }
        }

        // Connection cooldowns (rateLimitedUntil)
        const cooldowns = connections
            .filter(c => c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > Date.now())
            .map(c => ({
                connectionId: c.id,
                provider: c.provider,
                rateLimitedUntil: c.rateLimitedUntil,
                lastError: c.lastError
            }));

        return NextResponse.json({
            configs: allConfigs,
            state: state?.windows || {},
            cooldowns
        });
    } catch (error) {
        console.log("Error fetching rate limits:", error);
        return apiError(request, 500, "Failed to fetch rate limits");
    }
}

// POST /api/routing/limits - Update rate limit config for a provider
export async function POST(request) {
    try {
        const body = await request.json();
        const { providerId, config } = body;

        if (!providerId || !config) {
            return apiError(request, 400, "Provider ID and config are required");
        }

        const updated = await updateRateLimitConfig(providerId, config);

        return NextResponse.json({ config: updated });
    } catch (error) {
        console.log("Error updating rate limit:", error);
        return apiError(request, 500, "Failed to update rate limit");
    }
}
