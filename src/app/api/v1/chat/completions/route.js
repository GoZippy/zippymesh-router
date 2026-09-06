import { callCloudWithMachineId } from "@/shared/utils/cloud.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { proxyChatCompletion } from "@/lib/sidecar";
import { errorResponse } from "open-sse/utils/error.js";
import { getRequestIdFromRequest, apiError, withStandardHeaders } from "@/lib/apiErrors.js";
import { smartRouter, enrichResponse, routingMetrics, rewriteRequestBody, applyRoutingHeaders, hasConstraints } from "@/lib/routing/smartRouter.js";
import { resolveBareModelId } from "@/lib/routing/localModelIndex.js";
import { saveRoutingDecision, updateModelPreference, saveRequestTrace, getSettings, recordSlaEvent, getVirtualKeyByHash, checkVirtualKeyBudget, updateVirtualKeyUsage, recordTokenUsage } from "@/lib/localDb.js";
import crypto from "crypto";
import { computePromptHash, isCacheable, tryGetCache, storeInCache, trySemanticCache, storeEmbedding, tenantIdForRequest } from "@/lib/promptCache.js";
import { checkIpRateLimit } from "@/lib/auth/ipRateLimit.js";
import { getClientIp } from "@/lib/auth/apiKey.js";

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
 * Give a `model:"auto"` turn back its answer when the whole token budget went
 * to thinking.
 *
 * ## The problem (finding H6 / the AUTO item, 2026-08-30)
 *
 * A thinking model puts its text in the non-standard `message.reasoning` and
 * leaves `message.content` as `""` until the thinking phase ends. Verified on a
 * default install: `{"model":"auto","messages":[…"Say OK"…],"max_tokens":48}`
 * answered `200` with `content: ""`, `finish_reason: "length"` and a populated
 * `reasoning`. Every OpenAI SDK reads `choices[0].message.content` — so the
 * headline feature of this commit series returned an empty answer.
 *
 * ## The decision, and why
 *
 * The scoring fix (recommendationService.js) stops `auto` reaching for a
 * thinking model on a plain prompt, which is the real repair. This is the
 * belt-and-braces half: on an install where EVERY model is a thinking model
 * there is nothing else to pick, and the client still deserves a non-empty
 * `content`.
 *
 * Considered and rejected: **return an error**. A 200 with a truncated answer is
 * strictly more useful than a 5xx, the turn genuinely succeeded, and turning a
 * successful completion into an error would break `model:"auto"` for every
 * client that already handles truncation via `finish_reason`.
 *
 * So: fold the reasoning text into `content`, leave `message.reasoning`
 * untouched (a client already reading it sees no change), and SAY SO on the
 * wire with `x-zmlr-content-source: reasoning`. `finish_reason` stays `"length"`
 * — the answer really was truncated.
 *
 * Deliberately narrow. It fires only when ALL of:
 *   - the request went through smart routing (`model:"auto"` / a playbook id),
 *   - the response is a non-streaming JSON `chat.completion`,
 *   - `content` is empty, `reasoning` is not, and `finish_reason` is `"length"`.
 * An explicitly-addressed model is never rewritten: a client that asked for
 * `ollama/qwen3.5:4b` with `max_tokens: 8` gets exactly what it got before.
 *
 * @param {Response} res
 * @returns {Promise<Response>} the same Response, or a rewritten one
 */
