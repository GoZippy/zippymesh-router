import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { getProviderConnections, getCombos, getDb, getRoutingPlaybooks, getProviderNodes } from "@/lib/localDb";
import { getSidecarPeers } from "@/lib/sidecar";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { maybeAutoRefreshProviderCatalog } from "@/lib/providers/sync";

/**
 * Cloud providers with public/authenticated model endpoints
 */
const CLOUD_MODEL_ENDPOINTS = {
  kilo: { url: "https://api.kilo.ai/api/gateway/models", public: true },
  // Add more providers with models endpoints as needed
};

/**
 * Fetch models from a cloud provider's models endpoint
 */
async function fetchCloudModels(providerId, connection) {
  const config = CLOUD_MODEL_ENDPOINTS[providerId];
  if (!config) return null;
  
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
    if (!res.ok) return null;
    
    const data = await res.json();
    const raw = data?.data ?? data?.models ?? data?.results ?? (Array.isArray(data) ? data : []);
    const list = Array.isArray(raw) ? raw : [];
    return list.map(m => ({
      id: m.id,
      name: m.name || m.id,
      owned_by: m.owned_by,
    }));
  } catch (e) {
    console.log(`Failed to fetch models from ${providerId}:`, e.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch models from a local provider (Ollama or LMStudio)
 * Uses longer timeout for remote URLs (network/internet)
 */
async function fetchLocalModels(node) {
  const isLocalhost = node.baseUrl?.includes("localhost") || node.baseUrl?.includes("127.0.0.1");
  const timeout = isLocalhost ? 3000 : 8000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    if (node.apiType === "ollama") {
      // Ollama uses /api/tags
      const res = await fetch(`${node.baseUrl}/api/tags`, { signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map(m => ({
        id: m.name,
        name: m.name,
        size: m.size,
        modified: m.modified_at,
      }));
    } else {
      // OpenAI-compatible (LMStudio) uses /v1/models
      const url = node.baseUrl.endsWith('/v1') ? `${node.baseUrl}/models` : `${node.baseUrl}/v1/models`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map(m => ({
        id: m.id,
        name: m.id,
        owned_by: m.owned_by,
      }));
    }
  } catch (e) {
    return [];
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
 * Returns models from all active providers and combos in OpenAI format.
 * Clients must use the exact `id` from this response as the `model` in POST /v1/chat/completions.
 */
export async function GET() {
  try {
    // Keep model inventory fresh for all UI/API consumers hitting /v1/models.
    try {
      await maybeAutoRefreshProviderCatalog();
    } catch (refreshError) {
      console.log("Provider catalog auto-refresh skipped:", refreshError?.message || refreshError);
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

    // Add local provider models (Ollama, LMStudio) - include localhost and remote (network/internet)
    let localNodes = [];
    try {
      localNodes = await getProviderNodes();
      localNodes = localNodes.filter(n => n.baseUrl && n.type === "local");
    } catch (e) {
      console.log("Could not fetch local provider nodes");
    }

    // Fetch models from each local provider in parallel
    const localModelPromises = localNodes.map(async (node) => {
      const nodeModels = await fetchLocalModels(node);
      const prefix = node.apiType === "ollama" ? "ollama" : "lmstudio";
      return nodeModels.map(m => ({
        id: `${prefix}/${m.id}`,
        object: "model",
        created: timestamp,
        owned_by: prefix,
        permission: [],
        root: m.id,
        parent: null,
        zippy: { source: "local", baseUrl: node.baseUrl, nodeName: node.name },
      }));
    });

    const localModelResults = await Promise.all(localModelPromises);
    const seenLocalModels = new Set();
    for (const nodeModels of localModelResults) {
      for (const model of nodeModels) {
        // Dedupe in case multiple nodes have same model
        if (!seenLocalModels.has(model.id)) {
          seenLocalModels.add(model.id);
          models.push(model);
        }
      }
    }

    // Fetch models from cloud providers with dynamic endpoints (Kilo, etc.)
    const cloudProviderIds = Object.keys(CLOUD_MODEL_ENDPOINTS);
    const cloudFetchPromises = [];
    
    for (const providerId of cloudProviderIds) {
      // Check if this provider is active
      const conn = connections.find(c => c.provider === providerId);
      if (connections.length > 0 && !conn && !CLOUD_MODEL_ENDPOINTS[providerId].public) {
        continue; // Skip non-public providers without active connection
      }
      
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


    // Add provider models (skip providers we already fetched dynamically)
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      // Skip if we already fetched this provider dynamically
      if (dynamicProviders.has(alias)) continue;
      
      // If we have active providers, only include those; otherwise include all
      if (connections.length > 0 && !activeAliases.has(alias)) {
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
