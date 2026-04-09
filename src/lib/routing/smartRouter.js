/**
 * Smart Router Middleware
 *
 * Intelligently routes requests to the best model based on:
 * - Task intent (from X-Intent header or inferred from messages)
 * - Model availability and capabilities
 * - User constraints (budget, latency, etc.)
 * - Failover chain for resilience
 *
 * Can be used as middleware in /v1/chat/completions
 */

import { getRecommendations } from "@/lib/discovery/recommendationService.js";
import { getDiscoveryCatalog } from "@/lib/discovery/catalogService.js";


// ============================================================================
// Parallel Session State Management
// In-memory session state for parallel routing (TTL: 10 minutes)
// ============================================================================
const parallelSessions = new Map();
const PARALLEL_SESSION_TTL = 10 * 60 * 1000;

function getOrCreateParallelSession(sessionId) {
  // Cleanup expired sessions
  const now = Date.now();
  for (const [id, state] of parallelSessions.entries()) {
    if (now - state.lastUsed > PARALLEL_SESSION_TTL) {
      parallelSessions.delete(id);
    }
  }

  if (!parallelSessions.has(sessionId)) {
    parallelSessions.set(sessionId, { callCount: 0, lastUsed: now });
  }
  return parallelSessions.get(sessionId);
}

export function getParallelSessions() {
  return parallelSessions;
}

// ============================================================================
// Parallel Routing Configuration Parser
// ============================================================================

/**
 * Parse session-parallel flag from request headers
 * @param {Request} request
 * @returns {{ parallel: boolean, sessionId: string|null }}
 */
function parseParallelConfig(request) {
  const parallel = request.headers.get('x-session-parallel') === 'true';
  const sessionId = request.headers.get('x-session-id') || null;
  return { parallel, sessionId };
}

// ============================================================================
// Provider Discovery Helpers for Parallel Routing
// ============================================================================

/**
 * Get list of available providers from the discovery catalog
 * @param {string} intent - The routing intent
 * @returns {Promise<Array<{id: string, models: string[]}>>}
 */
async function getAvailableProviders(intent) {
  const catalog = await getDiscoveryCatalog();
  const models = catalog.models || [];

  // Group models by provider
  const providerMap = new Map();
  for (const model of models) {
    const providerId = model.provider || model.id?.split('/')[0] || 'unknown';
    if (!providerMap.has(providerId)) {
      providerMap.set(providerId, { id: providerId, models: [] });
    }
    providerMap.get(providerId).models.push(model.id);
  }

  return Array.from(providerMap.values());
}

/**
 * Get list of providers suitable for parallel agent routing.
 * Prefers free providers when preferFree=true.
 * Falls back to any available provider.
 */
async function getProvidersForParallelRouting(intent, preferFree) {
  // Use free provider list for burst distribution
  const freeProviders = ['groq', 'gemini-free', 'github-models', 'cerebras', 'ollama'];
  const allProviders = await getAvailableProviders(intent);

  if (preferFree) {
    const available = allProviders.filter(p => freeProviders.includes(p.id));
    return available.length > 0 ? available : allProviders;
  }

  return allProviders;
}

// ============================================================================
// Provider Execution Helpers
// ============================================================================

/**
 * Execute a request with a specific provider
 * @param {Request} request
 * @param {{id: string, models: string[]}} provider
 * @param {string} intent
 * @param {object} constraints
 * @returns {Promise<Response>}
 */
async function executeWithProvider(request, provider, intent, constraints) {
  // Clone the request to avoid mutating the original
  const body = { ...request.body };

  // Select a model from the provider's available models
  if (provider.models && provider.models.length > 0) {
    body.model = provider.models[0];
  }

  // Add routing metadata headers
  const headers = new Headers(request.headers);
  headers.set('x-routed-provider', provider.id);
  headers.set('x-routing-strategy', 'parallel-burst');

  // Forward to the provider's endpoint
  // This uses the internal provider routing logic
  const providerEndpoint = getProviderEndpoint(provider.id);
  if (!providerEndpoint) {
    throw new Error(`No endpoint configured for provider: ${provider.id}`);
  }

  const response = await fetch(providerEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(headers.entries()),
    },
    body: JSON.stringify(body),
  });

  return response;
}

