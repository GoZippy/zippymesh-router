/**
 * Unified Discovery Catalog Service
 * Provides a comprehensive view of all available models, playbooks, and routing options
 * for integration with tools, agents, and IDE extensions.
 */

import {
  getProviderConnections,
  getCombos,
  getDb,
  getRoutingPlaybooks,
  getProviderNodes,
  getSettings,
} from "@/lib/localDb";
import { getRegistryModels } from "@/lib/modelRegistry.js";
import { getSidecarPeers } from "@/lib/sidecar";
import {
  PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
} from "@/shared/constants/models";
import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
} from "@/shared/constants/providers";

/**
 * Intent definitions and their characteristics
 */
const INTENT_DEFINITIONS = {
  code: {
    name: "Code Generation",
    description: "Writing, analyzing, and refactoring code",
    requiredCapabilities: ["code"],
    preferredCapabilities: ["vision", "fast"],
    avoidCapabilities: [],
  },
  chat: {
    name: "Conversation",
    description: "General conversation and Q&A",
    requiredCapabilities: [],
    preferredCapabilities: ["fast"],
    avoidCapabilities: ["reasoning"],
  },
  reasoning: {
    name: "Complex Reasoning",
    description: "Multi-step problem solving and analysis",
    requiredCapabilities: ["reasoning"],
    preferredCapabilities: [],
    avoidCapabilities: [],
  },
  vision: {
    name: "Image Analysis",
    description: "Analyzing images and visual content",
    requiredCapabilities: ["vision"],
    preferredCapabilities: [],
    avoidCapabilities: [],
  },
  embedding: {
    name: "Embeddings",
    description: "Generating vector embeddings",
    requiredCapabilities: ["embedding"],
    preferredCapabilities: ["fast"],
    avoidCapabilities: [],
  },
  fast: {
    name: "Low Latency",
    description: "Ultra-fast inference with minimal latency",
    requiredCapabilities: ["fast"],
    preferredCapabilities: [],
    avoidCapabilities: ["reasoning"],
  },
  default: {
    name: "General Purpose",
    description: "Default routing for unspecified tasks",
    requiredCapabilities: [],
    preferredCapabilities: [],
    avoidCapabilities: [],
  },
};

/**
 * Detect model capabilities from model ID, name, and metadata
 */
export function detectCapabilities(modelId, name = "", metadata = {}) {
  const id = `${modelId}/${name}`.toLowerCase();
  const capabilities = new Set();

  // Vision detection
  if (
    id.includes("vision") ||
    id.includes("-vl") ||
    id.includes("ocr") ||
    id.includes("-v-") ||
    id.match(/\d+v\b/) ||
    metadata.vision ||
    metadata.hasVision
  ) {
    capabilities.add("vision");
  }

  // Code detection
  if (
    id.includes("code") ||
    id.includes("coder") ||
    id.includes("codex") ||
    metadata.code ||
    metadata.isCodeModel
  ) {
    capabilities.add("code");
  }

  // Reasoning detection
  if (
    id.includes("thinking") ||
    id.includes("reason") ||
    id.match(/\bo[13]\b/) ||
    id.includes("deepthink") ||
    id.includes("r1") ||
    metadata.reasoning ||
    metadata.canReason
  ) {
    capabilities.add("reasoning");
  }

  // Embedding detection
  if (
    id.includes("embed") ||
    id.includes("embedding") ||
    metadata.embedding ||
    metadata.isEmbedding
  ) {
    capabilities.add("embedding");
  }

  // Fast/Speed detection
  if (
    id.includes("flash") ||
    id.includes("mini") ||
    id.includes("nano") ||
    id.includes("tiny") ||
    id.includes("haiku") ||
    id.includes("fast") ||
    id.match(/\b[1-8]b\b/) ||
    metadata.fast ||
    metadata.isFast
  ) {
    capabilities.add("fast");
  }

  // Premium detection
  if (
    id.includes("opus") ||
    id.includes("-pro") ||
    id.includes("ultra") ||
    id.includes("-large") ||
    id.includes("gpt-5") ||
    id.match(/\b(70|72|405)b\b/) ||
    id.includes("-high") ||
    metadata.premium ||
    metadata.isPremium
  ) {
    capabilities.add("premium");
  }

  return Array.from(capabilities);
}

/**
 * Build a rich model object from raw model data
 */
