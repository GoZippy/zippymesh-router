import { NextResponse } from "next/server";
import { getRegistryModels } from "@/lib/modelRegistry";
import { toCanonicalModel } from "@/lib/modelNormalization.js";
import { MODEL_SCORES } from "@/shared/constants/modelScores.js";
import { maybeAutoRefreshProviderCatalog } from "@/lib/providers/sync.js";

/**
 * GET /api/marketplace/models - Get all models from the global registry
 */
export async function GET(request) {
    try {
        await maybeAutoRefreshProviderCatalog();

        const { searchParams } = new URL(request.url);
        const provider = searchParams.get("provider");
        const isFree = searchParams.get("isFree") === "true";
        const search = searchParams.get("search");

        const rawModels = await getRegistryModels({
            provider,
            isFree: searchParams.has("isFree") ? isFree : undefined,
            search
        });

        const models = rawModels.map((model) => {
            const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
            const score = MODEL_SCORES[canonical.canonicalModelId] || null;
            return {
                ...model,
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