/**
 * Get the API endpoint URL for a provider
 * @param {string} providerId
 * @returns {string|null}
 */
function getProviderEndpoint(providerId) {
  // Map of known provider endpoints
  const endpoints = {
    'groq': 'https://api.groq.com/openai/v1/chat/completions',
    'gemini-free': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    'github-models': 'https://models.inference.ai.azure.com/chat/completions',
    'cerebras': 'https://api.cerebras.ai/v1/chat/completions',
    'ollama': 'http://localhost:11434/v1/chat/completions',
    'openai': 'https://api.openai.com/v1/chat/completions',
    'anthropic': 'https://api.anthropic.com/v1/messages',
  };

  return endpoints[providerId] || null;
}

/**
 * Normal routing path - falls back to standard smart routing
 * @param {Request} request
 * @param {string} intent
 * @param {object} constraints
 * @returns {Promise<Response>}
 */
async function normalRoute(request, intent, constraints) {
  // Call selectModel directly to avoid re-entering smartRouter and triggering
  // the parallel routing check again (which would cause an infinite loop).
  const modelSelection = await selectModel(request);

  // Execute with the selected model
  const body = { ...request.body };
  body.model = modelSelection.selected;

  const response = await fetch('http://localhost:20128/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(request.headers.entries()),
    },
    body: JSON.stringify(body),
  });

  return response;
}

// ============================================================================
// Parallel Request Router
// ============================================================================

/**
 * Routes a request from a parallel agent session, round-robining across providers
 * to avoid rate limits on any single provider.
 * @param {Request} request
 * @param {string} sessionId - Shared session ID across all parallel agents
 * @param {string} intent
 * @param {object} constraints
 */
async function routeParallelRequest(request, sessionId, intent, constraints) {
  // Get or create session state
  const sessionState = getOrCreateParallelSession(sessionId);

  // Get available providers for this intent (free-tier preferred when X-Prefer-Free)
  const preferFree = constraints.preferFree ?? false;
  const providers = await getProvidersForParallelRouting(intent, preferFree);

  if (providers.length === 0) {
    // Fall back to normal routing
    return normalRoute(request, intent, constraints);
  }

  // Round-robin: pick provider at index (callCount % providers.length)
  const providerIndex = sessionState.callCount % providers.length;
  const selectedProvider = providers[providerIndex];

  // Increment call count for this session
  sessionState.callCount++;
  sessionState.lastUsed = Date.now();
  parallelSessions.set(sessionId, sessionState);

  // Add routing headers for the selected provider
  return executeWithProvider(request, selectedProvider, intent, constraints);
}

/**
 * Parse intent from request headers or infer from messages
 */
function parseIntentFromRequest(request) {
  // Check explicit header
  const headerIntent = request.headers.get("x-intent");
  if (headerIntent) {
    return headerIntent.toLowerCase();
  }

  // Infer from context
  if (request.body?.messages) {
    const content = request.body.messages
      .map(m => m.content)
      .join(" ")
      .toLowerCase();

    if (
      content.includes("code") ||
      content.includes("function") ||
      content.includes("bug") ||
      content.includes("debug")
    ) {
      return "code";
    }

    if (
      content.includes("reason") ||
      content.includes("think") ||
      content.includes("analyze") ||
      content.includes("step")
    ) {
      return "reasoning";
    }

    if (
      content.includes("image") ||
      content.includes("visual") ||
      content.includes("screenshot")
    ) {
      return "vision";
    }

    if (content.includes("embed") || content.includes("vector")) {
      return "embedding";
    }

    if (content.includes("fast") || content.includes("quick")) {
      return "fast";
    }
  }

  return "default";
}

