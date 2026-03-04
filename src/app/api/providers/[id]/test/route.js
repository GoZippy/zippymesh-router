import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
// Fallback for removed isCloudEnabled function
const isCloudEnabled = async () => false;

import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/app/api/sync/cloud/route";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, APIKEY_PROVIDERS } from "@/shared/constants/providers";
import {
  GEMINI_CONFIG,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  KIRO_CONFIG,
  CLAUDE_CONFIG,
} from "@/lib/oauth/constants/oauth";
import { refreshOAuthToken, isTokenExpired } from "@/lib/oauth/utils/refresh";

// OAuth provider test endpoints
const OAUTH_TEST_CONFIG = {
  claude: {
    // Claude doesn't have userinfo, we verify token exists and not expired
    checkExpiry: true,
    refreshable: true,
  },
  codex: {
    url: "https://api.openai.com/v1/models",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  cursor: {
    // Cursor uses imported local tokens; validate local token shape + expiry.
    checkExpiry: true,
    refreshable: false,
    requireMachineId: true,
  },
  "gemini-cli": {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  antigravity: {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
    // Add health check for Antigravity-specific inference engine
    inferenceProbe: true
  },
  github: {
    url: "https://api.github.com/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "User-Agent": "ZippyMesh", "Accept": "application/vnd.github+json" },
  },
  iflow: {
    url: "https://iflow.cn/api/oauth/getUserInfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  qwen: {
    url: "https://portal.qwen.ai/v1/models",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  kiro: {
    checkExpiry: true,
    refreshable: true,
  },
};

// API-key providers that can be validated with a simple bearer-token /models style check.
const SIMPLE_BEARER_MODELS_ENDPOINTS = {
  cerebras: "https://api.cerebras.ai/v1/models",
  togetherai: "https://api.together.xyz/v1/models",
  anyscale: "https://api.endpoints.anyscale.com/v1/models",
  fireworks: "https://api.fireworks.ai/inference/v1/models",
  perplexity: "https://api.perplexity.ai/models",
  deepinfra: "https://api.deepinfra.com/v1/openai/models",
  novita: "https://api.novita.ai/v3/openai/models",
  hyperbolic: "https://api.hyperbolic.xyz/v1/models",
  ai21: "https://api.ai21.com/studio/v1/models",
  nvidia: "https://integrate.api.nvidia.com/v1/models",
  databricks: "https://api.databricks.com/api/2.0/serving-endpoints",
  alephalpha: "https://api.aleph-alpha.com/models",
  writer: "https://api.writer.com/v1/models",
  moonshot: "https://api.moonshot.ai/v1/models",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/models",
  siliconflow: "https://api.siliconflow.cn/v1/models",
};

// Providers that are supported in UI but require additional non-key settings for validation.
const MANUAL_VALIDATION_HINTS = {
  azure: "Validation requires an Azure resource endpoint and deployment name.",
  bedrock: "Validation requires AWS credentials/signature (not just one API key).",
  vertex: "Validation requires Google service auth/project config.",
  cloudflare: "Validation requires account-specific endpoint configuration.",
  ibm: "Validation requires IAM token exchange and workspace config.",
  baidu: "Validation requires access key/secret signing flow.",
  tencent: "Validation requires Tencent credential signing flow.",
  volcengine: "Validation requires access key/secret signing flow.",
  replicate: "Validation requires model-scoped endpoint selection.",
  sandstone: "Validation requires provider-specific base URL configuration.",
  skypilot: "Validation requires provider-specific base URL configuration.",
  ossscore: "Validation requires provider-specific base URL configuration.",
  volta: "Validation requires provider-specific base URL configuration.",
  wordware: "Validation requires provider-specific base URL configuration.",
  poolside: "Validation requires provider-specific base URL configuration.",
  lighton: "Validation requires provider-specific base URL configuration.",
  ayfie: "Validation requires provider-specific base URL configuration.",
  ali_bailian: "Validation requires DashScope-compatible endpoint selection.",
  zerooneai: "Validation requires provider-specific endpoint selection.",
  kiro_api: "Validation requires configured Kiro/OpenRouter-compatible endpoint.",
  featherless: "Validation requires provider-specific endpoint selection.",
  abacus: "Validation requires provider-specific endpoint selection.",
  lepton: "Validation requires provider-specific endpoint selection.",
  huggingface: "Validation requires model-specific or endpoint-specific validation.",
  github_models: "Validation requires GitHub Models endpoint compatibility settings.",
};

/**
 * Sync to cloud if enabled
 */
async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing to cloud after token refresh:", error);
  }
}

/**
 * Test OAuth connection by calling provider API
 * Auto-refreshes token if expired
 * @returns {{ valid: boolean, error: string|null, refreshed: boolean, newTokens: object|null }}
 */
async function testOAuthConnection(connection) {
  const config = OAUTH_TEST_CONFIG[connection.provider];

  if (!config) {
    return { valid: false, error: `Provider test not supported: ${connection.provider}`, refreshed: false };
  }

  // Check if token exists
  if (!connection.accessToken) {
    return { valid: false, error: "No access token", refreshed: false };
  }

  let accessToken = connection.accessToken;
  let refreshed = false;
  let newTokens = null;

  // Auto-refresh if token is expired and provider supports refresh
  const tokenExpired = isTokenExpired(connection);
  if (config.refreshable && tokenExpired && connection.refreshToken) {
    const newAccessToken = await refreshOAuthToken(connection);
    if (newAccessToken) {
      accessToken = newAccessToken;
      refreshed = true;
    } else {
      // Refresh failed
      return { valid: false, error: "Token expired and refresh failed", refreshed: false };
    }
  }

  // For providers that only check expiry (no test endpoint available)
  if (config.checkExpiry) {
    if (config.requireMachineId && !connection.providerSpecificData?.machineId) {
      return { valid: false, error: "Missing machine ID for imported token", refreshed: false };
    }

    // Cursor imported tokens are opaque; we can only validate presence/shape and expiry.
    if (connection.provider === "cursor") {
      const tokenLooksValid = typeof accessToken === "string" && accessToken.length >= 50;
      if (!tokenLooksValid) {
        return { valid: false, error: "Invalid imported Cursor token format", refreshed: false };
      }
    }

    // If we already refreshed successfully, token is valid
    if (refreshed) {
      return { valid: true, error: null, refreshed, newTokens };
    }
    // Check if token is expired (no refresh available)
    if (tokenExpired) {
      return { valid: false, error: "Token expired", refreshed: false };
    }
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  // Call test endpoint
  try {
    const headers = {
      [config.authHeader]: `${config.authPrefix}${accessToken}`,
      ...config.extraHeaders,
    };

    const res = await fetch(config.url, {
      method: config.method,
      headers,
    });

    if (res.ok) {
      // If we have an inference probe, check that too
      if (config.inferenceProbe) {
        try {
          const { AntigravityExecutor } = await import("open-sse/executors/antigravity.js");
          const { openaiToAntigravityRequest } = await import("open-sse/translator/request/openai-to-gemini.js");
          const executor = new AntigravityExecutor();
          const testBody = {
            model: "ag/gemini-2.5-flash", // Use a light antigravity model
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
            stream: false
          };
          const envelope = openaiToAntigravityRequest(testBody.model, testBody, false, connection);
          const probeResult = await executor.execute({
            model: testBody.model,
            body: envelope,
            stream: false,
            credentials: { ...connection, accessToken },
            log: console
          });
          if (!probeResult.response.ok) {
            return { valid: false, error: `Inference probe failed: ${probeResult.response.status}`, refreshed };
          }
        } catch (probeErr) {
          return { valid: false, error: `Inference probe error: ${probeErr.message}`, refreshed };
        }
      }
      return { valid: true, error: null, refreshed, newTokens };
    }

    // If 401 and we haven't tried refresh yet, try refresh now
    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const newAccessToken = await refreshOAuthToken(connection);
      if (newAccessToken) {
        // Retry with new token
        const retryRes = await fetch(config.url, {
          method: config.method,
          headers: {
            [config.authHeader]: `${config.authPrefix}${newAccessToken}`,
            ...config.extraHeaders,
          },
        });

        if (retryRes.ok) {
          return { valid: true, error: null, refreshed: true };
        }
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    if (res.status === 401) {
      return { valid: false, error: "Token invalid or revoked", refreshed };
    }
    if (res.status === 403) {
      return { valid: false, error: "Access denied", refreshed };
    }

    return { valid: false, error: `API returned ${res.status}`, refreshed };
  } catch (err) {
    return { valid: false, error: err.message, refreshed };
  }
}

/**
 * Test API key connection
 */
async function testApiKeyConnection(connection) {
  const apiKey = typeof connection?.apiKey === "string" ? connection.apiKey.trim() : connection?.apiKey;

  // OpenAI Compatible providers - test via /models endpoint
  if (isOpenAICompatibleProvider(connection.provider)) {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) {
      return { valid: false, error: "Missing base URL" };
    }
    try {
      const modelsUrl = `${modelsBase.replace(/\/$/, "")}/models`;
      const res = await fetch(modelsUrl, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  // Anthropic Compatible providers - test via /models endpoint
  if (isAnthropicCompatibleProvider(connection.provider)) {
    let modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) {
      return { valid: false, error: "Missing base URL" };
    }
    try {
      modelsBase = modelsBase.replace(/\/$/, "");
      if (modelsBase.endsWith("/messages")) {
        modelsBase = modelsBase.slice(0, -9);
      }

      const modelsUrl = `${modelsBase}/models`;
      const res = await fetch(modelsUrl, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Authorization": `Bearer ${apiKey}`
        },
      });
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  try {
    switch (connection.provider) {
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        const valid = res.status !== 401;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "gemini": {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "openrouter": {
        const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "kilo": {
        // Kilo /models is public, so use a minimal authenticated chat request for validation.
        const res = await fetch("https://api.kilo.ai/api/gateway/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "kilo/auto",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            stream: false,
          }),
        });
        const valid = res.status !== 401;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "glm": {
        // GLM uses Claude-compatible API at api.z.ai
        const res = await fetch("https://api.z.ai/api/anthropic/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "glm-4.7",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "minimax":
      case "minimax-cn": {
        // MiniMax uses Claude-compatible API
        const minimaxEndpoints = {
          minimax: "https://api.minimax.io/anthropic/v1/messages",
          "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages",
        };
        const res = await fetch(minimaxEndpoints[connection.provider], {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "minimax-m2",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "kimi": {
        // Kimi uses Claude-compatible API
        const res = await fetch("https://api.kimi.com/coding/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "kimi-latest",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "deepseek": {
        const res = await fetch("https://api.deepseek.com/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "cerebras": {
        const res = await fetch("https://api.cerebras.ai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "groq": {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "mistral": {
        const res = await fetch("https://api.mistral.ai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "xai": {
        const res = await fetch("https://api.x.ai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "cohere": {
        const res = await fetch("https://api.cohere.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      default: {
        const providerId = connection.provider;

        // Shared fallback for common OpenAI-style /models providers.
        if (SIMPLE_BEARER_MODELS_ENDPOINTS[providerId]) {
          const res = await fetch(SIMPLE_BEARER_MODELS_ENDPOINTS[providerId], {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
        }

        // Explicit, provider-defined placeholders so every configured provider has a method path.
        if (MANUAL_VALIDATION_HINTS[providerId]) {
          return { valid: false, error: MANUAL_VALIDATION_HINTS[providerId] };
        }

        if (APIKEY_PROVIDERS[providerId]) {
          return { valid: false, error: `Validation strategy not yet configured for ${providerId}` };
        }

        return { valid: false, error: "Provider test not supported" };
      }
    }
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    let result;

    if (connection.authType === "apikey") {
      result = await testApiKeyConnection(connection);
    } else {
      result = await testOAuthConnection(connection);
    }

    // Build update data
    const updateData = {
      testStatus: result.valid ? "active" : "error",
      lastError: result.valid ? null : result.error,
      lastErrorAt: result.valid ? null : new Date().toISOString(),
    };

    // Update status in db
    await updateProviderConnection(id, updateData);

    // Sync to cloud if token was refreshed
    if (result.refreshed) {
      await syncToCloudIfEnabled();
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
