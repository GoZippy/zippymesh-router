/**
 * Intelligent Failover Manager for ZippyMesh LLM Router
 * 
 * Ensures requests never fail by implementing multi-layer failover:
 * 1. Same model from different provider
 * 2. Equivalent models from playbook stack
 * 3. Free tier fallbacks
 * 4. Local providers (Ollama, LMStudio)
 * 5. ZippyMesh network (future)
 */

import { getProviderConnections, getSettings, getProviderNodes } from '../localDb.js';
import { resolveProviderId, FREE_PROVIDERS, APIKEY_PROVIDERS, LOCAL_PROVIDERS } from '../../shared/constants/providers.js';
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from '../../shared/constants/models.js';
import { getEquivalentModels } from '../../sse/config/modelEquivalence.js';

// Cache for dynamically fetched local provider models (TTL: 5 minutes)
const localModelCache = new Map();
const LOCAL_MODEL_CACHE_TTL = 5 * 60 * 1000;

/**
 * Fetch models from a local provider (Ollama or LM Studio)
 * @param {string} providerId - "ollama" or "lmstudio"
 * @param {string} baseUrl - The base URL of the local provider
 * @returns {Promise<string[]>} List of model IDs
 */
async function fetchLocalProviderModels(providerId, baseUrl) {
  if (!baseUrl) return [];
  
  // Check cache first
  const cacheKey = `${providerId}:${baseUrl}`;
  const cached = localModelCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LOCAL_MODEL_CACHE_TTL) {
    return cached.models;
  }

  try {
    let models = [];
    
    if (providerId === "ollama") {
      // Ollama uses /api/tags endpoint
      const res = await fetch(`${baseUrl}/api/tags`, { 
        signal: AbortSignal.timeout(5000) 
      });
      if (res.ok) {
        const data = await res.json();
        models = (data.models || []).map(m => m.name || m.model);
      }
    } else {
      // LM Studio and other OpenAI-compatible use /v1/models
      const res = await fetch(`${baseUrl}/v1/models`, { 
        signal: AbortSignal.timeout(5000) 
      });
      if (res.ok) {
        const data = await res.json();
        models = (data.data || []).map(m => m.id);
      }
    }

    // Cache the results
    localModelCache.set(cacheKey, { models, timestamp: Date.now() });
    return models;
  } catch (err) {
    // Silently fail - local provider may be offline
    return [];
  }
}

/**
 * Get models for a local provider, dynamically fetching if needed
 * @param {string} providerId - "ollama" or "lmstudio"
 * @returns {Promise<string[]>} List of model IDs
 */
async function getLocalProviderModels(providerId) {
  // First try static models
  const staticModels = getModelsByProviderId(providerId);
  if (staticModels.length > 0) {
    return staticModels.map(m => typeof m === 'string' ? m : m.id);
  }

  // Find the local node to get baseUrl
  const nodes = await getProviderNodes({ type: "local" });
  const targetApiType = providerId === "ollama" ? "ollama" : "openai";
  const node = nodes.find(n => n.apiType === targetApiType);

  if (!node?.baseUrl) return [];

  return await fetchLocalProviderModels(providerId, node.baseUrl);
}

// Model equivalence groups for cross-provider failover
const MODEL_EQUIVALENCE_GROUPS = {
    'claude-sonnet': ['claude-3-5-sonnet', 'claude-sonnet-4', 'claude-sonnet-4-5'],
    'claude-opus': ['claude-opus-4', 'claude-opus-4-5', 'claude-opus-4-6'],
    'gpt-4': ['gpt-4o', 'gpt-4-turbo', 'gpt-4'],
    'gpt-4o': ['gpt-4o', 'gpt-4o-mini'],
    'llama-70b': ['llama-3.3-70b', 'llama-3.1-70b', 'llama-3-70b'],
    'llama-8b': ['llama-3.3-8b', 'llama-3.1-8b', 'llama-3-8b'],
    'deepseek-coder': ['deepseek-coder', 'deepseek-coder-v2', 'deepseek-v3'],
    'qwen-coder': ['qwen-2.5-coder', 'qwen-coder', 'qwen3-coder'],
    'gemini-pro': ['gemini-2.5-pro', 'gemini-pro', 'gemini-1.5-pro'],
    'gemini-flash': ['gemini-2.5-flash', 'gemini-flash', 'gemini-1.5-flash']
};

