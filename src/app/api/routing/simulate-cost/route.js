import { NextResponse } from "next/server";
import { getDiscoveryCatalog } from "@/lib/discovery/catalogService.js";

/**
 * POST /api/routing/simulate-cost
 * Simulates monthly cost for a given usage profile and constraints.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      requestsPerDay = 100,
      avgInputTokens = 800,
      avgOutputTokens = 400,
      constraints = {},
    } = body;

    const catalog = await getDiscoveryCatalog();
    const allModels = catalog.models || [];

    // Filter models based on constraints
    let candidates = allModels.filter(m => {
      if (constraints.preferFree && !m.isFree) return false;
      if (constraints.preferLocal && m.provider !== "ollama" && m.provider !== "lmstudio") return false;
      if (constraints.maxCostPerMTokens != null) {
        const blended = ((m.inputPrice || 0) + (m.outputPrice || 0)) / 2;
        if (blended > constraints.maxCostPerMTokens) return false;
      }
      return true;
    });

    // Sort by cost
    candidates = candidates
      .filter(m => m.inputPrice != null || m.outputPrice != null)
      .sort((a, b) => {
        const costA = (a.inputPrice || 0) * avgInputTokens / 1e6 + (a.outputPrice || 0) * avgOutputTokens / 1e6;
        const costB = (b.inputPrice || 0) * avgInputTokens / 1e6 + (b.outputPrice || 0) * avgOutputTokens / 1e6;
        return costA - costB;
      })
      .slice(0, 10);

    const monthlyRequests = requestsPerDay * 30;

    const breakdown = candidates.map(model => {
      const costPerRequest = (
        (model.inputPrice || 0) * avgInputTokens / 1e6 +
        (model.outputPrice || 0) * avgOutputTokens / 1e6
      );
      const monthlyCost = costPerRequest * monthlyRequests;
      return {
        model: model.id,
        name: model.name || model.id,
        provider: model.provider,
        isFree: model.isFree || false,
        inputPrice: model.inputPrice || 0,
        outputPrice: model.outputPrice || 0,
        costPerRequest: Math.round(costPerRequest * 100000) / 100000,
        monthlyCost: Math.round(monthlyCost * 100) / 100,
        warnings: generateWarnings(model, requestsPerDay, constraints),
      };
    });

    // Baseline: cheapest non-free paid model
    const baselineModel = allModels
      .filter(m => !m.isFree && (m.inputPrice > 0 || m.outputPrice > 0))
      .sort((a, b) => (a.inputPrice || 0) - (b.inputPrice || 0))[0];

    const baseline = baselineModel ? {
      model: baselineModel.id,
      monthlyCost: Math.round(
        ((baselineModel.inputPrice || 0) * avgInputTokens / 1e6 +
         (baselineModel.outputPrice || 0) * avgOutputTokens / 1e6) * monthlyRequests * 100
      ) / 100,
    } : null;

    const topModel = breakdown[0];
    const warnings = generateProfileWarnings(requestsPerDay, constraints, candidates);

    return NextResponse.json({
      breakdown,
      monthlyRequests,
      baseline,
      topRecommendation: topModel || null,
      warnings,
      simulatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[CostSimulator] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function generateWarnings(model, requestsPerDay, constraints) {
  const warnings = [];
  if (model.isFree && requestsPerDay > 50) {
    warnings.push("Free tier has rate limits — may fail at this volume");
  }
  if (model.provider === "ollama" || model.provider === "lmstudio") {
    warnings.push("Local model — depends on your hardware being available");
  }
  return warnings;
}

function generateProfileWarnings(requestsPerDay, constraints, candidates) {
  const warnings = [];
  if (constraints.preferFree && candidates.length === 0) {
    warnings.push("No free models found — try adding a Groq or OpenRouter connection");
  }
  if (constraints.preferFree && requestsPerDay > 100) {
    warnings.push("At this volume, free-tier rate limits may cause 5-20% request failures");
  }
  if (requestsPerDay > 1000 && !constraints.maxCostPerMTokens) {
    warnings.push("High volume — consider setting a cost cap to avoid surprises");
  }
  return warnings;
}