/**
 * Parse constraints from request headers
 */
function parseConstraintsFromRequest(request) {
  const constraints = {};

  // Parse constraint headers
  const maxLatency = request.headers.get("x-max-latency-ms");
  if (maxLatency) {
    constraints.maxLatencyMs = parseInt(maxLatency);
  }

  const maxCost = request.headers.get("x-max-cost-per-m-tokens");
  if (maxCost) {
    constraints.maxCostPerMTokens = parseFloat(maxCost);
  }

  const minContext = request.headers.get("x-min-context-window");
  if (minContext) {
    constraints.minContextWindow = parseInt(minContext);
  }

  const preferFree = request.headers.get("x-prefer-free");
  if (preferFree) {
    constraints.preferFree = preferFree.toLowerCase() === "true";
  }

  const preferLocal = request.headers.get("x-prefer-local");
  if (preferLocal) {
    constraints.preferLocal = preferLocal.toLowerCase() === "true";
  }

  return Object.keys(constraints).length > 0 ? constraints : null;
}

/**
 * Get recommended model or validate requested model
 */
async function selectModel(request) {
  const requestedModel = request.body?.model;
  const intent = parseIntentFromRequest(request);
  const constraints = parseConstraintsFromRequest(request);

  // If specific model requested, validate it
  if (requestedModel && requestedModel !== "auto") {
    const catalog = await getDiscoveryCatalog();
    const model = catalog.models.find(m => m.id === requestedModel);

    if (model) {
      return {
        selected: requestedModel,
        reason: "User-specified model",
        intent,
        available: true,
        metadata: {
          provider: model.provider,
          capabilities: model.capabilities,
          isFree: model.isFree,
        },
      };
    }
  }

  // Get recommendation
  const recommendations = await getRecommendations(intent, constraints, "");

  return {
    selected: recommendations.recommendations[0]?.fullModel || "default",
    fallbackChain: recommendations.fallbackChain,
    reason: recommendations.recommendations[0]?.reasoning[0] || "No specific reason",
    intent,
    constraints,
    score: recommendations.recommendations[0]?.score || 0,
    alternatives: recommendations.recommendations.slice(1).map(r => r.fullModel),
    metadata: {
      generatedAt: new Date().toISOString(),
      recommendationCount: recommendations.recommendations.length,
    },
  };
}

/**
 * Smart Router Middleware
 *
 * Usage:
 * ```javascript
 * const routing = await smartRouter(request);
 * const selectedModel = routing.selected;
 * const fallbacks = routing.fallbackChain;
 * ```
 */
export async function smartRouter(request) {
  try {
    // Check for parallel routing first (early return path)
    const { parallel, sessionId } = parseParallelConfig(request);
    if (parallel && sessionId) {
      const intent = parseIntentFromRequest(request);
      const constraints = parseConstraintsFromRequest(request);
      // routeParallelRequest returns a raw Response; wrap it in routing metadata
      // so callers always receive a consistent { success, selected, ... } shape.
      const parallelResponse = await routeParallelRequest(request, sessionId, intent, constraints);
      return {
        success: true,
        selected: parallelResponse.headers?.get?.("x-routed-model") || "parallel",
        intent,
        constraints,
        parallelExecution: true,
        parallelResponse,
      };
    }


    // Parse request
    const modelSelection = await selectModel(request);

    // Add routing metadata to request
    request.routingMetadata = {
      ...modelSelection,
      processedAt: new Date().toISOString(),
    };

    return {
      success: true,
      ...modelSelection,
    };
  } catch (error) {
    console.error("[SmartRouter] Error:", error);

    return {
      success: false,
      error: error.message,
      selected: "default", // Fallback to default
      fallbackChain: ["default"],
    };
  }
}

