import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { getPricing } from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";
import { getProviderSource } from "@/shared/constants/pricing.js";

/** Max sane price: $1000 per 1M tokens */
const MAX_USD_PER_M = 1000;

function asUsdPerM(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  if (number > MAX_USD_PER_M) return MAX_USD_PER_M;
  return number;
}

function scenarioCost(inputPerMUsd, outputPerMUsd, inputTokens = 1000000, outputTokens = 500000) {
  return (inputPerMUsd * inputTokens / 1000000) + (outputPerMUsd * outputTokens / 1000000);
}

/**
 * GET /api/marketplace/comparison-matrix
 * Returns a matrix comparing prices for the same model across different providers.
 * Rows: Canonical models
 * Columns: Providers offering that model
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetModel = searchParams.get("model");
    const inputTokens = parseInt(searchParams.get("inputTokens") || "1000000", 10);
    const outputTokens = parseInt(searchParams.get("outputTokens") || "500000", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const [models, pricing] = await Promise.all([getRegistryModels(), getPricing()]);

    // Group by canonical model
    const grouped = new Map();

    for (const model of models) {
      const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
      const canonicalKey = canonical.canonicalModelId;

      // Filter by target model if specified
      if (targetModel && !canonicalKey.toLowerCase().includes(targetModel.toLowerCase())) {
        continue;
      }

      if (!grouped.has(canonicalKey)) {
        grouped.set(canonicalKey, {
          canonicalModelId: canonicalKey,
          modelDisplayName: model.name || model.modelId,
          providers: [],
        });
      }

      const source = getProviderSource(model.provider);
      const tier = model.metadata?.tier || null;
      const tierKey = tier ? `${model.modelId}:${tier}` : null;
      const pricingEntry =
        (tierKey && pricing?.[model.provider]?.[tierKey]) ||
        pricing?.[model.provider]?.[model.modelId];
      const inputPerMUsd = asUsdPerM(pricingEntry?.input ?? model.inputPrice);
      const outputPerMUsd = asUsdPerM(pricingEntry?.output ?? model.outputPrice);
      const cost = scenarioCost(inputPerMUsd, outputPerMUsd, inputTokens, outputTokens);
      const isFree = model.isFree || (inputPerMUsd === 0 && outputPerMUsd === 0);

      // Determine provider type
      let providerType = "direct";
      if (source === "oauth") providerType = "oauth";
      else if (source === "local") providerType = "local";
      else if (["openrouter", "kilo"].includes(model.provider)) providerType = "reseller";

      grouped.get(canonicalKey).providers.push({
        provider: model.provider,
        providerModelId: model.modelId,
        tier,
        source,
        providerType,
        inputPerMUsd: Number(inputPerMUsd.toFixed(6)),
        outputPerMUsd: Number(outputPerMUsd.toFixed(6)),
        scenarioCostUsd: Number(cost.toFixed(6)),
        isFree,
      });
    }

    // Build matrix rows with cheapest provider highlighted
    const matrix = Array.from(grouped.values())
      .map((row) => {
        // Sort providers by cost
        row.providers.sort((a, b) => a.scenarioCostUsd - b.scenarioCostUsd);
        const cheapest = row.providers[0];

        return {
          ...row,
          cheapestProvider: cheapest?.provider || null,
          cheapestCost: cheapest?.scenarioCostUsd || null,
          providerCount: row.providers.length,
          // Add delta vs cheapest for each provider
          providers: row.providers.map((p) => ({
            ...p,
            deltaVsCheapest: cheapest ? Number((p.scenarioCostUsd - cheapest.scenarioCostUsd).toFixed(6)) : 0,
            isCheapest: p.provider === cheapest?.provider,
          })),
        };
      })
      .filter((row) => row.providers.length > 1) // Only show models with multiple providers
      .sort((a, b) => b.providerCount - a.providerCount)
      .slice(0, limit);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      scenario: { inputTokens, outputTokens },
      modelCount: matrix.length,
      matrix,
    });
  } catch (error) {
    console.error("Error fetching comparison matrix:", error);
    return apiError(request, 500, "Failed to fetch comparison matrix");
  }
}
