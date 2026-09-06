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
import { getRegistryModel } from "@/lib/modelRegistry.js";


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
 * @returns {Promise<object>}
 */
async function normalRoute(request, intent, constraints) {
  const clonedRequest = request.clone();
  clonedRequest.headers.delete('x-session-parallel');
  clonedRequest.headers.delete('x-session-id');
  const routing = await smartRouter(clonedRequest);

  if (!routing.success) {
    throw new Error(`Normal routing failed: ${routing.error}`);
  }

  // Execute with the selected model
  const body = { ...request.body };
  body.model = routing.selected;

  // Strip parallel headers to prevent re-entering parallel routing downstream
  const safeHeaders = new Headers(request.headers);
  safeHeaders.delete('x-session-parallel');
  safeHeaders.delete('x-session-id');
  safeHeaders.set('x-routing-strategy', 'normal');

  const response = await fetch('http://localhost:20128/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(safeHeaders.entries()),
    },
    body: JSON.stringify(body),
  });

  return {
    success: true,
    ...routing,
    response,
  };
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
  const response = await executeWithProvider(request, selectedProvider, intent, constraints);

  // Return routing metadata object, not raw Response
  return {
    success: true,
    selected: selectedProvider.id,
    reason: `Parallel round-robin to ${selectedProvider.id}`,
    intent,
    constraints,
    metadata: {
      provider: selectedProvider.id,
      sessionId,
      callCount: sessionState.callCount,
      strategy: 'parallel-burst',
    },
    response,
  };
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
 * Parse constraints from request headers.
 *
 * ALWAYS returns an object (fixed 2026-08-30). It used to return `null` when no
 * `X-Max-*` / `X-Prefer-*` header was present, and every consumer's `= {}`
 * default only fires on `undefined` — so a plain `{"model":"auto"}` request blew
 * up in recommendationService's `constraints.maxCostPerMTokens`, smart routing
 * was skipped, and the literal string "auto" went upstream and 404'd.
 * `hasConstraints()` tells the callers that care whether anything was set.
 */
export function parseConstraintsFromRequest(request) {
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

  return constraints;
}

/** Did the caller actually ask for anything? (An empty constraint set is not
 *  the same as "unconstrained" for telemetry, which stores `null` for it.)
 *
 *  `hasImageInput` / `avoidThinking` are ROUTER-DERIVED facts about the request,
 *  not things the caller asked for, so they never make a request look
 *  "constrained" in the telemetry. */
const DERIVED_CONSTRAINT_KEYS = new Set(["hasImageInput", "avoidThinking"]);

export function hasConstraints(constraints) {
  if (!constraints) return false;
  return Object.keys(constraints).some((k) => !DERIVED_CONSTRAINT_KEYS.has(k));
}

/**
 * Does this chat body actually contain an image?
 *
 * OpenAI multimodal content is an ARRAY of parts, one of which has
 * `type: "image_url"` (or `"input_image"` on the Responses shape); Anthropic
 * uses `type: "image"`. Anything else — including a plain string `content`, and
 * including the word "image" appearing in the prose — is text only.
 *
 * This exists because the recommender awarded +5 for vision capability on every
 * request, so `{"model":"auto"}` with "Say OK" systematically selected the
 * slowest local model on the box (finding H6).
 *
 * @param {object} body - a parsed chat-completions body
 * @returns {boolean}
 */
export function detectImageInput(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    const content = m?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const t = part?.type;
      if (t === "image_url" || t === "input_image" || t === "image") return true;
    }
  }
  return false;
}

/**
 * Should the router steer AWAY from a thinking model for this request?
 *
 * Yes for the everyday intents. No when the caller explicitly asked for
 * reasoning (`X-Intent: reasoning`), which is precisely the case where a
 * thinking model is the right answer. See the scoring comment in
 * src/lib/discovery/recommendationService.js for what the flag does and why the
 * penalty is uniform (so a box with only thinking models still routes).
 *
 * @param {string} intent
 */
export function shouldAvoidThinking(intent) {
  return intent !== "reasoning";
}

/**
 * Build a plain `Request` carrying a rewritten JSON body.
 *
 * `new Request(nextRequest, init)` throws
 * `TypeError: Cannot read private member #state from an object whose class did
 * not declare it` — Next's `NextRequest` is not a clonable `Request` input. That
 * throw is what defeated the whole `model:"auto"` path: routing picked a model,
 * the rewrite threw, the catch logged and continued with the ORIGINAL body, and
 * "auto" reached the provider. Building a fresh Request from url/method/headers
 * sidesteps it (fixed 2026-08-30).
 *
 * `content-length` is dropped because the new body's length differs from the
 * original's, and `content-type` is forced to JSON since the body now is JSON.
 *
 * @param {Request} request - original request (NextRequest is fine)
 * @param {object} body - the new body, serialised with JSON.stringify
 * @returns {Request} a plain Request; the original is left untouched
 */
