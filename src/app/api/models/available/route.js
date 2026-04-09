import { NextResponse } from "next/server";
import { getProviderConnections, getModelAliases } from "@/models";
import { getCombos } from "@/lib/localDb.js";
import { SOTA_EQUIVALENCE } from "@/sse/config/modelEquivalence.js";
import { maybeAutoRefreshProviderCatalog } from "@/lib/providers/sync";
import { getRegistryModels } from "@/lib/modelRegistry";
import { apiError } from "@/lib/apiErrors";

/**
 * GET /api/models/available
 * Returns all available models from active providers + equivalence groups + combos
 * OpenClaw can use this to dynamically sync available models
 */
export async function GET(request) {
  try {
    await maybeAutoRefreshProviderCatalog();

    const [connections, aliases, combos, registryModels] = await Promise.all([
      getProviderConnections(),
      getModelAliases(),
      getCombos(),
      getRegistryModels({ lifecycleState: "active" }),
    ]);

    // Build model list from active provider connections and live registry inventory.
    const activeProviders = new Set(
      connections
        .filter((connection) => (connection.isEnabled ?? true) && connection.testStatus !== "error")
        .map((connection) => connection.provider)
    );

    const availableModels = new Set();

    for (const model of registryModels) {
      if (!activeProviders.has(model.provider)) continue;
      availableModels.add(`${model.provider}/${model.modelId}`);
    }

    // Include aliases (easy-to-use shortcuts) when they map to active models.
    for (const [alias, fullModel] of Object.entries(aliases || {})) {
      if (typeof fullModel !== "string") continue;
      const [providerId] = fullModel.split("/");
      if (providerId && activeProviders.has(providerId)) {
        availableModels.add(alias);
      }
    }

    // Add combo models
    combos.forEach((combo) => {
      if (combo.name) {
        availableModels.add(combo.name);
      }
    });

    // Build equivalence groups (which models are considered equivalent)
    const equivalenceGroups = SOTA_EQUIVALENCE || {};

    return NextResponse.json({
      availableModels: Array.from(availableModels).sort(),
      equivalenceGroups,
      combos: combos.map((combo) => ({
        name: combo.name,
        models: combo.models,
        description: combo.description || "Fallback combo",
        fallbackChain: true,
      })),
      totalProviders: connections.length,
      activeProviders: activeProviders.size,
      aliases,
      lastUpdated: new Date().toISOString(),
      cacheControlHint: "Can be cached for 5 minutes",
    });
  } catch (error) {
    console.error("[models/available] Error:", error.message);
    return apiError(request, 500, "Failed to fetch available models");
  }
}
