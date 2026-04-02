import { NextResponse } from "next/server";
import { getRateLimitSuggestions } from "@/lib/localDb.js";
import { getSuggestedAlternatives } from "@/sse/config/modelEquivalence.js";
import { normalizeAlternativesToClientFormat } from "@/lib/alternativesFormat.js";
import { getRegistryModel } from "@/lib/modelRegistry.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { FREE_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/providers.js";
import { apiError } from "@/lib/apiErrors";

const FREE_PROVIDER_IDS = new Set([
  ...Object.keys(FREE_PROVIDERS || {}),
  ...Object.keys(APIKEY_PROVIDERS || {}).filter((id) => APIKEY_PROVIDERS[id]?.freeTier),
]);

/**
 * GET /api/routing/suggestions
 * - No query: returns saved rate-limit suggestions from DB.
 * - ?model=alias/modelId: returns equivalent models in client format, with isFree and recommended failover order.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url || "", "http://localhost");
  const modelParam = searchParams.get("model");

  if (modelParam && modelParam.trim()) {
    try {
      const rawAlternatives = getSuggestedAlternatives(modelParam.trim());
      const alternatives = normalizeAlternativesToClientFormat(rawAlternatives);
      const withMeta = await Promise.all(
        alternatives.map(async (clientId) => {
          const idx = clientId.indexOf("/");
          const alias = idx === -1 ? clientId : clientId.slice(0, idx);
          const modelId = idx === -1 ? "" : clientId.slice(idx + 1);
          const providerId = resolveProviderId(alias);
          const registry = await getRegistryModel(providerId, modelId).catch(() => null);
          if (registry && registry.lifecycleState !== "active") {
            return null;
          }
          const isFree = registry?.isFree ?? FREE_PROVIDER_IDS.has(providerId);
          return { id: clientId, isFree: !!isFree };
        })
      );
      const filtered = withMeta.filter((item) => item !== null);
      const failoverOrder = filtered
        .sort((a, b) => (a.isFree === b.isFree ? 0 : a.isFree ? 1 : -1))
        .map((x) => x.id);
      return NextResponse.json({
        model: modelParam.trim(),
        equivalents: filtered,
        failoverOrder,
      });
    } catch (error) {
      console.error("Error computing suggestions for model:", error);
      return apiError(request, 500, "Failed to get suggestions for model");
    }
  }

  try {
    const suggestions = await getRateLimitSuggestions();
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Error fetching rate limit suggestions:", error);
    return apiError(request, 500, "Failed to fetch suggestions");
  }
}
