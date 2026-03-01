import { NextResponse } from "next/server";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { getProviderConnections } from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";
import { MODEL_SCORES } from "@/shared/constants/modelScores.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function buildReasons(input) {
  const reasons = [];
  if (input.intentScore > 0) reasons.push(`strong_${input.intent}_score`);
  if (input.costScore > 0.7) reasons.push("low_cost_signal");
  if (input.latencyScore > 0.7) reasons.push("low_latency_signal");
  reasons.push(input.confidence);
  return reasons;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const intent = searchParams.get("intent") || "code";
    const budget = Number(searchParams.get("budget") || 0);
    const latencyTarget = Number(searchParams.get("latencyTarget") || 0);

    const [models, connections] = await Promise.all([
      getRegistryModels(),
      getProviderConnections({ isActive: true, isEnabled: true }),
    ]);
    const availableProviders = new Set(connections.map((conn) => conn.provider));

    const candidates = models
      .filter((model) => availableProviders.has(model.provider))
      .map((model) => {
        const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
        const scoreMeta = MODEL_SCORES[canonical.canonicalModelId] || null;
        const intentScore = Number(scoreMeta?.intents?.[intent] ?? 0.6);
        const confidence = scoreMeta?.confidence || "metadata_inferred";
        const inputCost = Number(model.inputPrice || 0);
        const outputCost = Number(model.outputPrice || 0);
        const approxRequestCost = (inputCost * 1000) + (outputCost * 500);

        const costScore =
          budget > 0
            ? clamp01(1 - (approxRequestCost / budget))
            : clamp01(1 - ((inputCost + outputCost) * 1000));

        const latency = Number(model.avgLatency || 0);
        const latencyScore =
          latencyTarget > 0
            ? clamp01(1 - latency / latencyTarget)
            : latency > 0
              ? clamp01(1 - latency / 2000)
              : 0.5;

        const confidenceWeight =
          confidence === "benchmark_backed" ? 1 : confidence === "community_validated" ? 0.85 : 0.7;
        const compositeScore = clamp01(
          (intentScore * 0.45 + costScore * 0.25 + latencyScore * 0.2 + confidenceWeight * 0.1)
        );

        return {
          modelId: model.modelId,
          variant: model.metadata?.variant || "default",
          providerOrRuntime: model.provider,
          compositeScore: Number(compositeScore.toFixed(4)),
          confidence,
          reasons: buildReasons({
            intent,
            intentScore,
            costScore,
            latencyScore,
            confidence,
          }),
          expectedCostUsd: Number((approxRequestCost / 1000000).toFixed(6)),
          expectedLatencyMs: latency || null,
          canonicalModelId: canonical.canonicalModelId,
        };
      })
      .sort((a, b) => b.compositeScore - a.compositeScore);

    return NextResponse.json({
      intent,
      candidates: candidates.slice(0, 50),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error building model recommendations:", error);
    return NextResponse.json({ error: "Failed to build recommendations" }, { status: 500 });
  }
}

