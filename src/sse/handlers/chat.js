import { getProviderCredentials, markAccountUnavailable, clearAccountError } from "../services/auth.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { HTTP_STATUS } from "open-sse/config/constants.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support both messages[] and input[] formats)
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`);

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
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request),
      log
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request);
}

import { handleOrchestratedChat } from "../services/orchestrator.js";
import { compressContext } from "../utils/compression.js";

/**
 * Handle single model chat request with advanced orchestration
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null) {
  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Call the orchestrator to handle multi-account and cross-provider failover
  return await handleOrchestratedChat({
    body,
    modelStr,
    handleChatCore,
    log,
    clientRawRequest,
    userAgent,
    callbacks: {
      onCredentialsRefreshed: async (newCreds, connectionId) => {
        await updateProviderCredentials(connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async (connectionId, currentConnection) => {
        await clearAccountError(connectionId, currentConnection);
      },
      // Failure callback for orchestrator to mark accounts as unavailable
      onFailure: async (connectionId, status, error, provider) => {
        await markAccountUnavailable(connectionId, status, error, provider);
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
}
