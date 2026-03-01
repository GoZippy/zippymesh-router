import { NextResponse } from "next/server";
import { getProviderConnections, getRateLimitConfig, getPricing } from "@/lib/localDb.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { syncProviderCatalog } from "@/lib/providers/sync.js";

export async function POST(_request, { params }) {
  try {
    const { provider } = await params;
    const providerConnections = await getProviderConnections({
      provider,
      isActive: true,
      isEnabled: true,
    });

    if (!providerConnections.length) {
      return NextResponse.json(
        { error: `No active connections found for provider '${provider}'` },
        { status: 404 }
      );
    }

    const [rateLimits, pricing] = await Promise.all([getRateLimitConfig(provider), getPricing()]);
    const usageSnapshots = [];
    const warnings = [];

    for (const connection of providerConnections) {
      if (connection.authType !== "oauth") {
        warnings.push(`Connection ${connection.id} is API key based; usage API sync skipped`);
        continue;
      }
      try {
        const usage = await getUsageForProvider(connection);
        usageSnapshots.push({
          connectionId: connection.id,
          provider,
          fetchedAt: new Date().toISOString(),
          usage,
        });
      } catch (error) {
        warnings.push(`Usage sync failed for ${connection.id}: ${error.message}`);
      }
    }

    const modelSync = await syncProviderCatalog({
      force: true,
      providers: [provider],
      triggeredBy: "provider_sync_endpoint",
      updatePricingFromModels: true,
    });
    const refreshedPricing = await getPricing();

    return NextResponse.json({
      provider,
      syncedAt: new Date().toISOString(),
      summary: {
        connections: providerConnections.length,
        usageSnapshots: usageSnapshots.length,
        pricingModels: Object.keys(pricing?.[provider] || {}).length,
        bucketCount: (rateLimits?.buckets || []).length,
      },
      rateLimits: rateLimits || { buckets: [] },
      pricing: refreshedPricing?.[provider] || pricing?.[provider] || {},
      usageSnapshots,
      modelSync,
      warnings,
      schemaVersion: "1.0.0",
    });
  } catch (error) {
    console.error("Error syncing provider:", error);
    return NextResponse.json({ error: "Provider sync failed" }, { status: 500 });
  }
}

