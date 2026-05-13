import { callCloudWithMachineId } from "@/shared/utils/cloud.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { proxyChatCompletion } from "@/lib/sidecar";
import { errorResponse } from "open-sse/utils/error.js";
import { getRequestIdFromRequest, apiError, withStandardHeaders } from "@/lib/apiErrors.js";
import { smartRouter, enrichResponse, routingMetrics } from "@/lib/routing/smartRouter.js";
import { saveRoutingDecision, updateModelPreference, saveRequestTrace, getSettings, recordSlaEvent, getVirtualKeyByHash, checkVirtualKeyBudget, updateVirtualKeyUsage } from "@/lib/localDb.js";
import crypto from "crypto";
import { computePromptHash, isCacheable, tryGetCache, storeInCache, trySemanticCache, storeEmbedding } from "@/lib/promptCache.js";
import { checkIpRateLimit } from "@/lib/auth/ipRateLimit.js";

// Module-level settings cache to avoid reading DB on every request
let _settingsCache = null;
let _settingsCacheTime = 0;
async function getCachedSettings() {
  const now = Date.now();
  if (_settingsCache && now - _settingsCacheTime < 60000) return _settingsCache;
  try { _settingsCache = await getSettings(); _settingsCacheTime = now; } catch (e) { /* non-fatal */ }
  return _settingsCache || {};
}
import { applyGuardrailsToMessages } from "@/lib/guardrails/piiFilter.js";
import { GUARDRAILS_PII_DEFAULTS } from "@/shared/constants/defaults.js";
import { dispatchWebhookEvent } from "@/lib/logExporter.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized");
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {
  const requestId = getRequestIdFromRequest(request);

  // Resolve virtual key from Authorization header (zm_live_... prefix)
  let resolvedVirtualKey = null;
  {
    const authHeader = request.headers.get("Authorization") || request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    if (token?.startsWith("zm_live_")) {
      const keyHash = crypto.createHash("sha256").update(token).digest("hex");
      const vk = getVirtualKeyByHash(keyHash);
      if (!vk) {
        return new Response(JSON.stringify({ error: { message: "Invalid or inactive virtual key", type: "invalid_request_error", code: "invalid_api_key" } }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      const budget = checkVirtualKeyBudget(vk.id);
      if (!budget.allowed) {
        return new Response(JSON.stringify({ error: { message: `Virtual key rejected: ${budget.reason}`, type: "invalid_request_error", code: "quota_exceeded" } }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
      resolvedVirtualKey = vk;
    } else {
      // Unauthenticated requests: apply IP-based rate limit (200 req/hr per IP)
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
               || request.headers.get("x-real-ip")
               || "unknown";
      const rl = checkIpRateLimit(`api:${ip}`, 200, 60 * 60 * 1000);
      if (!rl.allowed) {
        const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
        return new Response(
          JSON.stringify({ error: { message: "Rate limit exceeded. Use a virtual key for higher limits.", type: "rate_limit_error", code: "rate_limit_exceeded" } }),
          { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) } }
        );
      }
    }
  }

  // Check for P2P model
  const clone = request.clone();
  try {
    const body = await clone.json();
    if (body.model && body.model.startsWith("p2p/")) {
      console.log(`[Proxy] Forwarding P2P request for ${body.model}`);
      // Strip prefix
      const p2pPayload = { ...body, model: body.model.replace("p2p/", "") };

      const proxyRes = await proxyChatCompletion(p2pPayload);
      const proxyHeaders = new Headers(proxyRes.headers || {});
      if (!proxyHeaders.has("X-Request-ID")) {
        proxyHeaders.set("X-Request-ID", requestId);
      }

      // Return proxy response directly
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: proxyHeaders
      });
    }
  } catch (e) {
    console.error("[Proxy] Error checking P2P model:", e);
  }

  // Fallback to local handling
  await ensureInitialized();

  // Apply smart routing if not already routed
  let routingMetadata = null;
  const clone2 = request.clone();
  try {
    const body = await clone2.json();
    // Check if smart routing should be applied (not a direct model call or auto routing enabled)
    const useSmartRouting = !body.model || body.model === "auto";

    if (useSmartRouting) {
      const routing = await smartRouter(request.clone());
      if (routing.success) {
        routingMetadata = routing;
        // Update request model if recommendation was made
        if (routing.selected && (!body.model || body.model === "auto")) {
          body.model = routing.selected;
          // Create new request with updated model
          const newRequest = new Request(request, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(body)
          });
          request = newRequest;
        }
      } else {
        console.warn("[SmartRouter] Routing failed:", routing.error);
        // Continue with original request
      }
    }
  } catch (e) {
    console.warn("[SmartRouter] Error during smart routing:", e);
    // Continue with original request
  }

  // Apply PII guardrails if enabled
  let guardrailRedactions = [];
  {
    const cloneGuard = request.clone();
    try {
      const bodyGuard = await cloneGuard.json();
      if (bodyGuard.guardrails !== false) { // Allow caller to opt-out with guardrails:false
        const activeRules = GUARDRAILS_PII_DEFAULTS.filter(r => r.isActive);
        if (activeRules.length > 0) {
          const { body: filteredBody, redactions, blocked } = applyGuardrailsToMessages(bodyGuard, activeRules);
          if (blocked) {
            return new Response(JSON.stringify({
              error: { message: "Request blocked by content policy", type: "content_policy_violation" }
            }), { status: 400, headers: { "Content-Type": "application/json" } });
          }
          if (redactions.length > 0) {
            guardrailRedactions = redactions;
            // Rebuild request with filtered body
            request = new Request(request, { body: JSON.stringify(filteredBody) });
          }
        }
      }
    } catch (e) {
      // Guardrail check failure is non-fatal — proceed with original request
      console.warn("[PIIGuardrails] Error applying guardrails:", e.message);
    }
  }

  // Check prompt cache (only for non-streaming, deterministic requests)
  let promptHash = null;
  let cachedBodyMessages = null;
  let cachedResponse = null;
  const clone3 = request.clone();
  try {
    const bodyForCache = await clone3.json();
    if (isCacheable(bodyForCache)) {
      promptHash = computePromptHash(bodyForCache);
      cachedBodyMessages = bodyForCache.messages;

      // Exact-match cache check
      cachedResponse = tryGetCache(promptHash);
      if (cachedResponse) {
        console.log(`[PromptCache] Cache HIT for hash ${promptHash.slice(0, 8)}`);
        const cacheHeaders = new Headers({ "Content-Type": "application/json", "X-Cache": "HIT" });
        if (routingMetadata) {
          cacheHeaders.set("x-selected-model", routingMetadata.selected || "");
          cacheHeaders.set("x-routing-intent", routingMetadata.intent || "");
          cachedResponse._routing = { ...routingMetadata, cacheHit: true };
        }
        return withStandardHeaders(
          new Response(JSON.stringify(cachedResponse), { status: 200, headers: cacheHeaders }),
          requestId
        );
      }

      // Semantic cache check (experimental — off by default, requires Ollama)
      try {
        const settings = await getCachedSettings();
        const semanticHit = await trySemanticCache(bodyForCache.messages, settings);
        if (semanticHit) {
          console.log(`[SemanticCache] SEMANTIC-HIT (similarity: ${semanticHit.similarity.toFixed(4)})`);
          const semHeaders = new Headers({ "Content-Type": "application/json", "X-Cache": "SEMANTIC-HIT" });
          if (routingMetadata) {
            semHeaders.set("x-selected-model", routingMetadata.selected || "");
            semHeaders.set("x-routing-intent", routingMetadata.intent || "");
            semanticHit.response._routing = { ...routingMetadata, cacheHit: true };
          }
          return withStandardHeaders(
            new Response(JSON.stringify(semanticHit.response), { status: 200, headers: semHeaders }),
            requestId
          );
        }
      } catch (e) {
        // Semantic cache failure is non-fatal
      }
    }
  } catch (e) {
    // Cache check failure is non-fatal
  }

  let res;
  try {
    const startTime = Date.now();
    res = await handleChat(request);
    const latency = Date.now() - startTime;

    // Store successful non-streaming response in cache
    if (promptHash && res instanceof Response && res.ok) {
      try {
        const resClone = res.clone();
        const contentType = resClone.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          resClone.json().then(body => {
            const usedModel = routingMetadata?.usedModel || routingMetadata?.selected || "unknown";
            storeInCache(promptHash, usedModel, body);
            // Store semantic embedding (fire-and-forget)
            if (cachedBodyMessages) {
              getCachedSettings().then(settings => storeEmbedding(promptHash, cachedBodyMessages, settings)).catch(() => {});
            }
          }).catch(() => {});
        }
      } catch (e) {
        // Non-fatal
      }
    }

    const success = res instanceof Response && res.ok;
    const isStream = res.headers.get("content-type")?.includes("event-stream");

    let finalTokensIn = 0;
    let finalTokensOut = 0;
    let finalCost = 0;
    const endLatency = () => Date.now() - startTime;

    const finalizeTelemetry = (inTokens, outTokens, totalLat) => {
      if (!routingMetadata) return;
      const usedModel = routingMetadata.usedModel || routingMetadata.selected;

      routingMetrics.recordRequest(routingMetadata, success, totalLat);

      try {
        saveRoutingDecision({
          timestamp: new Date().toISOString(),
          intent: routingMetadata.intent || 'default',
          selected_model: routingMetadata.selected,
          used_model: usedModel,
          score: routingMetadata.score || 0,
          fallback_depth: routingMetadata.attemptNumber ? routingMetadata.attemptNumber - 1 : 0,
          latency_ms: totalLat,
          success: success ? 1 : 0,
          constraints_json: routingMetadata.constraints ? JSON.stringify(routingMetadata.constraints) : null,
          reason: routingMetadata.reason || null,
        });

        saveRequestTrace({
          timestamp: new Date().toISOString(),
          request_id: requestId,
          virtual_key_id: resolvedVirtualKey?.id || null,
          intent: routingMetadata.intent || 'default',
          selected_model: routingMetadata.selected,
          used_model: usedModel,
          latency_ms: totalLat,
          success: success,
          fallback_depth: routingMetadata.attemptNumber ? routingMetadata.attemptNumber - 1 : 0,
          constraints_json: routingMetadata.constraints ? JSON.stringify(routingMetadata.constraints) : null,
        });

        if (resolvedVirtualKey) {
          // If we captured tokens, derive cost approximation if you have a price, else just tokens
          // For now, tracking tokens explicitly. Cost could be inferred from X-Zippy-Response-Cost if available
          const headerCost = parseFloat(res.headers.get("X-Zippy-Response-Cost") || "0");
          updateVirtualKeyUsage(resolvedVirtualKey.id, { tokensUsed: inTokens + outTokens, dollarCost: headerCost });
        }

        recordSlaEvent({
          provider: routingMetadata?.provider || routingMetadata?.selected?.split('/')[0] || 'unknown',
          latencyMs: totalLat,
          success,
          model: usedModel,
        });

        if (usedModel && routingMetadata.intent) {
          updateModelPreference(routingMetadata.intent, usedModel, success);
        }

        dispatchWebhookEvent("request_complete", {
          traceId: requestId,
          model: usedModel || routingMetadata.selected,
          provider: routingMetadata.provider || null,
          intent: routingMetadata.intent || "default",
          latencyMs: totalLat,
          tokensIn: inTokens,
          tokensOut: outTokens,
          costEstimate: parseFloat(res.headers.get("X-Zippy-Response-Cost") || "0"),
          success,
          cacheHit: false,
          fallbackDepth: routingMetadata.attemptNumber ? routingMetadata.attemptNumber - 1 : 0
        });
      } catch (e) {
        console.warn("[SmartRouter] Failed to persist routing decision or telemetry:", e.message);
      }
    };

    if (success && isStream && res.body) {
      // Intercept streaming response
      const transform = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          try {
            const dec = new TextDecoder().decode(chunk);
            const lines = dec.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.usage) {
                  finalTokensIn = parsed.usage.prompt_tokens || 0;
                  finalTokensOut = parsed.usage.completion_tokens || 0;
                }
              }
            }
          } catch (e) {}
        },
        flush() {
          finalizeTelemetry(finalTokensIn, finalTokensOut, endLatency());
        }
      });
      return withStandardHeaders(
        new Response(res.body.pipeThrough(transform), {
          status: res.status,
          headers: res.headers
        }),
        requestId
      );
    } else if (success) {
      // Intercept JSON response
      return res.clone().json().then(data => {
        if (data.usage) {
          finalTokensIn = data.usage.prompt_tokens || 0;
          finalTokensOut = data.usage.completion_tokens || 0;
        }
        finalizeTelemetry(finalTokensIn, finalTokensOut, endLatency());
        return withStandardHeaders(res, requestId);
      }).catch(() => {
        finalizeTelemetry(0, 0, endLatency());
        return withStandardHeaders(res, requestId);
      });
    } else {
      finalizeTelemetry(0, 0, endLatency());
    }

  } catch (error) {
    console.error("[chat/completions] Unhandled error:", error);
    // Record failed request
    if (routingMetadata) {
      routingMetrics.recordRequest(routingMetadata, false, 0);
    }
    return apiError(request, 500, "Chat request failed", { requestId });
  }

  // Ensure we return a Response object for Next.js
  if (res && typeof res === 'object' && !(res instanceof Response)) {
    const status = Number(res.status) || 500;
    const message = typeof res.error === "string"
      ? res.error
      : (res?.error?.message || res?.message || "Request failed");
    return apiError(request, status, message, { requestId });
  }

  if (res instanceof Response) {
    // Enrich response with routing metadata if available
    if (routingMetadata) {
      res = await enrichResponse(res, routingMetadata);
    }
    return withStandardHeaders(res, requestId);
  }

  return res;
}

