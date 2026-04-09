import { BaseExecutor } from "./base.js";

/**
 * LocalExecutor - Handles local LLM providers (Ollama, LM Studio)
 * Key differences from cloud providers:
 * - No authentication required
 * - Base URL comes from connection metadata
 * - Uses OpenAI-compatible endpoints
 */
export class LocalExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, {});
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Get base URL from connection metadata or provider-specific data
    const baseUrl = credentials?.metadata?.baseUrl ||
      credentials?.providerSpecificData?.baseUrl ||
      this.getDefaultBaseUrl();

    const normalized = baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    
    // Both Ollama and LM Studio support OpenAI-compatible endpoints
    // Ollama: /v1/chat/completions (available since v0.1.14)
    // LM Studio: /v1/chat/completions
    return `${normalized}/v1/chat/completions`;
  }

  getDefaultBaseUrl() {
    switch (this.provider) {
      case "ollama":
        return "http://localhost:11434";
      case "lmstudio":
        return "http://localhost:1234";
      default:
        return "http://localhost:8080";
    }
  }

  buildHeaders(credentials, stream = true) {
    const headers = { "Content-Type": "application/json" };
    
    // Local providers typically don't need auth
    // But if an API key is provided (some LM Studio configs), use it
    if (credentials?.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }
    
    if (stream) {
      headers["Accept"] = "text/event-stream";
    }
    
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    // Both Ollama and LM Studio use OpenAI-compatible format
    // Just extract the model name from provider/model format
    const modelName = body.model?.split("/").pop() || model;
    
    return {
      ...body,
      model: modelName,
      stream: stream
    };
  }

  // Local providers don't need token refresh
  async refreshCredentials(credentials, log) {
    return null;
  }

  needsRefresh(credentials) {
    return false;
  }
}

export default LocalExecutor;
