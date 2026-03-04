import { NextResponse } from "next/server";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { getPricing } from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";

/** Convert to USD per 1M tokens. Pricing stores $/1M directly. */
function asUsdPerM(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function GET() {
  try {
    const [models, pricing] = await Promise.all([getRegistryModels(), getPricing()]);
    const grouped = new Map();

    for (const model of models) {
      const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
      const canonicalKey = canonical.canonicalModelId;
      if (!grouped.has(canonicalKey)) {
        grouped.set(canonicalKey, {
          canonicalModelId: canonicalKey,
          modelDisplayName: model.name || model.modelId,
          offers: [],
        });
      }

      const pricingEntry = pricing?.[model.provider]?.[model.modelId];
      const inputPerMUsd = asUsdPerM(pricingEntry?.input ?? model.inputPrice);
      const outputPerMUsd = asUsdPerM(pricingEntry?.output ?? model.outputPrice);
      const source = pricingEntry ? "pricing_override_or_default" : "registry";

      grouped.get(canonicalKey).offers.push({
        provider: model.provider,
        providerModelId: model.modelId,
        tier: model.metadata?.tier || "default",
        inputPerMUsd: Number(inputPerMUsd.toFixed(6)),
        outputPerMUsd: Number(outputPerMUsd.toFixed(6)),
        source,
        lastValidatedAt: model.last_sync || new Date().toISOString(),
      });
    }

    const rows = Array.from(grouped.values()).map((row) => {
      const cheapest = [...row.offers].sort(
        (a, b) =>
          (a.inputPerMUsd + a.outputPerMUsd * 0.5) -
          (b.inputPerMUsd + b.outputPerMUsd * 0.5)
      )[0];

      return {
        ...row,
        normalizedScenarioCostUsd: cheapest
          ? Number((cheapest.inputPerMUsd + cheapest.outputPerMUsd * 0.5).toFixed(6))
          : 0,
      };
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      models: rows.sort((a, b) => a.normalizedScenarioCostUsd - b.normalizedScenarioCostUsd),
    });
  } catch (error) {
    console.error("Error fetching marketplace costs:", error);
    return NextResponse.json({ error: "Failed to fetch marketplace costs" }, { status: 500 });
  }
}

