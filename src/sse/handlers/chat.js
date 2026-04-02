import { getProviderCredentials, markAccountUnavailable, clearAccountError } from "../services/auth.js";
import { getModelInfo, getComboModels, resolvePlaybookIntent } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { HTTP_STATUS } from "open-sse/config/constants.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { checkSafety } from "../../utils/guardrails.js";
import { generateRequestId } from "@/lib/usageDb.js";
import { emitProviderLifecycleEvent } from "@/lib/lifecycleEvents.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  const headerRequestId = request?.headers?.get?.("x-request-id");
  const requestId = (typeof headerRequestId === "string" && headerRequestId.trim()
    ? headerRequestId.trim()
    : generateRequestId()
  ).slice(0, 128);

  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body", { requestId });
  }

  // Guardrailing
  const safety = checkSafety(body);
  if (!safety.safe) {
    log.warn("SAFETY", safety.reason);
    return errorResponse(HTTP_STATUS.FORBIDDEN, safety.reason, { requestId });
  }

  // API key authentication (optional depending on settings)
  try {
    const { requireApiKey } = await import("@/lib/auth/apiKey.js");
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    if (settings.requireApiKey) {
      await requireApiKey(request);
      log.debug("AUTH", "API key validated");
    }
  } catch (err) {
    log.warn("AUTH", err.message);
    const status = err.code || HTTP_STATUS.UNAUTHORIZED;
    return errorResponse(status, err.message, { requestId });
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
    clientRawRequest.headers["x-request-id"] = requestId;
  }

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support both messages[] and input[] formats)
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""} | req=${requestId}`);

  // Log API key (masked)
  const apiKey = request.headers.get("Authorization");
  if (apiKey) {
    const masked = log.maskKey(apiKey.replace("Bearer ", ""));
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model", { requestId });
  }

  // Check if model is a playbook name (zippymesh/*, free/*, etc.)
  // If so, extract intent and route via playbook-based auto-routing
  const playbookInfo = resolvePlaybookIntent(modelStr);
  if (playbookInfo.isPlaybook) {
    log.info("CHAT", `Playbook model "${modelStr}" -> intent: ${playbookInfo.intent || "default"}`);
    
    // Inject intent into body for orchestrator routing
    body.intent = playbookInfo.intent || body.intent;
    body._playbookName = playbookInfo.playbookName;
    
    // Route using "auto" as the model - let routing engine pick based on playbook
    return handleSingleModelChat(body, "auto", clientRawRequest, request, requestId);
  }

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, requestId),
      log
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, requestId);
}

import { handleOrchestratedChat } from "../services/orchestrator.js";
import { compressContext } from "../utils/compression.js";

/**
 * Handle single model chat request with advanced orchestration
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, requestId = null) {
  // Extract userAgent and optional client/device headers from request
  const userAgent = request?.headers?.get("user-agent") || "";
  const clientId = request?.headers?.get("x-zippy-client-id")?.trim() || undefined;
  const deviceId = request?.headers?.get("x-zippy-device-id")?.trim() || undefined;
  const intentHeader = request?.headers?.get("x-zippy-intent")?.trim() || undefined;

  // Call the orchestrator to handle multi-account and cross-provider failover
  const result = await handleOrchestratedChat({
    body,
    modelStr,
    handleChatCore,
    log,
    clientRawRequest,
    requestId,
    userAgent,
    clientId,
    deviceId,
    intent: intentHeader || body?.intent,
    callbacks: {
      onCredentialsRefreshed: async (newCreds, connectionId, currentConnection) => {
        await updateProviderCredentials(connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
        await emitProviderLifecycleEvent("provider.refresh", {
          requestId,
          connectionId,
          provider: currentConnection?.provider || "unknown",
          detail: { source: "chat_orchestrator" },
        });
      },
      onRequestSuccess: async (connectionId, currentConnection) => {
        await clearAccountError(connectionId, currentConnection);
        await emitProviderLifecycleEvent("provider.recover", {
          requestId,
          connectionId,
          provider: currentConnection?.provider || "unknown",
          status: 200,
          detail: { source: "chat_orchestrator" },
        });
      },
      // Failure callback for orchestrator to mark accounts as unavailable
      onFailure: async (connectionId, status, error, provider, retryAfterMs) => {
        await markAccountUnavailable(connectionId, status, error, provider, retryAfterMs);
        await emitProviderLifecycleEvent("provider.fail", {
          requestId,
          connectionId,
          provider: provider || "unknown",
          status,
          detail: {
            retryAfterMs: retryAfterMs ?? null,
            error: typeof error === "string" ? error : (error?.message || "provider request failed"),
            source: "chat_orchestrator",
          },
        });
      }
    },
    // Context compression logic
    prepareBody: (body, candidate) => {
      // If we are switching to a model with potentially smaller context or just for cost,
      // we can apply compression here.
      if (body.messages && body.messages.length > 10) {
        log.info("COMPRESSION", `Compressing context for ${candidate.modelInfo.provider}/${candidate.modelInfo.model}`);
        return { ...body, messages: compressContext(body.messages) };
      }
      return body;
    }
  });

  // Orchestrator returns { success, response, responseCostUsd? } on success, or error Response
  const out = result?.response ?? result;
  if (out && result?.responseCostUsd != null && result.response instanceof Response) {
    const res = result.response;
    const headers = new Headers(res.headers);
    headers.set("X-Zippy-Response-Cost", String(result.responseCostUsd));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  return out;
}