/**
 * Failover Handler
 *
 * Attempts to execute request with fallback chain
 */
export async function executeWithFailover(
  request,
  executeFunc,
  maxRetries = 3
) {
  const routing = await smartRouter(request);

  if (!routing.success) {
    throw new Error("Routing failed: " + routing.error);
  }

  const fallbackChain = routing.fallbackChain || [routing.selected];
  let lastError;

  for (let attempt = 0; attempt < Math.min(fallbackChain.length, maxRetries); attempt++) {
    const model = fallbackChain[attempt];

    try {
      console.log(
        `[Failover] Attempting model ${attempt + 1}/${maxRetries}: ${model}`
      );

      // Update request with current model
      request.body.model = model;

      const result = await executeFunc(request);

      // Success - return with metadata
      return {
        success: true,
        result,
        routing: {
          ...routing,
          usedModel: model,
          attemptNumber: attempt + 1,
        },
      };
    } catch (error) {
      lastError = error;
      console.warn(
        `[Failover] Model ${model} failed: ${error.message}, trying next...`
      );

      // Continue to next in chain
      continue;
    }
  }

  // All models failed
  throw new Error(
    `Failover exhausted after ${maxRetries} attempts. Last error: ${lastError?.message}`
  );
}

/**
 * Response Metadata Enricher
 *
 * Adds routing metadata to response headers
 */
export async function enrichResponse(response, routingMetadata) {
  if (!routingMetadata) return response;

  // Add headers with routing info
  response.headers.set("x-selected-model", routingMetadata.selected);
  response.headers.set("x-routing-intent", routingMetadata.intent);
  response.headers.set("x-routing-score", routingMetadata.score?.toString() || "0");

  if (routingMetadata.reason) {
    response.headers.set("x-routing-reason", routingMetadata.reason);
  }

  if (routingMetadata.usedModel) {
    response.headers.set("x-used-model", routingMetadata.usedModel);
    response.headers.set("x-attempt-number", routingMetadata.attemptNumber?.toString() || "1");
  }

  // Add routing metadata to response body if JSON
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = await response.json();
      if (body && typeof body === "object") {
        body._routing = routingMetadata;
        return new Response(JSON.stringify(body), {
          status: response.status,
          headers: response.headers,
        });
      }
    } catch (e) {
      // Not JSON, skip enrichment
    }
  }

  return response;
}

/**
 * Metrics Collector
 *
 * Tracks routing decisions for monitoring and optimization
 */
export class RoutingMetrics {
  constructor() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      byIntent: {},
      byModel: {},
      byFallbackDepth: {},
      averageLatency: 0,
    };
  }

  recordRequest(routing, success, latency) {
    this.metrics.totalRequests++;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Track by intent
    if (routing.intent) {
      this.metrics.byIntent[routing.intent] = (this.metrics.byIntent[routing.intent] || 0) + 1;
    }

    // Track by model
    if (routing.selected) {
      this.metrics.byModel[routing.selected] = (this.metrics.byModel[routing.selected] || 0) + 1;
    }

    // Track fallback depth
    const depth = routing.usedModel ? (routing.fallbackChain?.indexOf(routing.usedModel) || 0) + 1 : 1;
    this.metrics.byFallbackDepth[depth] = (this.metrics.byFallbackDepth[depth] || 0) + 1;

    // Update average latency
    this.metrics.averageLatency =
      (this.metrics.averageLatency * (this.metrics.totalRequests - 1) + (latency || 0)) /
      this.metrics.totalRequests;
  }

  getMetrics() {
    return {
      ...this.metrics,
      successRate: (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(2) + "%",
      avgLatencyMs: this.metrics.averageLatency.toFixed(0),
    };
  }

  reset() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      byIntent: {},
      byModel: {},
      byFallbackDepth: {},
      averageLatency: 0,
    };
  }
}

// Global metrics instance
export const routingMetrics = new RoutingMetrics();