function enrichModel(rawModel, provider, source, additionalMetadata = {}) {
  const modelId = rawModel.id || rawModel.model || "";
  const name = rawModel.name || modelId;
  const alias = additionalMetadata.alias || null;

  return {
    // Core identifiers
    id: modelId,
    name,
    alias,
    provider,
    source, // "cloud", "local", "playbook", "combo", "p2p", "static"

    // Routing hints
    fullModel: additionalMetadata.fullModel || null,
    fullId: additionalMetadata.fullId || null,

    // Capabilities
    capabilities: detectCapabilities(
      modelId,
      name,
      additionalMetadata.metadata || {}
    ),

    // Pricing
    isFree: additionalMetadata.isFree ?? false,
    inputPrice: additionalMetadata.inputPrice ?? null, // USD per 1M tokens
    outputPrice: additionalMetadata.outputPrice ?? null, // USD per 1M tokens
    estimatedCostPer1KInput: additionalMetadata.estimatedCostPer1KInput ?? null,

    // Context & capacity
    contextWindow: additionalMetadata.contextWindow ?? null,
    maxCompletionTokens:
      additionalMetadata.maxCompletionTokens ?? null,
    isFast: (additionalMetadata.metadata?.isFast || false) ||
      (additionalMetadata.estimatedLatency &&
        additionalMetadata.estimatedLatency < 2000),

    // Environment
    local: additionalMetadata.local ?? false,
    requiresAuth: additionalMetadata.requiresAuth ?? null,
    baseUrl: additionalMetadata.baseUrl ?? null,

    // Metadata
    description: additionalMetadata.description || null,
    deprecated: additionalMetadata.deprecated ?? false,
    metadata: additionalMetadata.metadata || {},
  };
}

/**
 * Get all models from all sources with rich metadata
 */
export async function getCatalogModels() {
  const models = [];
  const timestamp = new Date().toISOString();

  // Get active connections
  let connections = [];
  try {
    connections = await getProviderConnections();
    connections = connections.filter(c => c.isActive !== false);
  } catch (e) {
    console.log("Could not fetch connections:", e.message);
  }

  // 1. Local models (Ollama, LM Studio)
  let localNodes = [];
  try {
    localNodes = await getProviderNodes();
    localNodes = localNodes.filter(n => n.baseUrl && n.type === "local");
  } catch (e) {
    console.log("Could not fetch local nodes");
  }

  const localModelPromises = localNodes.map(async (node) => {
    const nodeModels = await fetchLocalModels(node);
    const prefix = node.apiType === "ollama" ? "ollama" : "lmstudio";
    return nodeModels.map(m =>
      enrichModel(m, prefix, "local", {
        fullModel: `${prefix}/${m.id}`,
        local: true,
        baseUrl: node.baseUrl,
      })
    );
  });

  const localResults = await Promise.all(localModelPromises);
  const seenLocal = new Set();
  for (const batch of localResults) {
    for (const model of batch) {
      if (!seenLocal.has(model.fullModel)) {
        seenLocal.add(model.fullModel);
        models.push(model);
      }
    }
  }

  // 2. Static provider models
  for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
    if (!Array.isArray(providerModels)) continue;

    // Map alias back to provider ID
    const providerId = Object.entries(PROVIDER_ID_TO_ALIAS).find(
      ([, a]) => a === alias
    )?.[0] || alias;

    for (const m of providerModels) {
      models.push(
        enrichModel(m, providerId, "static", {
          fullModel: `${providerId}/${m.id}`,
          requiresAuth: !FREE_PROVIDERS[providerId],
          alias: m.id,
        })
      );
    }
  }

  // 3. Registry models (dynamically discovered)
  let registryModels = [];
  try {
    registryModels = await getRegistryModels({ lifecycleState: "active" });
    for (const rm of registryModels) {
      if (!rm.provider || !rm.modelId) continue;
      models.push(
        enrichModel(
          { id: rm.modelId, name: rm.name },
          rm.provider,
          "registry",
          {
            fullModel: `${rm.provider}/${rm.modelId}`,
            contextWindow: rm.contextWindow,
          }
        )
      );
    }
  } catch (e) {
    console.log("Could not fetch registry models");
  }

  // 4. P2P Models
  try {
    const peers = await getSidecarPeers();
    for (const peer of peers) {
      if (peer.models) {
        for (const m of peer.models) {
          models.push(
            enrichModel(m, "p2p", "p2p", {
              fullModel: `p2p/${m.name}`,
              local: true,
            })
          );
        }
      }
    }
  } catch (e) {
    console.log("Could not fetch P2P peers");
  }

  // 5. Combos (smart model groups)
  try {
    const combos = await getCombos();
    for (const combo of combos) {
      models.push(
        enrichModel(
          { id: combo.name, name: combo.name },
          "combo",
          "combo",
          {
            description: combo.description,
            metadata: { isCombo: true, models: combo.models },
          }
        )
      );
    }
  } catch (e) {
    console.log("Could not fetch combos");
  }

  // 6. OpenRouter models (if configured)
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const { listOpenRouterModels } = await import("@/lib/providers/openrouter.js");
      const orModels = await listOpenRouterModels(openRouterKey);
      // Add to catalog only if not already present
      for (const model of orModels) {
        if (!models.find(m => m.id === model.id)) {
          models.push(model);
        }
      }
    } catch (e) {
      console.warn("[CatalogService] OpenRouter model sync failed:", e.message);
    }
  }

  // 7. Plugin provider models
  try {
    const { getPluginProviderModels } = await import('../plugins/pluginRegistry.js');
    const pluginModels = await getPluginProviderModels();
    if (pluginModels.length > 0) {
      models.push(...pluginModels);
      console.log(`[Catalog] Merged ${pluginModels.length} model(s) from plugins`);
    }
  } catch (e) {
    console.warn('[Catalog] Plugin model merge failed:', e.message);
  }

  return models;
}

