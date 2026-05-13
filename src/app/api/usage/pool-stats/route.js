import { NextResponse } from "next/server";
import { getPoolStatsByConnection } from "@/lib/usageDb.js";
import { getProviderConnections, getSettings } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

/**
 * GET /api/usage/pool-stats
 * Returns per-connection usage metrics for the Global Account Pool table:
 * lastModel, lastUsedAt, calls24h, tokensIn24h, tokensOut24h, errors24h, uptimePct, avgLatencyMs24h.
 * All derived from local usage DB (last 24h). Uptime % = successCount/calls24h.
 */
export async function GET(request) {
  try {
    const settings = await getSettings();
    if (settings?.isDemoMode === true) {
      return NextResponse.json({ isDemo: true, stats: {} });
    }

    const connections = await getProviderConnections({});
    const connectionIds = connections.map((c) => c.id);
    const stats = await getPoolStatsByConnection(connectionIds);

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[pool-stats]", error);
    return apiError(request, 500, "Failed to load pool stats");
  }
}
