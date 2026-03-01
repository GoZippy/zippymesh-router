import { fetchProviderModels } from "./models.js";
import { registerModel } from "../modelRegistry.js";
import { getProviderConnections, getSettings, updateSettings, updatePricing } from "../localDb.js";

let syncInFlight = null;

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return false;
}

function normalizeContextWindow(model) {
  const candidates = [
    model?.context_length,
    model?.max_context_length,
    model?.contextWindow,
    model?.context_window,
  ];
  for (const candidate of candidates) {
    const num = asNumber(candidate);
    if (num !== null) return Math.floor(num);
  }
  return null;
}

function normalizePricingFromModel(providerId, modelId, model) {
  const pricing = model?.pricing;
  if (!pricing || typeof pricing !== "object") return null;

  // Some OpenAI-compatible gateways expose prompt/completion in USD per token.
  if (["openrouter", "kilo", "groq", "mistral", "xai", "deepseek", "cerebras", "cohere"].includes(providerId)) {
    const promptTokenUsd = asNumber(pricing.prompt);
    const completionTokenUsd = asNumber(pricing.completion);
    if (promptTokenUsd === null && completionTokenUsd === null) return null;

    const input = promptTokenUsd === null ? null : promptTokenUsd * 1_000_000;
    const output = completionTokenUsd === null ? null : completionTokenUsd * 1_000_000;
    const cached = asNumber(pricing.input_cache_read);
    const cacheCreation = asNumber(pricing.input_cache_write);

    return {
      provider: providerId,
      modelId,
      pricing: {
        ...(input !== null ? { input: Number(input.toFixed(6)) } : {}),
        ...(output !== null ? { output: Number(output.toFixed(6)) } : {}),
        ...(cached !== null ? { cached: Number((cached * 1_000_000).toFixed(6)) } : {}),
        ...(cacheCreation !== null ? { cache_creation: Number((cacheCreation * 1_000_000).toFixed(6)) } : {}),
        source: "live_models_endpoint",
        sourceUnit: "usd_per_million_tokens",
        updatedAt: new Date().toISOString(),
      },
    };
  }

  return null;
}

function normalizeModelRecord(providerId, model) {
  const modelId = String(model?.id || model?.model || model?.name || "").trim();
  if (!modelId) return null;

  const name = String(model?.name || modelId);
  const contextWindow = normalizeContextWindow(model);
  const priceObject = model?.pricing && typeof model.pricing === "object" ? model.pricing : null;
  const isFreeByPrice = priceObject ? Object.values(priceObject).every((v) => {
    const num = asNumber(v);
    return num === null || num === 0;
  }) : false;

  return {
    provider: providerId,
    modelId,
    name,
    description: model?.description || null,
    contextWindow,
    isFree: modelId.includes(":free") || toBool(model?.free) || isFreeByPrice,
    isPreview: toBool(model?.is_preview) || String(modelId).includes("preview"),
    isPremium: toBool(model?.is_premium),
    metadata: model,
  };
}

async function syncConnection(connection, options = {}) {
  const startedAt = new Date().toISOString();
  const rawModels = await fetchProviderModels(connection);
  const models = Array.isArray(rawModels) ? rawModels : [];
  const pricingUpdates = {};
  let registeredModels = 0;

  for (const rawModel of models) {
    const normalized = normalizeModelRecord(connection.provider, rawModel);
    if (!normalized) continue;

    await registerModel(normalized);
    registeredModels += 1;

    if (options.updatePricingFromModels !== false) {
      const normalizedPricing = normalizePricingFromModel(connection.provider, normalized.modelId, rawModel);
      if (normalizedPricing?.pricing) {
        pricingUpdates[connection.provider] ??= {};
        pricingUpdates[connection.provider][normalizedPricing.modelId] = normalizedPricing.pricing;
      }
    }
  }

  return {
    connectionId: connection.id,
    provider: connection.provider,
    startedAt,
    completedAt: new Date().toISOString(),
    fetchedModels: models.length,
    registeredModels,
    pricingModels: Object.keys(pricingUpdates[connection.provider] || {}).length,
    pricingUpdates,
  };
}

export async function syncProviderCatalog(options = {}) {
  const {
    force = false,
    providers = null,
    includeDisabled = false,
    updatePricingFromModels = true,
    triggeredBy = "manual",
  } = options;

  const settings = await getSettings();
  const intervalMinutes = Math.max(5, Number(settings.providerCatalogSyncIntervalMinutes || 180));
  const lastSyncAt = settings.providerCatalogLastSyncedAt ? Date.parse(settings.providerCatalogLastSyncedAt) : null;
  const now = Date.now();
  const staleMs = intervalMinutes * 60_000;

  if (!force && lastSyncAt && Number.isFinite(lastSyncAt) && (now - lastSyncAt) < staleMs) {
    return {
      skipped: true,
      reason: "within_refresh_window",
      intervalMinutes,
      lastSyncedAt: settings.providerCatalogLastSyncedAt,
    };
  }

  const filter = includeDisabled
    ? { isActive: true }
    : { isActive: true, isEnabled: true };
  const allConnections = await getProviderConnections(filter);
  const targetProviders = Array.isArray(providers) && providers.length
    ? new Set(providers.map((p) => String(p).trim()).filter(Boolean))
    : null;

  const connections = targetProviders
    ? allConnections.filter((c) => targetProviders.has(c.provider))
    : allConnections;

  const results = [];
  const warnings = [];
  const mergedPricing = {};

  for (const connection of connections) {
    try {
      const result = await syncConnection(connection, { updatePricingFromModels });
      results.push(result);

      for (const [providerId, entries] of Object.entries(result.pricingUpdates || {})) {
        mergedPricing[providerId] ??= {};
        Object.assign(mergedPricing[providerId], entries);
      }
    } catch (error) {
      warnings.push({
        connectionId: connection.id,
        provider: connection.provider,
        error: error?.message || String(error),
      });
    }
  }

  if (Object.keys(mergedPricing).length > 0) {
    await updatePricing(mergedPricing);
  }

  const summary = {
    triggeredBy,
    syncedAt: new Date().toISOString(),
    connectionsConsidered: connections.length,
    connectionsSynced: results.length,
    modelsRegistered: results.reduce((acc, r) => acc + (r.registeredModels || 0), 0),
    pricingModelsUpdated: Object.values(mergedPricing).reduce((acc, byModel) => acc + Object.keys(byModel || {}).length, 0),
    warningCount: warnings.length,
  };

  await updateSettings({
    providerCatalogLastSyncedAt: summary.syncedAt,
    providerCatalogLastSyncSummary: summary,
  });

  return { skipped: false, summary, results, warnings };
}

export async function maybeAutoRefreshProviderCatalog() {
  if (syncInFlight) return syncInFlight;

  const settings = await getSettings();
  if (settings.autoProviderCatalogSync === false) {
    return { skipped: true, reason: "auto_sync_disabled" };
  }

  syncInFlight = syncProviderCatalog({ force: false, triggeredBy: "auto" })
    .catch((error) => ({
      skipped: false,
      error: error?.message || String(error),
    }))
    .finally(() => {
      syncInFlight = null;
    });

  return syncInFlight;
}

// Exported for tests.
export const __internal = {
  normalizePricingFromModel,
  normalizeModelRecord,
};