// Free tier providers for last-resort failover
const FREE_TIER_PROVIDERS = [
    'groq', 'cerebras', 'github_models', 'kilo', 'cohere'
];

// Local providers for privacy-first failover
const LOCAL_PROVIDER_IDS = ['ollama', 'lmstudio', 'llamacpp', 'vllm'];

// Default failover stack (most reliable → least)
const DEFAULT_FAILOVER_STACK = [
    // Premium paid
    'anthropic', 'openai', 'gemini',
    // Free tiers with good models
    'groq', 'cerebras', 'github_models', 'kilo',
    // Other paid
    'deepinfra', 'togetherai', 'fireworks', 'openrouter',
    // Local (always available)
    'ollama', 'lmstudio'
];

/**
 * User-defined failover configuration
 * @typedef {Object} FailoverConfig
 * @property {string[]} preferredStack - Ordered list of preferred providers
 * @property {string[]} avoidProviders - Providers to skip
 * @property {boolean} allowPaid - Allow paid providers in failover
 * @property {boolean} allowFree - Allow free tier providers
 * @property {boolean} allowLocal - Allow local providers
 * @property {boolean} allowZippyMesh - Allow ZippyMesh network (future)
 * @property {Object} tagPreferences - Tags to use for model selection
 * @property {number} maxRetries - Maximum failover attempts
 */

/**
 * Get default failover configuration
 * @returns {FailoverConfig}
 */
export function getDefaultFailoverConfig() {
    return {
        preferredStack: [],
        avoidProviders: [],
        allowPaid: true,
        allowFree: true,
        allowLocal: true,
        allowZippyMesh: false,
        tagPreferences: {
            code: ['claude-sonnet', 'deepseek-coder', 'qwen-coder', 'gpt-4o'],
            chat: ['llama-70b', 'gemini-flash', 'gpt-4o-mini'],
            reasoning: ['claude-opus', 'gpt-4', 'deepseek-r1']
        },
        maxRetries: 10
    };
}

/**
 * Find equivalent models across providers
 * @param {string} model - Original model name
 * @returns {string[]} List of equivalent model patterns
 */
export function findEquivalentModels(model) {
    const modelLower = model.toLowerCase();
    const equivalents = new Set([model]);

    for (const [group, models] of Object.entries(MODEL_EQUIVALENCE_GROUPS)) {
        if (models.some(m => modelLower.includes(m.toLowerCase()))) {
            for (const m of models) {
                equivalents.add(m);
            }
        }
    }

    return [...equivalents];
}

/**
 * Find same model from different provider
 * @param {string} originalProvider - Original provider ID
 * @param {string} model - Model name
 * @param {Object[]} allConnections - All available connections
 * @returns {Object[]} Alternative provider candidates
 */
export async function findSameModelDifferentProvider(originalProvider, model, allConnections = null) {
    const candidates = [];
    const connections = allConnections || await getProviderConnections({ isActive: true, isEnabled: true });

    for (const conn of connections) {
        if (conn.provider === originalProvider) continue;

        const providerModels = getModelsByProviderId(conn.provider);
        const matchingModel = providerModels.find(m => {
            const modelId = typeof m === 'string' ? m : m?.id;
            return modelId?.toLowerCase().includes(model.toLowerCase()) ||
                   model.toLowerCase().includes(modelId?.toLowerCase() || '');
        });

        if (matchingModel) {
            candidates.push({
                connection: conn,
                provider: conn.provider,
                model: typeof matchingModel === 'string' ? matchingModel : matchingModel.id,
                source: 'same_model_different_provider'
            });
        }
    }

    return candidates;
}

