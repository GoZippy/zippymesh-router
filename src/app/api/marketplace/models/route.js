import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getRegistryModels } from "@/lib/modelRegistry";
import { getPricing } from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";
import { MODEL_SCORES } from "@/shared/constants/modelScores.js";
import { maybeAutoRefreshProviderCatalog } from "@/lib/providers/sync.js";
import { getUsageHistory } from "@/lib/usageDb.js";

/**
 * Compute average latency per model from usage history
 */
async function computeLatencyByModel() {
    try {
        const history = await getUsageHistory({});
        const latencyMap = {};
        
        for (const entry of history) {
            if (!entry.provider || !entry.model) continue;
            const key = `${entry.provider.toLowerCase()}/${entry.model}`;
            if (!latencyMap[key]) {
                latencyMap[key] = { sum: 0, count: 0 };
            }
            if (entry.latencyMs > 0) {
                latencyMap[key].sum += entry.latencyMs;
                latencyMap[key].count += 1;
            }
        }
        
        const result = {};
        for (const [key, data] of Object.entries(latencyMap)) {
            if (data.count > 0) {
                result[key] = Math.round(data.sum / data.count);
            }
        }
        return result;
    } catch (error) {
        console.error("Error computing latency:", error);
        return {};
    }
}

/**
 * GET /api/marketplace/models - Get all models from the global registry
 * Merges pricing (USD per 1M tokens) and latency for display.
 */
export async function GET(request) {
    try {
        await maybeAutoRefreshProviderCatalog();

        const { searchParams } = new URL(request.url);
        const provider = searchParams.get("provider");
        const isFree = searchParams.get("isFree") === "true";
        const search = searchParams.get("search");

        const [rawModels, pricing, latencyMap] = await Promise.all([
            getRegistryModels({ provider, isFree: searchParams.has("isFree") ? isFree : undefined, search }),
            getPricing(),
            computeLatencyByModel(),
        ]);

        const models = rawModels.map((model) => {
            const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
            const score = MODEL_SCORES[canonical.canonicalModelId] || null;
            const pricingEntry = pricing?.[model.provider]?.[model.modelId];
            const inputPrice = pricingEntry?.input ?? model.inputPrice;
            const outputPrice = pricingEntry?.output ?? model.outputPrice;
            
            const latencyKey = `${(model.provider || "").toLowerCase()}/${model.modelId}`;
            const avgLatency = latencyMap[latencyKey] || null;
            
            return {
                ...model,
                inputPrice: Number.isFinite(Number(inputPrice)) ? Number(inputPrice) : 0,
                outputPrice: Number.isFinite(Number(outputPrice)) ? Number(outputPrice) : 0,
                avgLatency,
                canonicalModelId: canonical.canonicalModelId,
                modelFamily: canonical.modelFamily,
                providerModelId: canonical.providerModelId,
                scores: score?.intents || {},
                scoreConfidence: score?.confidence || "metadata_inferred",
            };
        });

        return NextResponse.json({ models });
    } catch (error) {
        console.error("Error fetching marketplace models:", error);
        return apiError(request, 500, "Internal server error");
    }
}