export function rewriteRequestBody(request, body) {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(request.url, {
    method: request.method || "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Read a request's JSON body without disturbing it. Returns null on anything
 * unparseable — the caller must treat "no body" as "text-only, no constraints".
 */
async function readBody(request) {
  try {
    if (typeof request?.clone !== "function") return null;
    return await request.clone().json();
  } catch {
    return null;
  }
}

/**
 * Get recommended model or validate requested model
 *
 * @param {Request} request
 * @param {object|null} [parsedBody] - the request body, when the caller already
 *   has it. Used for image detection only; intent still comes from `X-Intent`.
 */
async function selectModel(request, parsedBody = null) {
  const requestedModel = request.body?.model ?? parsedBody?.model;
  const intent = parseIntentFromRequest(request);
  const constraints = parseConstraintsFromRequest(request);

  // Router-derived routing facts (2026-08-30, finding H6). These are appended
  // AFTER parseConstraintsFromRequest so an explicit X-* header always wins.
  constraints.hasImageInput = detectImageInput(parsedBody);
  constraints.avoidThinking = shouldAvoidThinking(intent);

  // If specific model requested, validate it
  if (requestedModel && requestedModel !== "auto") {
    const catalog = await getDiscoveryCatalog();
    const model = catalog.models.find(m => m.id === requestedModel);

    // catalog.models merges registry-sourced (lifecycle-filtered) and static
    // (unfiltered, no dedup) entries — a model already deprecated/missing in
    // the registry can still match via its static twin. Explicitly reject
    // those instead of blindly honoring a stale client-specified model;
    // fails open (keeps `model`) when there's no registry entry at all
    // (e.g. local/p2p models the registry doesn't track) or on lookup error.
    let registryRejected = false;
    if (model) {
      const slashIndex = requestedModel.indexOf("/");
      if (slashIndex > 0) {
        try {
          const registryModel = await getRegistryModel(requestedModel.slice(0, slashIndex), requestedModel.slice(slashIndex + 1));
          if (registryModel && (registryModel.lifecycleState === "missing" || registryModel.lifecycleState === "deprecated")) {
            registryRejected = true;
          }
        } catch {
          // fail open — treat as if no registry entry exists
        }
      }
    }

    if (model && !registryRejected) {
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
  const top = recommendations.recommendations[0] || null;

  return {
    // null, NOT "default" — "default" is not a model any provider serves, and
    // returning it made the caller rewrite the body to a guaranteed 404. A null
    // selection means "smart routing had nothing to offer, keep the original
    // model" and lets the orchestrator's local fallback take over.
    selected: top?.fullModel || null,
    fallbackChain: recommendations.fallbackChain,
    reason: top?.reasoning?.[0] || "No specific reason",
    intent,
    constraints,
    score: top?.score || 0,
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
      return routeParallelRequest(request, sessionId, intent, constraints);
    }


    // Parse request. The body is read here (and only here) so the recommender
    // can tell a text-only prompt from a multimodal one — see detectImageInput.
    const parsedBody = await readBody(request);
    const modelSelection = await selectModel(request, parsedBody);

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
      selected: null, // keep whatever the client asked for
      fallbackChain: [],
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
 * Write the `x-selected-model` / `x-routing-*` headers onto a Headers-like
 * object. Split out of `enrichResponse` (2026-08-30) because the /v1 route only
 * reached `enrichResponse` on the FAILURE path — a successful `auto` request
 * returned early and carried no routing headers at all.
 *
 * `selected` may legitimately be null (nothing recommended); never write the
 * string "null".
 *
 * @param {Headers|{set:Function}} headers
 * @param {object} routingMetadata
 */
export function applyRoutingHeaders(headers, routingMetadata) {
  if (!headers || !routingMetadata) return headers;
  try {
    if (routingMetadata.selected) headers.set("x-selected-model", routingMetadata.selected);
    if (routingMetadata.intent) headers.set("x-routing-intent", routingMetadata.intent);
    headers.set("x-routing-score", routingMetadata.score?.toString() || "0");
    if (routingMetadata.reason) headers.set("x-routing-reason", routingMetadata.reason);
    if (routingMetadata.usedModel) {
      headers.set("x-used-model", routingMetadata.usedModel);
      headers.set("x-attempt-number", routingMetadata.attemptNumber?.toString() || "1");
    }
  } catch {
    // Immutable headers (a response relayed straight from fetch) — non-fatal.
  }
  return headers;
}

/**
 * Response Metadata Enricher
 *
 * Adds routing metadata to response headers
 */
export async function enrichResponse(response, routingMetadata) {
  if (!routingMetadata) return response;

  applyRoutingHeaders(response.headers, routingMetadata);

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
