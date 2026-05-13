import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { MODEL_SCORES } from "@/shared/constants/modelScores.js";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";

function averageIntentScore(intents = {}) {
  const values = Object.values(intents).map(Number).filter(Number.isFinite);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const intent = searchParams.get("intent");
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 500);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
    const models = await getRegistryModels();

    const rows = models.map((model) => {
      const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
      const score = MODEL_SCORES[canonical.canonicalModelId] || null;
      const intents = score?.intents || {};
      const overall = averageIntentScore(intents);

      return {
        provider: model.provider,
        modelId: model.modelId,
        canonicalModelId: canonical.canonicalModelId,
        confidence: score?.confidence || "metadata_inferred",
        source: score?.source || "metadata_inference",
        sourceUrl: score?.sourceUrl || "",
        intents,
        overallScore: Number(overall.toFixed(4)),
      };
    });

    const filtered = intent
      ? rows.filter((row) => row.intents?.[intent] !== undefined)
      : rows;

    const sorted = [...filtered].sort((a, b) => {
      const aScore = intent ? Number(a.intents[intent]) : a.overallScore;
      const bScore = intent ? Number(b.intents[intent]) : b.overallScore;
      return bScore - aScore;
    }).slice(offset, offset + limit);

    return NextResponse.json({
      intent: intent || null,
      scores: sorted,
      pagination: {
        total: sorted.length,
        limit,
        offset,
        hasMore: offset + limit < sorted.length
      }
    });
  } catch (error) {
    console.error("Error fetching model scores:", error);
    return apiError(request, 500, "Failed to fetch model scores");
  }
}