/**
 * Build intelligent failover chain
 * @param {Object} context - Request context
 * @param {string} originalProvider - Failed provider
 * @param {string} originalModel - Failed model
 * @param {string[]} alreadyTried - Providers already attempted
 * @param {FailoverConfig} config - User failover configuration
 * @returns {Object[]} Ordered failover candidates
 */
export async function buildFailoverChain(context, originalProvider, originalModel, alreadyTried = [], config = null) {
    const settings = await getSettings();
    const failoverConfig = config || getDefaultFailoverConfig();
    const candidates = [];
    const tried = new Set(alreadyTried);

    const allConnections = await getProviderConnections({ isActive: true, isEnabled: true });

    // Filter out avoided and already-tried providers
    const availableConnections = allConnections.filter(conn => {
        if (tried.has(conn.provider)) return false;
        if (failoverConfig.avoidProviders.includes(conn.provider)) return false;
        return true;
    });

    // 1. Same model from different provider (highest priority)
    const sameModelAlternatives = await findSameModelDifferentProvider(
        originalProvider, 
        originalModel, 
        availableConnections
    );
    candidates.push(...sameModelAlternatives);

    // 2. Equivalent models from other providers
    const equivalentModels = findEquivalentModels(originalModel);
    for (const equiv of equivalentModels) {
        if (equiv === originalModel) continue;

        for (const conn of availableConnections) {
            if (candidates.some(c => c.connection.id === conn.id)) continue;

            const providerModels = getModelsByProviderId(conn.provider);
            const matchingModel = providerModels.find(m => {
                const modelId = typeof m === 'string' ? m : m?.id;
                return modelId?.toLowerCase().includes(equiv.toLowerCase());
            });

            if (matchingModel) {
                candidates.push({
                    connection: conn,
                    provider: conn.provider,
                    model: typeof matchingModel === 'string' ? matchingModel : matchingModel.id,
                    source: 'equivalent_model'
                });
            }
        }
    }

    // 3. User-preferred stack
    if (failoverConfig.preferredStack.length > 0) {
        for (const preferredProvider of failoverConfig.preferredStack) {
            const conn = availableConnections.find(c => c.provider === preferredProvider);
            if (conn && !candidates.some(c => c.connection.id === conn.id)) {
                const models = getModelsByProviderId(preferredProvider);
                if (models.length > 0) {
                    const defaultModel = models[0];
                    candidates.push({
                        connection: conn,
                        provider: preferredProvider,
                        model: typeof defaultModel === 'string' ? defaultModel : defaultModel.id,
                        source: 'user_preferred'
                    });
                }
            }
        }
    }

    // 4. Free tier providers (if allowed)
    if (failoverConfig.allowFree && settings?.preferFreeOnRateLimit !== false) {
        for (const freeProvider of FREE_TIER_PROVIDERS) {
            const conn = availableConnections.find(c => c.provider === freeProvider);
            if (conn && !candidates.some(c => c.connection.id === conn.id)) {
                const models = getModelsByProviderId(freeProvider);
                // Pick best model for intent
                const intent = context.intent || 'generic';
                const preferredTags = failoverConfig.tagPreferences[intent] || [];
                
                let bestModel = models[0];
                for (const tag of preferredTags) {
                    const match = models.find(m => {
                        const modelId = typeof m === 'string' ? m : m?.id;
                        return modelId?.toLowerCase().includes(tag.toLowerCase());
                    });
                    if (match) {
                        bestModel = match;
                        break;
                    }
                }

                if (bestModel) {
                    candidates.push({
                        connection: conn,
                        provider: freeProvider,
                        model: typeof bestModel === 'string' ? bestModel : bestModel.id,
                        source: 'free_tier_failover'
                    });
                }
            }
        }
    }

    // 5. Local providers (always available, if allowed)
    if (failoverConfig.allowLocal) {
        for (const localProvider of LOCAL_PROVIDER_IDS) {
            const conn = availableConnections.find(c => c.provider === localProvider);
            if (conn && !candidates.some(c => c.connection.id === conn.id)) {
                // Use dynamic model fetching for local providers
                const models = await getLocalProviderModels(localProvider);
                if (models.length > 0) {
                    candidates.push({
                        connection: conn,
                        provider: localProvider,
                        model: typeof models[0] === 'string' ? models[0] : models[0].id,
                        source: 'local_failover'
                    });
                }
            }
        }
    }

    // 6. Default failover stack (catch-all)
    for (const provider of DEFAULT_FAILOVER_STACK) {
        if (candidates.some(c => c.provider === provider)) continue;

        const conn = availableConnections.find(c => c.provider === provider);
        if (conn) {
            const models = getModelsByProviderId(provider);
            if (models.length > 0) {
                candidates.push({
                    connection: conn,
                    provider: provider,
                    model: typeof models[0] === 'string' ? models[0] : models[0].id,
                    source: 'default_stack_failover'
                });
            }
        }
    }

    // Sort by priority: same_model > equivalent > user_preferred > free > local > default
    const sourcePriority = {
        'same_model_different_provider': 0,
        'equivalent_model': 1,
        'user_preferred': 2,
        'free_tier_failover': 3,
        'local_failover': 4,
        'default_stack_failover': 5
    };

    candidates.sort((a, b) => {
        const aPriority = sourcePriority[a.source] ?? 99;
        const bPriority = sourcePriority[b.source] ?? 99;
        return aPriority - bPriority;
    });

    // Limit to maxRetries
    return candidates.slice(0, failoverConfig.maxRetries);
}

