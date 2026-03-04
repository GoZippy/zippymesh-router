import { NextResponse } from "next/server";
import { getRegistryModels } from "@/lib/modelRegistry";
import { getPricing } from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";
import { MODEL_SCORES } from "@/shared/constants/modelScores.js";
import { maybeAutoRefreshProviderCatalog } from "@/lib/providers/sync.js";

/**
 * GET /api/marketplace/models - Get all models from the global registry
 * Merges pricing (USD per 1M tokens) for display.
 */
export async function GET(request) {
    try {
        await maybeAutoRefreshProviderCatalog();

        const { searchParams } = new URL(request.url);
        const provider = searchParams.get("provider");
        const isFree = searchParams.get("isFree") === "true";
        const search = searchParams.get("search");

        const [rawModels, pricing] = await Promise.all([
            getRegistryModels({ provider, isFree: searchParams.has("isFree") ? isFree : undefined, search }),
            getPricing(),
        ]);

        const models = rawModels.map((model) => {
            const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
            const score = MODEL_SCORES[canonical.canonicalModelId] || null;
            const pricingEntry = pricing?.[model.provider]?.[model.modelId];
            const inputPrice = pricingEntry?.input ?? model.inputPrice;
            const outputPrice = pricingEntry?.output ?? model.outputPrice;
            return {
                ...model,
                inputPrice: Number.isFinite(Number(inputPrice)) ? Number(inputPrice) : 0,
                outputPrice: Number.isFinite(Number(outputPrice)) ? Number(outputPrice) : 0,
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
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
