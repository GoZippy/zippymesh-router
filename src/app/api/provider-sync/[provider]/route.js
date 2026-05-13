import { NextResponse } from "next/server";
import { getProviderConnections, getRateLimitConfig, getPricing, getSettings } from "@/lib/localDb.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { syncProviderCatalog } from "@/lib/providers/sync.js";
import { apiError } from "@/lib/apiErrors";

export async function POST(request, { params }) {
  try {
    const { provider } = await params;
    const providerConnections = await getProviderConnections({
      provider,
      isActive: true,
      isEnabled: true,
    });

    if (!providerConnections.length) {
      return apiError(request, 404, `No active connections found for provider '${provider}'`);
    }

    const [rateLimits, pricing, settings] = await Promise.all([
      getRateLimitConfig(provider),
      getPricing(),
      getSettings(),
    ]);
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
      providerHealth: settings.providerCatalogSyncHealth?.[provider] || {},
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
    return apiError(request, 500, "Provider sync failed");
  }
}