async function salvageEmptyReasoningContent(res) {
  if (!(res instanceof Response) || !res.ok) return res;
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return res;

  let body;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  const choice = body?.choices?.[0];
  const message = choice?.message;
  if (!message || typeof message !== "object") return res;
  if (typeof message.content === "string" && message.content.trim().length > 0) return res;
  if (choice.finish_reason !== "length") return res;

  const reasoning = typeof message.reasoning === "string" && message.reasoning.trim()
    ? message.reasoning
    : (typeof message.reasoning_content === "string" ? message.reasoning_content : "");
  if (!reasoning.trim()) return res;

  message.content = reasoning;
  const headers = new Headers(res.headers);
  headers.set("x-zmlr-content-source", "reasoning");
  headers.delete("content-length");
  console.log("[Router] auto: folded truncated reasoning into content (finish_reason=length, content was empty)");
  return new Response(JSON.stringify(body), { status: res.status, headers });
}

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
      // Unauthenticated requests: apply IP-based rate limit (200 req/hr per IP).
      //
      // M1, fixed 2026-08-30: this used to read `x-forwarded-for` / `x-real-ip`
      // straight off the request, so rotating the header per request gave every
      // request its own bucket and the limit was unenforceable — verified: 210
      // requests with a rotating X-Forwarded-For produced zero 429s while the
      // same 210 with no header tripped at #194. `getClientIp()` (added by
      // 630dd2ee, src/lib/net/proxyTrust.js) honours a caller-chosen header ONLY
      // under TRUST_PROXY=1; otherwise every caller shares the "direct" bucket.
      // This route was the last place under src/app/api/ still reading them raw.
      const ip = getClientIp(request);
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

  // Resolve a bare, provider-local model id (e.g. "qwen3.5:4b") to the
  // provider-qualified id ("ollama/qwen3.5:4b") when exactly one registered
  // provider serves it. This is what makes round-tripping `response.model`
  // work; an id that does not resolve unambiguously is left untouched so the
  // normal 404 path still reports it verbatim.
  try {
    const cloneBare = request.clone();
    const bareBody = await cloneBare.json();
    if (typeof bareBody?.model === "string" && bareBody.model && !bareBody.model.includes("/") && bareBody.model !== "auto") {
      const qualified = await resolveBareModelId(bareBody.model);
      if (qualified && qualified !== bareBody.model) {
        console.log(`[Router] Resolved bare model "${bareBody.model}" -> "${qualified}"`);
        request = rewriteRequestBody(request, { ...bareBody, model: qualified });
      }
    }
  } catch (e) {
    // Non-fatal: an unparseable body is rejected downstream with a 400.
  }

  // Apply smart routing if not already routed
  let routingMetadata = null;
  const clone2 = request.clone();
  try {
    const body = await clone2.json();
    // Smart routing applies ONLY to an explicit `model:"auto"`.
    //
    // It used to also fire on a MISSING model (`!body.model`). That never
    // mattered while routing was broken, but once routing works a body with no
    // `model` would get one invented for it and answer 200 — silently swallowing
    // the `400 Missing model` that OpenAI clients (and this suite) rely on.
    // A missing `model` stays a 400; ask for `"auto"` if you want the router to
    // choose.
    const useSmartRouting = body.model === "auto";

    if (useSmartRouting) {
      const routing = await smartRouter(request.clone());
      if (routing.success) {
        routingMetadata = routing;
        // Update request model if a concrete recommendation was made.
        // `routing.selected` is null when the recommender had nothing; keep the
        // original model then and let the orchestrator's local fallback resolve
        // "auto" against whatever the registered runtime actually serves.
        if (routing.selected) {
          body.model = routing.selected;
          // NB: `new Request(request, init)` throws on a NextRequest
          // ("Cannot read private member #state"), which used to silently drop
          // the rewrite and send the literal "auto" upstream. Build a plain
          // Request instead. See rewriteRequestBody().
          request = rewriteRequestBody(request, body);
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
            // Rebuild request with filtered body. Same NextRequest clone trap as
            // the smart-routing rewrite above — use the plain-Request builder.
            request = rewriteRequestBody(request, filteredBody);
          }
        }
      }
    } catch (e) {
      // Guardrail check failure is non-fatal — proceed with original request
      console.warn("[PIIGuardrails] Error applying guardrails:", e.message);
    }
  }

  /* ------------------------------------------------------------------ *
   * Prompt cache (non-streaming, deterministic requests only).
   *
   * Two fixes landed here in the 2026-08-30 adversarial round:
   *
   * H3 — the key had no TENANT dimension, so a prompt cached for one caller was
   *      served to any other caller who sent the same body, and `x-cache: HIT`
   *      was a confirm-a-guess oracle. `cacheTenant` is now part of the hash;
   *      see tenantIdFor() in src/lib/promptCache.js.
   *
   * H4 — a HIT returned before `handleChat()` and therefore skipped the token
   *      ledger AND `updateVirtualKeyUsage`, so a caller with a token or dollar
   *      budget could replay any cacheable prompt without limit and the budget
   *      could never trip. `recordCacheHit()` writes the row and charges the key
   *      before the replay goes out.
   * ------------------------------------------------------------------ */
  const cacheTenant = tenantIdForRequest(request, resolvedVirtualKey?.id || null);

  /**
   * Account for a replayed response exactly as a real one would be accounted
   * for, minus the provider cost (there was no provider call).
   *
   * `provider: "cache"` and `status: "cache_hit"` are both free-text columns in
   * `token_ledger` (src/lib/localDb.js:588-601), so this needs no migration:
   * a usage query that filters `status = 'success'` keeps its old meaning and a
   * dashboard that wants replay volume can ask for `status = 'cache_hit'`.
   */
  function recordCacheHit(body, kind) {
    try {
      const usage = body?.usage || {};
      const authHeader = request.headers.get("authorization") || "";
      recordTokenUsage({
        requestId,
        provider: "cache",
        // The qualified id the cached response reports, so the row joins against
        // the same id the wire returns (the M5 divergence, at least here).
        modelId: body?.model || routingMetadata?.usedModel || routingMetadata?.selected || "unknown",
        // Same 12-char bearer prefix the orchestrator buckets on
        // (src/sse/handlers/chat.js:135-137), so cache rows and provider rows
        // aggregate together.
        virtualKey: authHeader.startsWith("Bearer ") ? (authHeader.slice(7, 19) || null) : null,
        clientId: request.headers.get("x-zippy-client-id")?.trim() || null,
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        latencyMs: 0,
        costUsd: 0,
        status: kind,
      });
    } catch (e) {
      console.warn("[PromptCache] ledger write for a cache hit failed:", e.message);
    }
    if (resolvedVirtualKey) {
      try {
        const usage = body?.usage || {};
        updateVirtualKeyUsage(resolvedVirtualKey.id, {
          tokensUsed: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
          dollarCost: 0,
        });
      } catch (e) {
        console.warn("[PromptCache] virtual-key usage update for a cache hit failed:", e.message);
      }
    }
    try {
      dispatchWebhookEvent("request_complete", {
        traceId: requestId,
        model: body?.model || null,
        provider: "cache",
        intent: routingMetadata?.intent || "default",
        latencyMs: 0,
        tokensIn: body?.usage?.prompt_tokens || 0,
        tokensOut: body?.usage?.completion_tokens || 0,
        costEstimate: 0,
        success: true,
        cacheHit: true,
        fallbackDepth: 0,
      });
    } catch { /* non-fatal */ }
  }

  let promptHash = null;
  let cachedBodyMessages = null;
  let cachedResponse = null;
  const clone3 = request.clone();
  try {
    const bodyForCache = await clone3.json();
    if (isCacheable(bodyForCache)) {
      promptHash = computePromptHash(bodyForCache, cacheTenant);
      cachedBodyMessages = bodyForCache.messages;

      // Exact-match cache check
      cachedResponse = tryGetCache(promptHash);
      if (cachedResponse) {
        console.log(`[PromptCache] Cache HIT for hash ${promptHash.slice(0, 8)}`);
        recordCacheHit(cachedResponse, "cache_hit");
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
        const semanticHit = await trySemanticCache(bodyForCache.messages, settings, cacheTenant);
        if (semanticHit) {
          console.log(`[SemanticCache] SEMANTIC-HIT (similarity: ${semanticHit.similarity.toFixed(4)})`);
          recordCacheHit(semanticHit.response, "cache_hit_semantic");
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

    // Salvage an `auto` turn whose whole budget went to thinking (see below).
    // Runs BEFORE the cache write so the stored body is the one clients get.
    if (routingMetadata) res = await salvageEmptyReasoningContent(res);

    // Store successful non-streaming response in cache
    if (promptHash && res instanceof Response && res.ok) {
      try {
        const resClone = res.clone();
        const contentType = resClone.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          resClone.json().then(body => {
            // M5, second half: `routingMetadata` is null for every explicitly
            // addressed request, so this used to cache every one of them under
            // the model name "unknown". The response's own `model` is the
            // provider-qualified id the router actually resolved (contract §4).
            const usedModel = body?.model || routingMetadata?.usedModel || routingMetadata?.selected || "unknown";
            storeInCache(promptHash, usedModel, body);
            // Store semantic embedding (fire-and-forget), tenant-scoped like the
            // exact-match entry it belongs to.
            if (cachedBodyMessages) {
              getCachedSettings().then(settings => storeEmbedding(promptHash, cachedBodyMessages, settings, cacheTenant)).catch(() => {});
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
          constraints_json: hasConstraints(routingMetadata.constraints) ? JSON.stringify(routingMetadata.constraints) : null,
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
          constraints_json: hasConstraints(routingMetadata.constraints) ? JSON.stringify(routingMetadata.constraints) : null,
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
      // Routing headers must be set on the SUCCESS path too — this branch used
      // to return before enrichResponse() ever ran, so a working `auto` request
      // carried no x-selected-model / x-routing-* at all.
      const streamHeaders = new Headers(res.headers);
      applyRoutingHeaders(streamHeaders, routingMetadata);
      return withStandardHeaders(
        new Response(res.body.pipeThrough(transform), {
          status: res.status,
          headers: streamHeaders
        }),
        requestId
      );
    } else if (success) {
      applyRoutingHeaders(res.headers, routingMetadata);
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

