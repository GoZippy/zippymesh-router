import { NextResponse } from "next/server";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { getPricing, getCommunityPriceSubmissions, getFreeModels } from "@/lib/localDb.js";
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

function scenarioCost(inputPerMUsd, outputPerMUsd) {
  return inputPerMUsd * 1 + outputPerMUsd * 0.5;
}

/**
 * GET /api/marketplace/leaderboards
 * Returns leaderboard data: cost leaders, free models, community favorites
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "all";
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    const [models, pricing, communitySubmissions, freeModels] = await Promise.all([
      getRegistryModels(),
      getPricing(),
      getCommunityPriceSubmissions({}),
      getFreeModels(),
    ]);

    const results = {};

    // Cost Leaders: Cheapest provider per canonical model
    if (type === "all" || type === "cost") {
      const grouped = new Map();

      for (const model of models) {
        const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
        const canonicalKey = canonical.canonicalModelId;
        const source = getProviderSource(model.provider);

        const tier = model.metadata?.tier || null;
        const tierKey = tier ? `${model.modelId}:${tier}` : null;
        const pricingEntry =
          (tierKey && pricing?.[model.provider]?.[tierKey]) ||
          pricing?.[model.provider]?.[model.modelId];
        const inputPerMUsd = asUsdPerM(pricingEntry?.input ?? model.inputPrice);
        const outputPerMUsd = asUsdPerM(pricingEntry?.output ?? model.outputPrice);
        const cost = scenarioCost(inputPerMUsd, outputPerMUsd);

        if (!grouped.has(canonicalKey) || grouped.get(canonicalKey).cost > cost) {
          grouped.set(canonicalKey, {
            canonicalModelId: canonicalKey,
            modelDisplayName: model.name || model.modelId,
            provider: model.provider,
            providerModelId: model.modelId,
            tier,
            inputPerMUsd,
            outputPerMUsd,
            scenarioCostUsd: Number(cost.toFixed(6)),
            source,
            isFree: model.isFree || (inputPerMUsd === 0 && outputPerMUsd === 0),
            cost,
          });
        }
      }

      const costLeaders = Array.from(grouped.values())
        .filter(m => m.cost > 0) // Exclude free models from cost leaders
        .sort((a, b) => a.cost - b.cost)
        .slice(0, limit)
        .map(({ cost, ...rest }) => rest);

      results.costLeaders = costLeaders;
    }

    // Free Models: Models currently available for free
    if (type === "all" || type === "free") {
      const freeFromRegistry = models
        .filter(m => {
          const pricingEntry = pricing?.[m.provider]?.[m.modelId];
          const inputPerMUsd = asUsdPerM(pricingEntry?.input ?? m.inputPrice);
          const outputPerMUsd = asUsdPerM(pricingEntry?.output ?? m.outputPrice);
          return m.isFree || (inputPerMUsd === 0 && outputPerMUsd === 0);
        })
        .map(m => ({
          canonicalModelId: toCanonicalModel(m.provider, m.modelId, m.metadata || null).canonicalModelId,
          modelDisplayName: m.name || m.modelId,
          provider: m.provider,
          providerModelId: m.modelId,
          tier: m.metadata?.tier || null,
          source: getProviderSource(m.provider),
          freeLimit: m.metadata?.freeLimit || null,
        }));

      // Deduplicate by provider + modelId
      const seen = new Set();
      const uniqueFree = freeFromRegistry.filter(m => {
        const key = `${m.provider}:${m.providerModelId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      results.freeModels = uniqueFree.slice(0, limit);
    }

    // Community Favorites: Based on submission count or ratings
    if (type === "all" || type === "community") {
      const submissionCounts = new Map();
      for (const sub of communitySubmissions) {
        const key = `${sub.providerId}:${sub.modelId}`;
        submissionCounts.set(key, (submissionCounts.get(key) || 0) + 1);
      }

      const communityFavorites = Array.from(submissionCounts.entries())
        .map(([key, count]) => {
          const [providerId, modelId] = key.split(":");
          const subs = communitySubmissions.filter(
            s => s.providerId === providerId && s.modelId === modelId
          );
          const latestSub = subs[0];
          return {
            providerId,
            modelId,
            canonicalModelId: latestSub?.canonicalModelId,
            submissionCount: count,
            latestPrice: latestSub
              ? {
                  inputPerMUsd: latestSub.inputPerMUsd,
                  outputPerMUsd: latestSub.outputPerMUsd,
                  tier: latestSub.tier,
                }
              : null,
          };
        })
        .sort((a, b) => b.submissionCount - a.submissionCount)
        .slice(0, limit);

      results.communityFavorites = communityFavorites;
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      ...results,
    });
  } catch (error) {
    console.error("Error fetching leaderboards:", error);
    return NextResponse.json(
      { error: "Failed to fetch leaderboards" },
      { status: 500 }
    );
  }
}
