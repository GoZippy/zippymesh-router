import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { getProviderConnections, getCombos, getDb, getRoutingPlaybooks, getProviderNodes, getSettings } from "@/lib/localDb";
import { getSidecarPeers } from "@/lib/sidecar";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { maybeAutoRefreshProviderCatalog } from "@/lib/providers/sync";
import { isOfflineMode } from "@/lib/privacy/offlineMode.js";
import { getLocalModelIndex } from "@/lib/routing/localModelIndex.js";
import { requireApiKey } from "@/lib/auth/apiKey.js";
import { apiError } from "@/lib/apiErrors.js";

/**
 * Cloud providers with public/authenticated model endpoints.
 *
 * `public` no longer means "fetch unconditionally" (changed 2026-08-30). It used
 * to, which meant EVERY `GET /v1/models` call — on an install with no Kilo
 * connection, no cloud provider at all, and a user who chose ZMLR to keep their
 * traffic local — made an outbound request to api.kilo.ai and folded its ~366
 * models into the list. Now a cloud catalogue is fetched only when the operator
 * has an active connection for it, or when the caller explicitly asks for the
 * whole catalogue with `?all=1`, and never in offline mode.
 */
const CLOUD_MODEL_ENDPOINTS = {
  kilo: { url: "https://api.kilo.ai/api/gateway/models", public: true },
  // Add more providers with models endpoints as needed
};

/** Cloud catalogue TTL. The remote lists change on the scale of days; re-fetching
 *  them per request is what made this route a 5–28 s call. */
const CLOUD_CACHE_TTL_MS = 10 * 60 * 1000;
/** @type {Map<string, {fetchedAt: number, models: Array|null}>} */
const cloudModelCache = new Map();

/** Exported for tests. */
export function __clearModelsRouteCaches() {
  cloudModelCache.clear();
}

/**
 * Fetch models from a cloud provider's models endpoint (TTL-cached).
 */
