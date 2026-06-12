import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb.js";
import { getProviderCatalog } from "@/lib/providers/catalog.js";
import { syncProviderCatalog } from "@/lib/providers/sync.js";
import { apiError } from "@/lib/apiErrors";

export async function GET(request) {
  try {
    const [settings, catalog] = await Promise.all([
      getSettings(),
      Promise.resolve(getProviderCatalog()),
    ]);

    return NextResponse.json({
      syncedAt: settings.providerCatalogLastSyncedAt || null,
      intervalMinutes: Number(settings.providerCatalogSyncIntervalMinutes || 180),
      autoSyncEnabled: settings.autoProviderCatalogSync !== false,
      lastSummary: settings.providerCatalogLastSyncSummary || null,
      providerSyncHealth: settings.providerCatalogSyncHealth || {},
      coverage: catalog.summary,
    });
  } catch (error) {
    console.error("Error reading provider sync status:", error);
    return apiError(request, 500, "Failed to read provider sync status");
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = body?.force === true;
    const includeDisabled = body?.includeDisabled === true;
    const updatePricingFromModels = body?.updatePricingFromModels !== false;
    const providers = Array.isArray(body?.providers) ? body.providers : null;

    const result = await syncProviderCatalog({
      force,
      includeDisabled,
      updatePricingFromModels,
      providers,
      triggeredBy: "api",
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error running provider sync:", error);
    return apiError(request, 500, "Provider sync failed");
  }
}

