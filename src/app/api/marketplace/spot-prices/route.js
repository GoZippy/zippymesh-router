import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { getPricing } from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";
import { getProviderSource } from "@/shared/constants/pricing.js";

/** Max sane price: $1000 per 1M tokens (cap to avoid display issues) */
const MAX_USD_PER_M = 1000;

/** Convert to USD per 1M tokens. Pricing stores $/1M directly. Clamps negative and absurd values. */
function asUsdPerM(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  if (number > MAX_USD_PER_M) return MAX_USD_PER_M;
  return number;
}

function scenarioCost(inputPerMUsd, outputPerMUsd, inputWeight = 1, outputWeight = 0.5) {
  return inputPerMUsd * inputWeight + outputPerMUsd * outputWeight;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const filterSource = searchParams.get("source"); // local | cloud | oauth | api-key
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const [models, pricing] = await Promise.all([getRegistryModels(), getPricing()]);
    const grouped = new Map();

    for (const model of models) {
      const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
      const canonicalKey = canonical.canonicalModelId;
      const source = getProviderSource(model.provider);
      const isLocal = source === "local";

      if (filterSource && filterSource !== "all") {
        if (filterSource === "local" && !isLocal) continue;
        if (filterSource === "cloud" && source !== "api-key" && source !== "cloud") continue;
        if (filterSource === "oauth" && source !== "oauth") continue;
        if (filterSource === "api-key" && source !== "api-key") continue;
      }

      if (!grouped.has(canonicalKey)) {
        grouped.set(canonicalKey, {
          canonicalModelId: canonicalKey,
          modelDisplayName: model.name || model.modelId,
          offers: [],
        });
      }

      const tier = model.metadata?.tier || null;
      const tierKey = tier ? `${model.modelId}:${tier}` : null;
      // Try tier-specific pricing first, then fallback to base model pricing
      const pricingEntry =
        (tierKey && pricing?.[model.provider]?.[tierKey]) ||
        pricing?.[model.provider]?.[model.modelId];
      const inputPerMUsd = asUsdPerM(pricingEntry?.input ?? model.inputPrice);
      const outputPerMUsd = asUsdPerM(pricingEntry?.output ?? model.outputPrice);
      const isFree = model.isFree || (inputPerMUsd === 0 && outputPerMUsd === 0);

      grouped.get(canonicalKey).offers.push({
        provider: model.provider,
        providerModelId: model.modelId,
        tier,
        inputPerMUsd: Number(inputPerMUsd.toFixed(6)),
        outputPerMUsd: Number(outputPerMUsd.toFixed(6)),
        source,
        isLocal,
        isFree,
        lastValidatedAt: model.last_sync || new Date().toISOString(),
      });
    }

    const rows = Array.from(grouped.values()).map((row) => {
      const sorted = [...row.offers].sort(
        (a, b) =>
          scenarioCost(a.inputPerMUsd, a.outputPerMUsd) -
          scenarioCost(b.inputPerMUsd, b.outputPerMUsd)
      );
      const cheapestOffer = sorted[0];
      const spotPriceUsd = cheapestOffer
        ? Number(scenarioCost(cheapestOffer.inputPerMUsd, cheapestOffer.outputPerMUsd).toFixed(6))
        : 0;

      return {
        ...row,
        offers: row.offers.map((o) => ({
          ...o,
          costDeltaVsCheapest:
            cheapestOffer
              ? Number(
                  (
                    scenarioCost(o.inputPerMUsd, o.outputPerMUsd) -
                    scenarioCost(cheapestOffer.inputPerMUsd, cheapestOffer.outputPerMUsd)
                  ).toFixed(6)
                )
              : 0,
        })),
        cheapestOffer: cheapestOffer
          ? {
              provider: cheapestOffer.provider,
              providerModelId: cheapestOffer.providerModelId,
              tier: cheapestOffer.tier,
              inputPerMUsd: cheapestOffer.inputPerMUsd,
              outputPerMUsd: cheapestOffer.outputPerMUsd,
              source: cheapestOffer.source,
              isLocal: cheapestOffer.isLocal,
              isFree: cheapestOffer.isFree,
            }
          : null,
        spotPriceUsd,
      };
    });

    const sorted = rows
      .sort((a, b) => a.spotPriceUsd - b.spotPriceUsd)
      .slice(0, limit);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      models: sorted,
    });
  } catch (error) {
    console.error("Error fetching spot prices:", error);
    return apiError(request, 500, "Failed to fetch spot prices");
  }
}
