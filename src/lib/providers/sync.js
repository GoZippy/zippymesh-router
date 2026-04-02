import { fetchProviderModels } from "./models.js";
import { registerModel, reconcileProviderModelLifecycle } from "../modelRegistry.js";
import { getProviderConnections, getSettings, updateSettings, updatePricing } from "../localDb.js";
import { emitProviderLifecycleEvent } from "../lifecycleEvents.js";

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

  // Providers that expose prompt/completion in USD per token in their models API.
  const livePricingProviders = [
    "openrouter", "kilo", "kiro", "groq", "mistral", "xai", "deepseek", "cerebras", "cohere",
    "togetherai", "fireworks", "anyscale", "perplexity", "deepinfra", "novita", "ai21", "moonshot",
  ];
  if (livePricingProviders.includes(providerId)) {
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
    isFree: modelId.includes(":free") || toBool(model?.free) || toBool(model?.isFree) || isFreeByPrice,
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
  const discoveredModelIds = [];

  for (const rawModel of models) {
    const normalized = normalizeModelRecord(connection.provider, rawModel);
    if (!normalized) continue;

    if (options.updatePricingFromModels !== false) {
      const normalizedPricing = normalizePricingFromModel(connection.provider, normalized.modelId, rawModel);
      if (normalizedPricing?.pricing) {
        pricingUpdates[connection.provider] ??= {};
        pricingUpdates[connection.provider][normalizedPricing.modelId] = normalizedPricing.pricing;
        normalized.inputPrice = normalizedPricing.pricing.input ?? 0;
        normalized.outputPrice = normalizedPricing.pricing.output ?? 0;
      }
    }

    await registerModel(normalized);
    discoveredModelIds.push(normalized.modelId);
    registeredModels += 1;
  }

  return {
    connectionId: connection.id,
    provider: connection.provider,
    startedAt,
    completedAt: new Date().toISOString(),
    fetchedModels: models.length,
    registeredModels,
    pricingModels: Object.keys(pricingUpdates[connection.provider] || {}).length,
    discoveredModelIds,
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
  const intervalMinutes = Math.max(5, Number(settings.providerCatalogSyncIntervalMinutes || 30));
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
  const providerRuns = new Map();
  const previousHealth = settings.providerCatalogSyncHealth || {};
  const providerHealth = { ...previousHealth };

  // 1. Pre-sync Oracle models if ORACLE_SYNC_ENABLED is true
  if (toBool(settings.ORACLE_SYNC_ENABLED)) {
    try {
      const oracleRes = await fetch("http://localhost:20200/v1/models", {
        signal: AbortSignal.timeout(5000)
      });
      if (oracleRes.ok) {
        const oracleData = await oracleRes.json();
        const oracleModels = oracleData.data || [];
        for (const m of oracleModels) {
          if (!m.id) continue;
          await registerModel({
             id: m.id,
             name: m.name || m.id,
             provider: "oracle",
             source: "oracle",
             tier: "local",
             capabilities: {
               chat: true,
               vision: false,
             },
          });
        }
        results.push({ provider: "oracle", fetchedModels: oracleModels.length, registeredModels: oracleModels.length });
        providerRuns.set("oracle", {
          provider: "oracle",
          connectionsAttempted: 1,
          connectionsSucceeded: 1,
          connectionErrors: [],
          modelsRegistered: oracleModels.length,
          pricingModels: 0,
          discoveredModelIds: new Set(oracleModels.map(m => m.id))
        });
      }
    } catch (err) {
      warnings.push({ provider: "oracle", error: "Oracle sync failed: " + err.message });
    }
  }

  // 1. Pre-sync Oracle models if ORACLE_SYNC_ENABLED is true
  if (toBool(settings.ORACLE_SYNC_ENABLED)) {
    try {
      const oracleRes = await fetch("http://localhost:20200/v1/models", {
        signal: AbortSignal.timeout(5000)
      });
      if (oracleRes.ok) {
        const oracleData = await oracleRes.json();
        const oracleModels = oracleData.data || [];
        for (const m of oracleModels) {
          if (!m.id) continue;
          await registerModel({
             id: m.id,
             name: m.name || m.id,
             provider: "oracle",
             source: "oracle",
             tier: "local",
             capabilities: {
               chat: true,
               vision: false,
             },
          });
        }
        results.push({ provider: "oracle", fetchedModels: oracleModels.length, registeredModels: oracleModels.length });
        providerRuns.set("oracle", {
          provider: "oracle",
          connectionsAttempted: 1,
          connectionsSucceeded: 1,
          connectionErrors: [],
          modelsRegistered: oracleModels.length,
          pricingModels: 0,
          discoveredModelIds: new Set(oracleModels.map(m => m.id))
        });
      }
    } catch (err) {
      warnings.push({ provider: "oracle", error: "Oracle sync failed: " + err.message });
    }
  }

  const getProviderRun = (provider) => {
    if (providerRuns.has(provider)) return providerRuns.get(provider);
    const state = {
      provider,
      connectionsAttempted: 0,
      connectionsSucceeded: 0,
      connectionErrors: [],
      modelsRegistered: 0,
      pricingModels: 0,
      discoveredModelIds: new Set(),
    };
    providerRuns.set(provider, state);
    return state;
  };

  for (const connection of connections) {
    const providerState = getProviderRun(connection.provider);
    providerState.connectionsAttempted += 1;
    await emitProviderLifecycleEvent("provider.sync.start", {
      provider: connection.provider,
      connectionId: connection.id,
      detail: { triggeredBy },
    });
    try {
      const result = await syncConnection(connection, { updatePricingFromModels });
      results.push(result);
      providerState.connectionsSucceeded += 1;
      providerState.modelsRegistered += result.registeredModels || 0;
      providerState.pricingModels += result.pricingModels || 0;
      for (const modelId of result.discoveredModelIds || []) {
        providerState.discoveredModelIds.add(modelId);
      }

      for (const [providerId, entries] of Object.entries(result.pricingUpdates || {})) {
        mergedPricing[providerId] ??= {};
        Object.assign(mergedPricing[providerId], entries);
      }
      await emitProviderLifecycleEvent("provider.sync.success", {
        provider: connection.provider,
        connectionId: connection.id,
        detail: {
          fetchedModels: result.fetchedModels || 0,
          registeredModels: result.registeredModels || 0,
          pricingModels: result.pricingModels || 0,
        },
      });
    } catch (error) {
      const warning = {
        connectionId: connection.id,
        provider: connection.provider,
        error: error?.message || String(error),
      };
      warnings.push(warning);
      providerState.connectionErrors.push(warning);
      await emitProviderLifecycleEvent("provider.sync.failure", {
        provider: connection.provider,
        connectionId: connection.id,
        status: 500,
        detail: { error: warning.error },
      });
    }
  }

  const providerSummaries = [];
  const syncedAt = new Date().toISOString();
  for (const [provider, providerState] of providerRuns.entries()) {
    let reconciliation = null;
    const hadSuccess = providerState.connectionsSucceeded > 0;
    if (hadSuccess) {
      reconciliation = await reconcileProviderModelLifecycle(provider, Array.from(providerState.discoveredModelIds));
    }

    const previous = previousHealth[provider] || {};
    const consecutiveFailureCount = hadSuccess
      ? 0
      : ((Number(previous.consecutiveFailureCount) || 0) + 1);

    providerHealth[provider] = {
      ...previous,
      lastRunAt: syncedAt,
      consecutiveFailureCount,
      connectionsAttempted: providerState.connectionsAttempted,
      connectionsSucceeded: providerState.connectionsSucceeded,
      lastAttemptedModels: providerState.discoveredModelIds.size,
      lastError: providerState.connectionErrors.length > 0
        ? providerState.connectionErrors[providerState.connectionErrors.length - 1].error
        : null,
      lastFailureAt: hadSuccess ? null : syncedAt,
      lastSuccessAt: hadSuccess ? syncedAt : (previous.lastSuccessAt || null),
      warningCount: providerState.connectionErrors.length,
      status: hadSuccess ? (providerState.connectionsSucceeded < providerState.connectionsAttempted ? "partial_success" : "success") : "failed",
    };

    if (reconciliation) {
      providerHealth[provider].reconciliation = reconciliation;
    }

    await emitProviderLifecycleEvent("provider.health.update", {
      provider,
      detail: {
        status: providerHealth[provider].status,
        warningCount: providerHealth[provider].warningCount,
        consecutiveFailureCount: providerHealth[provider].consecutiveFailureCount,
        lastAttemptedModels: providerHealth[provider].lastAttemptedModels,
      },
    });

    providerSummaries.push({
      provider,
      connectionsAttempted: providerState.connectionsAttempted,
      connectionsSucceeded: providerState.connectionsSucceeded,
      modelsRegistered: providerState.modelsRegistered,
      pricingModelsUpdated: providerState.pricingModels,
      warnings: providerState.connectionErrors.length,
      reconciled: reconciliation,
    });
  }

  if (Object.keys(mergedPricing).length > 0) {
    await updatePricing(mergedPricing);
  }

  const summary = {
    triggeredBy,
    syncedAt,
    connectionsConsidered: connections.length,
    connectionsSynced: results.length,
    modelsRegistered: results.reduce((acc, r) => acc + (r.registeredModels || 0), 0),
    pricingModelsUpdated: Object.values(mergedPricing).reduce((acc, byModel) => acc + Object.keys(byModel || {}).length, 0),
    warningCount: warnings.length,
    providersConsidered: providerRuns.size,
    providerSummaries,
  };

  await updateSettings({
    providerCatalogLastSyncedAt: summary.syncedAt,
    providerCatalogLastSyncSummary: summary,
    providerCatalogSyncHealth: providerHealth,
  });

  return { skipped: false, summary, results, warnings };
}

/** Max jitter (ms) before starting auto sync to avoid thundering herd when many triggers fire. */
const AUTO_SYNC_JITTER_MS = 30_000;

export async function maybeAutoRefreshProviderCatalog() {
  if (syncInFlight) return syncInFlight;

  const settings = await getSettings();
  if (settings.autoProviderCatalogSync === false) {
    return { skipped: true, reason: "auto_sync_disabled" };
  }

  // Single-flight: one catalog sync at a time. Jitter before starting to spread load.
  const jitterMs = Math.floor(Math.random() * (AUTO_SYNC_JITTER_MS + 1));
  syncInFlight = (async () => {
    if (jitterMs > 0) {
      await new Promise((r) => setTimeout(r, jitterMs));
    }
    return syncProviderCatalog({ force: false, triggeredBy: "auto" });
  })()
    .catch((error) => ({
      skipped: false,
      error: error?.message || String(error),
    }))
    .finally(() => {
      syncInFlight = null;
    });

  return syncInFlight;
}

// Exported for tests and for provider-specific sync (e.g. Kiro) that need to register raw model lists.
export const __internal = {
  normalizePricingFromModel,
  normalizeModelRecord,
};