async function fetchCloudModels(providerId, connection) {
  const config = CLOUD_MODEL_ENDPOINTS[providerId];
  if (!config) return null;

  const cached = cloudModelCache.get(providerId);
  if (cached && Date.now() - cached.fetchedAt < CLOUD_CACHE_TTL_MS) return cached.models;

  const timeout = 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {};
    const apiKey = typeof connection?.apiKey === "string" ? connection.apiKey.trim() : connection?.apiKey;
    // Always forward API key when available (needed for user-specific/premium model visibility).
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(config.url, { signal: controller.signal, headers });
    if (!res.ok) {
      cloudModelCache.set(providerId, { fetchedAt: Date.now(), models: null });
      return null;
    }

    const data = await res.json();
    const raw = data?.data ?? data?.models ?? data?.results ?? (Array.isArray(data) ? data : []);
    const list = Array.isArray(raw) ? raw : [];
    const models = list.map(m => ({
      id: m.id,
      name: m.name || m.id,
      owned_by: m.owned_by,
    }));
    cloudModelCache.set(providerId, { fetchedAt: Date.now(), models });
    return models;
  } catch (e) {
    console.log(`Failed to fetch models from ${providerId}:`, e.message);
    cloudModelCache.set(providerId, { fetchedAt: Date.now(), models: null });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Playbook models that can be used as model names for intent-based routing
const PLAYBOOK_MODELS = [
  { id: "zippymesh/code-focus", description: "High-quality code generation (Claude Sonnet, DeepSeek, Qwen-Coder)" },
  { id: "zippymesh/Fast-Code", description: "Low-latency code gen (Groq, Cerebras, local models)" },
  { id: "zippymesh/architect", description: "System design and planning (Claude Opus, GPT-5, Gemini Pro)" },
  { id: "zippymesh/ask", description: "General Q&A (cost-effective: GLM, Kilo, Groq)" },
  { id: "zippymesh/debug", description: "Debugging and troubleshooting (Claude, DeepSeek, GPT-4)" },
  { id: "zippymesh/review", description: "Code review and audits (Claude, GPT-4, Gemini)" },
  { id: "zippymesh/orchestrator", description: "Multi-agent coordination (GPT-4o, Claude, Gemini)" },
  { id: "zippymesh/document", description: "Long document analysis (Gemini 1M, Claude 200K)" },
  { id: "zippymesh/tool-agent", description: "Function calling and MCP (GPT-4o, Claude)" },
  { id: "free/code-focus", description: "Code gen with free models only (Groq, Cerebras, Ollama)" },
  { id: "free/fast", description: "Ultra-fast free inference (Groq, Cerebras)" },
  { id: "free/reasoning", description: "Complex reasoning with free models (Llama 3.3 70B)" },
  { id: "free/chat", description: "General chat with free models" },
  { id: "local/privacy-strict", description: "Local inference only (Ollama, LMStudio)" },
  { id: "urgent/premium", description: "Maximum quality for critical tasks (top-tier paid)" },
  { id: "mixed/budget-quality", description: "Free tiers first, paid fallback" },
  { id: "auto", description: "Auto-route based on context and intent" }
];

/**
 * Handle CORS preflight
 * ... (unchanged)
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list
 *
 * Returns the models this install can actually serve, in OpenAI format. Clients
 * must use the exact `id` from this response as the `model` in
 * `POST /v1/chat/completions`.
 *
 * Reworked 2026-08-30 (was 7–28 s, phoned home on every call, and listed 475
 * models an install with zero providers could not serve):
 *
 *  - **Only configured inventory.** Static `PROVIDER_MODELS` entries are emitted
 *    only for providers with an active connection. An install with no cloud
 *    provider gets its local runtimes, its playbooks and nothing else.
 *  - **`?all=1` / `?catalog=1`** restores the full static catalogue plus the
 *    public cloud catalogues, for a UI that wants to show what *could* be added.
 *  - **No blocking catalogue sync.** `maybeAutoRefreshProviderCatalog()` waits up
 *    to 30 s of deliberate jitter before it even starts; it is now fire-and-forget
 *    and is skipped entirely in offline mode.
 *  - **Cloud catalogues are cached** for 10 min and fetched only for providers
 *    the operator actually connected (or under `?all=1`). `ZIPPY_OFFLINE=true` /
 *    `settings.offlineMode` blocks the fetch outright.
 *  - **Gated by `requireApiKey`.** When the operator turns the setting on, this
 *    route needs the same `Authorization: Bearer <router key>` as chat; it used
 *    to leak the whole provider inventory unauthenticated.
 *
 * Model ids: `<provider>/<provider-local-id>` (`ollama/qwen3.5:4b`). The bare
 * provider-local id also resolves on `POST /v1/chat/completions` when exactly one
 * registered provider serves it — it is deliberately NOT advertised here,
 * because the qualified form is the one that is always unambiguous.
 */
export async function GET(request) {
  try {
    const url = (() => { try { return new URL(request?.url || "http://local/v1/models"); } catch { return null; } })();
    const wantAll = url ? (url.searchParams.get("all") === "1" || url.searchParams.get("catalog") === "1") : false;

    let settings = {};
    try {
      settings = (await getSettings()) || {};
    } catch (e) {
      console.log("Could not read settings for /v1/models:", e?.message || e);
    }

    // Same gate as POST /v1/chat/completions (src/sse/handlers/chat.js), and the
    // same error envelope as everything else on /v1 — apiError() so `type`,
    // `code`, `request_id` and the CORS header come from one place.
    if (settings.requireApiKey) {
      try {
        await requireApiKey(request);
      } catch (err) {
        return apiError(request, err?.code || 401, err?.message || "Missing API key");
      }
    }

    const offline = isOfflineMode(process.env, settings);

    // Keep model inventory fresh for all UI/API consumers hitting /v1/models —
    // but NEVER on the caller's clock. maybeAutoRefreshProviderCatalog() sleeps
    // a random 0–30 s jitter before syncing every configured provider; awaiting
    // it here is what made this route take 7–28 s.
    if (!offline) {
      Promise.resolve()
        .then(() => maybeAutoRefreshProviderCatalog())
        .catch((refreshError) => {
          console.log("Provider catalog auto-refresh skipped:", refreshError?.message || refreshError);
        });
    }

    // Get active provider connections
    let connections = [];
    try {
      connections = await getProviderConnections();
      // Filter to only active connections
      connections = connections.filter(c => c.isActive !== false);
    } catch (e) {
      console.log("Could not fetch providers, returning all models");
    }

    // Get combos
    let combos = [];
    try {
      combos = await getCombos();
    } catch (e) {
      console.log("Could not fetch combos");
    }

    let registryModels = [];
    try {
      registryModels = await getRegistryModels({ lifecycleState: "active" });
    } catch (e) {
      console.log("Could not fetch registry models:", e.message);
    }
    const registryModelsByProvider = new Map();
    for (const registryModel of registryModels) {
      if (!registryModel.provider || !registryModel.modelId) continue;
      const existing = registryModelsByProvider.get(registryModel.provider) || new Set();
      existing.add(registryModel.modelId);
      registryModelsByProvider.set(registryModel.provider, existing);
    }

    // Get P2P Peers
    let p2pPeers = [];
    try {
      p2pPeers = await getSidecarPeers();
    } catch (e) {
      console.log("Could not fetch sidecar peers");
    }

    // Build set of active provider aliases
    const activeAliases = new Set();
    for (const conn of connections) {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      activeAliases.add(alias);
    }

    // Collect models from active providers (or all if none active)
    const models = [];
    const timestamp = Math.floor(Date.now() / 1000);

    // Add playbook models first (zippymesh/*, free/*, etc.) for intent-based routing
    for (const playbook of PLAYBOOK_MODELS) {
      models.push({
        id: playbook.id,
        object: "model",
        created: timestamp,
        owned_by: "zippymesh",
        permission: [],
        root: playbook.id,
        parent: null,
        description: playbook.description,
      });
    }

    // Add combos (smart model groups)
    for (const combo of combos) {
      models.push({
        id: combo.name,
        object: "model",
        created: timestamp,
        owned_by: "combo",
        permission: [],
        root: combo.name,
        parent: null,
      });
    }

    // Add P2P Models
    const p2pModels = new Set();
    for (const peer of p2pPeers) {
      if (peer.models) {
        for (const model of peer.models) {
          // Avoid duplicates if multiple peers offer same model
          const modelId = `p2p/${model.name}`;
          if (!p2pModels.has(modelId)) {
            p2pModels.add(modelId);
            models.push({
              id: modelId,
              object: "model",
              created: timestamp,
              owned_by: "p2p",
              permission: [],
              root: model.name,
              parent: null,
              meta: {
                cost: model.cost_per_token,
                quantization: model.quantization
              }
            });
          }
        }
      }
    }

    // Add local provider models (Ollama, LMStudio) — include localhost and
    // remote (network/internet). Served from the shared TTL-cached index so a
    // warm call does not re-probe every runtime.
    try {
      const index = await getLocalModelIndex();
      for (const entry of index.entries) {
        models.push({
          id: entry.id,
          object: "model",
          created: timestamp,
          owned_by: entry.prefix,
          permission: [],
          root: entry.tag,
          parent: null,
          zippy: { source: "local", baseUrl: entry.node?.baseUrl, nodeName: entry.node?.name },
        });
      }
    } catch (e) {
      console.log("Could not fetch local provider models:", e?.message || e);
    }

    // Fetch models from cloud providers with dynamic endpoints (Kilo, etc.).
    // Only for providers the operator actually connected — unless ?all=1 asks
    // for the whole catalogue — and never while offline.
    const cloudProviderIds = Object.keys(CLOUD_MODEL_ENDPOINTS);
    const cloudFetchPromises = [];

    for (const providerId of cloudProviderIds) {
      const conn = connections.find(c => c.provider === providerId);
      const allowed = !offline && (conn || (wantAll && CLOUD_MODEL_ENDPOINTS[providerId].public));
      if (!allowed) continue;

      cloudFetchPromises.push(
        fetchCloudModels(providerId, conn).then(cloudModels => ({
          providerId,
          models: cloudModels,
        }))
      );
    }

    const cloudResults = await Promise.all(cloudFetchPromises);
    const dynamicProviders = new Set();
    
    for (const { providerId, models: cloudModels } of cloudResults) {
      if (cloudModels && cloudModels.length > 0) {
        dynamicProviders.add(providerId);
        for (const m of cloudModels) {
          // Use the model ID as-is if it already has a prefix, otherwise add provider prefix
          const modelId = m.id.includes('/') ? m.id : `${providerId}/${m.id}`;
          models.push({
            id: modelId,
            object: "model",
            created: timestamp,
            owned_by: providerId,
            permission: [],
            root: m.id,
            parent: null,
            zippy: { source: "cloud-dynamic", provider: providerId },
          });
        }
      }
    }

    // Add cached Kiro models
    const db = await getDb();
    const cached = db.data.cachedModels?.kiro || {};
    for (const [baseUrl, entry] of Object.entries(cached)) {
      for (const m of entry.list || []) {
        if (!m?.id) continue;
        const id = `kiro/${m.id}`;
        models.push({
          id,
          object: "model",
          created: timestamp,
          owned_by: "kiro",
          permission: [],
          root: m.id,
          parent: null,
          zippy: { source: "kiro-cache", baseUrl, fetchedAt: entry.fetchedAt, raw: m },
        });
      }
    }


    // Add provider models (skip providers we already fetched dynamically).
    //
    // Fixed 2026-08-30: the old condition was
    // `if (connections.length > 0 && !activeAliases.has(alias)) continue;`
    // — i.e. with ZERO connections it fell through and listed EVERY model in the
    // static catalogue, ~92 models nobody held a key for, on a fresh install.
    // A model id in this list now means "this install can serve it". `?all=1`
    // brings back the full catalogue for UIs that want to show what could be added.
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      // Skip if we already fetched this provider dynamically
      if (dynamicProviders.has(alias)) continue;

      if (!wantAll && !activeAliases.has(alias)) {
        continue;
      }

      const providerId = resolveProviderId(alias);
      const registryModelIds = registryModelsByProvider.get(providerId);

      const modelsToEmit = (registryModelIds && registryModelIds.size > 0)
        ? Array.from(registryModelIds)
        : providerModels.map((model) => model.id);

      for (const modelId of modelsToEmit) {
        models.push({
          id: `${alias}/${modelId}`,
          object: "model",
          created: timestamp,
          owned_by: alias,
          permission: [],
          root: modelId,
          parent: null,
        });
      }
    }

    return Response.json({
      object: "list",
      data: models,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
