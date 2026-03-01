import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb.js";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";
import { MODEL_SCORES } from "@/shared/constants/modelScores.js";

function rankModelForIntent(model, intent) {
  const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
  const score = MODEL_SCORES[canonical.canonicalModelId]?.intents?.[intent];
  const fallback = intent === "code" ? 0.7 : 0.65;
  return Number(score ?? fallback);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const intent = body.intent || "code";
    const constraints = body.constraints || {};

    const [connections, models] = await Promise.all([
      getProviderConnections({ isActive: true, isEnabled: true }),
      getRegistryModels(),
    ]);

    const availableProviders = new Set(
      connections
        .filter((conn) => !constraints.localOnly || ["local", "ollama", "lmstudio", "llamacpp", "llama.cpp"].includes(conn.provider))
        .map((conn) => conn.provider)
    );

    const ranked = models
      .filter((model) => availableProviders.has(model.provider))
      .map((model) => {
        const intentScore = rankModelForIntent(model, intent);
        const cost = Number(model.inputPrice || 0) + Number(model.outputPrice || 0);
        const latency = Number(model.avgLatency || 1000);
        return {
          provider: model.provider,
          modelId: model.modelId,
          intentScore,
          cost,
          latency,
          score: intentScore * 0.65 + (1 / (1 + cost * 1000)) * 0.2 + (1 / (1 + latency / 1000)) * 0.15,
        };
      })
      .sort((a, b) => b.score - a.score);

    const providers = [];
    for (const row of ranked) {
      if (!providers.includes(row.provider)) providers.push(row.provider);
      if (providers.length >= 5) break;
    }

    const rules = [];
    if (providers.length) {
      rules.push({ type: "filter-in", target: providers.join(","), value: providers.join(",") });
    }
    if (constraints.budget) rules.push({ type: "sort-by-cheapest", target: "*" });
    if (constraints.latencyTarget) rules.push({ type: "sort-by-fastest", target: "*" });
    rules.push({ type: "stack", target: providers.join(","), value: "failover" });

    return NextResponse.json({
      intent,
      constraints,
      recommendations: ranked.slice(0, 10),
      draft: {
        name: `${intent[0].toUpperCase()}${intent.slice(1)} Auto Draft`,
        description: `Generated for intent '${intent}' with current availability and constraints.`,
        rules,
        isActive: true,
        priority: 5,
      },
    });
  } catch (error) {
    console.error("Error generating playbook draft:", error);
    return NextResponse.json({ error: "Failed to generate playbook draft" }, { status: 500 });
  }
}