/**
 * Get all playbooks with intent associations
 */
export async function getCatalogPlaybooks() {
  const playbooks = [];

  try {
    const allPlaybooks = await getRoutingPlaybooks();

    for (const pb of allPlaybooks) {
      // Infer intent from playbook name/description
      const inferredIntents = inferPlaybookIntents(pb.name, pb.description);

      playbooks.push({
        id: pb.id,
        name: pb.name,
        description: pb.description || "",
        intents: inferredIntents,
        models: pb.routes?.flatMap(r => r.models) || [],
        isActive: pb.isActive !== false,
        priority: pb.priority || 0,
        routes: pb.routes || [],
      });
    }
  } catch (e) {
    console.log("Could not fetch playbooks:", e.message);
  }

  return playbooks;
}

/**
 * Infer intents from playbook name and description
 */
function inferPlaybookIntents(name = "", description = "") {
  const text = `${name} ${description}`.toLowerCase();
  const intents = [];

  if (text.includes("code")) intents.push("code");
  if (text.includes("chat") || text.includes("qa") || text.includes("q&a"))
    intents.push("chat");
  if (
    text.includes("reason") ||
    text.includes("complex") ||
    text.includes("thinking")
  )
    intents.push("reasoning");
  if (text.includes("vision") || text.includes("image") || text.includes("ocr"))
    intents.push("vision");
  if (text.includes("embed")) intents.push("embedding");
  if (text.includes("fast") || text.includes("quick") || text.includes("quick"))
    intents.push("fast");

  return intents.length > 0 ? intents : ["default"];
}

/**
 * Get the full discovery catalog
 */
export async function getDiscoveryCatalog() {
  const models = await getCatalogModels();
  const playbooks = await getCatalogPlaybooks();

  // Build capability index
  const capabilityIndex = {};
  for (const model of models) {
    for (const cap of model.capabilities) {
      if (!capabilityIndex[cap]) capabilityIndex[cap] = [];
      capabilityIndex[cap].push(model.id);
    }
  }

  // Build provider index
  const providerIndex = {};
  for (const model of models) {
    if (!providerIndex[model.provider])
      providerIndex[model.provider] = [];
    providerIndex[model.provider].push(model.id);
  }

  return {
    generatedAt: new Date().toISOString(),
    version: "1.0",

    server: {
      type: "zmlr",
      name: "ZippyMesh LLM Router",
      capabilities: [
        "intent-routing",
        "cost-aware",
        "failover",
        "local-first",
        "p2p-support",
      ],
    },

    summary: {
      totalModels: models.length,
      totalPlaybooks: playbooks.length,
      totalProviders: Object.keys(providerIndex).length,
      totalCapabilities: Object.keys(capabilityIndex).length,
      bySource: {
        local: models.filter(m => m.local).length,
        cloud: models.filter(m => !m.local && m.source !== "p2p").length,
        p2p: models.filter(m => m.source === "p2p").length,
        free: models.filter(m => m.isFree).length,
        premium: models.filter(m => !m.isFree && m.source !== "combo").length,
      },
    },

    intents: INTENT_DEFINITIONS,
    models,
    playbooks,

    indices: {
      byCapability: capabilityIndex,
      byProvider: providerIndex,
      byIntent: buildIntentIndex(playbooks),
    },
  };
}

/**
 * Build an index of models by intent
 */
function buildIntentIndex(playbooks) {
  const index = {};

  for (const intent of Object.keys(INTENT_DEFINITIONS)) {
    index[intent] = playbooks
      .filter(pb => pb.intents.includes(intent))
      .map(pb => pb.id);
  }

  return index;
}

/**
 * Fetch local models from Ollama or LMStudio
 */
async function fetchLocalModels(node) {
  const timeout = node.baseUrl?.includes("localhost") ? 3000 : 8000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    if (node.apiType === "ollama") {
      const res = await fetch(`${node.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map(m => ({
        id: m.name,
        name: m.name,
        size: m.size,
        modified: m.modified_at,
      }));
    } else {
      const url = node.baseUrl.endsWith("/v1")
        ? `${node.baseUrl}/models`
        : `${node.baseUrl}/v1/models`;
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
