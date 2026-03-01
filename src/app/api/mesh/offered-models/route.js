import { NextResponse } from "next/server";
import { getMeshOfferedModels, setMeshOfferedModels } from "@/lib/localDb.js";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { getPricing } from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";
import { getProviderSource } from "@/shared/constants/pricing.js";

const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:9480";

function asUsdPerM(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n * 1000 : 0;
}

function scenarioCost(inputPerMUsd, outputPerMUsd, inputWeight = 1, outputWeight = 0.5) {
  return inputPerMUsd * inputWeight + outputPerMUsd * outputWeight;
}

/**
 * GET - Returns offered models + available models with cost recommendations
 */
export async function GET() {
  try {
    const [offered, registryModels, pricing] = await Promise.all([
      getMeshOfferedModels(),
      getRegistryModels(),
      getPricing(),
    ]);

    const grouped = new Map();
    for (const model of registryModels) {
      const canonical = toCanonicalModel(model.provider, model.modelId, model.metadata || null);
      const key = canonical.canonicalModelId;
      const source = getProviderSource(model.provider);
      const isLocal = source === "local";

      const pricingEntry = pricing?.[model.provider]?.[model.modelId];
      const inputPerMUsd = asUsdPerM(pricingEntry?.input ?? model.input_price);
      const outputPerMUsd = asUsdPerM(pricingEntry?.output ?? model.output_price);
      const baseCostUsd = scenarioCost(inputPerMUsd, outputPerMUsd);

      if (!grouped.has(key)) {
        grouped.set(key, {
          canonicalModelId: key,
          displayName: model.name || model.modelId,
          offers: [],
        });
      }

      grouped.get(key).offers.push({
        provider: model.provider,
        modelId: model.modelId,
        source,
        isLocal,
        inputPerMUsd: Number(inputPerMUsd.toFixed(6)),
        outputPerMUsd: Number(outputPerMUsd.toFixed(6)),
        baseCostUsd: Number(baseCostUsd.toFixed(6)),
      });
    }

    const available = Array.from(grouped.values()).map((row) => {
      const sorted = [...row.offers].sort((a, b) => a.baseCostUsd - b.baseCostUsd);
      const cheapest = sorted[0];
      return {
        ...row,
        cheapestOffer: cheapest,
        spotPriceUsd: cheapest ? cheapest.baseCostUsd : 0,
      };
    });

    const offeredSet = new Set(offered.map((o) => o.canonicalModelId));

    const recommendations = available
      .filter((a) => !offeredSet.has(a.canonicalModelId))
      .sort((a, b) => {
        const localFirst = (x) => (x.cheapestOffer?.isLocal ? 0 : 1);
        if (localFirst(a) !== localFirst(b)) return localFirst(a) - localFirst(b);
        return a.spotPriceUsd - b.spotPriceUsd;
      })
      .slice(0, 8)
      .map((a) => ({
        canonicalModelId: a.canonicalModelId,
        displayName: a.displayName || a.canonicalModelId,
        spotPriceUsd: a.spotPriceUsd,
        source: a.cheapestOffer?.source,
        isLocal: a.cheapestOffer?.isLocal,
        reason: a.cheapestOffer?.isLocal ? "Local—near-zero cost" : `Low cost ($${a.spotPriceUsd.toFixed(4)}/1M)`,
      }));

    return NextResponse.json({
      offered,
      available,
      offeredIds: Array.from(offeredSet),
      recommendations,
    });
  } catch (error) {
    console.error("Error fetching offered models:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

/**
 * POST - Save offered models; syncs to sidecar with model names only (no provider)
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { offered } = body;

    if (!Array.isArray(offered)) {
      return NextResponse.json({ error: "offered must be an array" }, { status: 400 });
    }

    const validated = offered
      .filter((o) => o && typeof o.canonicalModelId === "string")
      .map((o) => ({
        canonicalModelId: String(o.canonicalModelId).trim(),
        displayName: o.displayName || o.canonicalModelId,
        backingProvider: o.backingProvider || null,
        backingModelId: o.backingModelId || null,
        source: o.source || "api-key",
        baseCostInputPerMUsd: Number(o.baseCostInputPerMUsd) || 0,
        baseCostOutputPerMUsd: Number(o.baseCostOutputPerMUsd) || 0,
        pricingStrategy: o.pricingStrategy || "spot+margin",
        marginPercent: Number(o.marginPercent) ?? 20,
        fixedPerRequestUsd: Number(o.fixedPerRequestUsd) ?? 0,
      }));

    await setMeshOfferedModels(validated);

    const models = validated.map((o) => {
      const margin = o.marginPercent ?? 20;
      const inputPerM = o.baseCostInputPerMUsd || 0;
      const outputPerM = o.baseCostOutputPerMUsd || 0;
      const bidInputPerM = inputPerM * (1 + margin / 100);
      const bidOutputPerM = outputPerM * (1 + margin / 100);
      const avgUsdPerM = (bidInputPerM + bidOutputPerM) / 2;
      const costPerToken = avgUsdPerM / 1e6;
      return {
        name: o.displayName || o.canonicalModelId,
        cost_per_token: Number(costPerToken.toFixed(8)),
        quantization: o.source === "local" ? "local" : "default",
      };
    });

    const res = await fetch(`${SIDECAR_URL}/mesh/exposed-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider_ids: [], models }),
    }).catch(() => null);

    if (!res?.ok) {
      console.warn("Sidecar mesh endpoint not available; offered models saved locally.");
    }

    return NextResponse.json({ offered: await getMeshOfferedModels() });
  } catch (error) {
    console.error("Error setting offered models:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