/**
 * Get free tier candidates for immediate failover
 * @returns {Object[]} Free tier candidates
 */
export async function getFreeTierCandidates() {
    const candidates = [];
    const connections = await getProviderConnections({ isActive: true, isEnabled: true });

    for (const freeProvider of FREE_TIER_PROVIDERS) {
        const conn = connections.find(c => c.provider === freeProvider);
        if (conn) {
            const models = getModelsByProviderId(freeProvider);
            if (models.length > 0) {
                candidates.push({
                    connection: conn,
                    provider: freeProvider,
                    model: typeof models[0] === 'string' ? models[0] : models[0].id,
                    source: 'free_tier'
                });
            }
        }
    }

    return candidates;
}

/**
 * Get local provider candidates
 * @returns {Promise<Object[]>} Local provider candidates
 */
export async function getLocalCandidates() {
    const candidates = [];
    const connections = await getProviderConnections({ isActive: true, isEnabled: true });

    for (const localProvider of LOCAL_PROVIDER_IDS) {
        const conn = connections.find(c => c.provider === localProvider);
        if (conn) {
            // Use dynamic model fetching for local providers
            const models = await getLocalProviderModels(localProvider);
            for (const model of models) {
                candidates.push({
                    connection: conn,
                    provider: localProvider,
                    model: typeof model === 'string' ? model : model.id,
                    source: 'local'
                });
            }
        }
    }

    return candidates;
}

/**
 * Check if ZippyMesh network failover is available (future)
 * @returns {Promise<boolean>}
 */
export async function isZippyMeshAvailable() {
    // Future: Check if user has ZippyMesh node running
    // or if zippymesh.com endpoints are reachable
    return false;
}

/**
 * Get ZippyMesh network candidates (future)
 * @param {string} model - Requested model
 * @returns {Promise<Object[]>} ZippyMesh candidates
 */
export async function getZippyMeshCandidates(model) {
    // Future implementation
    return [];
}

// Export getLocalProviderModels for use in routing engine
export { getLocalProviderModels };

export default {
    getDefaultFailoverConfig,
    findEquivalentModels,
    findSameModelDifferentProvider,
    buildFailoverChain,
    getFreeTierCandidates,
    getLocalCandidates,
    getLocalProviderModels,
    isZippyMeshAvailable,
    getZippyMeshCandidates
};
