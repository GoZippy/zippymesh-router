import assert from "assert";
import { buildProviderHeaders, buildProviderUrl, getProviderConfig } from "../open-sse/services/provider.js";
import { PROVIDER_MODELS_CONFIG, fetchProviderModels } from "../src/lib/providers/models.js";

async function run() {
  console.log("Running provider adapter tests...");

  const providers = [
    {
      id: "deepseek",
      expectedUrl: "https://api.deepseek.com/chat/completions",
      expectedModelsUrl: "https://api.deepseek.com/models",
    },
    {
      id: "groq",
      expectedUrl: "https://api.groq.com/openai/v1/chat/completions",
      expectedModelsUrl: "https://api.groq.com/openai/v1/models",
    },
    {
      id: "cerebras",
      expectedUrl: "https://api.cerebras.ai/v1/chat/completions",
      expectedModelsUrl: "https://api.cerebras.ai/v1/models",
    },
    {
      id: "cohere",
      expectedUrl: "https://api.cohere.ai/compatibility/v1/chat/completions",
      expectedModelsUrl: "https://api.cohere.com/v1/models",
    },
    {
      id: "mistral",
      expectedUrl: "https://api.mistral.ai/v1/chat/completions",
      expectedModelsUrl: "https://api.mistral.ai/v1/models",
    },
    {
      id: "xai",
      expectedUrl: "https://api.x.ai/v1/chat/completions",
      expectedModelsUrl: "https://api.x.ai/v1/models",
    },
    {
      id: "togetherai",
      expectedUrl: "https://api.together.xyz/v1/chat/completions",
      expectedModelsUrl: "https://api.together.xyz/v1/models",
    },
    {
      id: "fireworks",
      expectedUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
      expectedModelsUrl: "https://api.fireworks.ai/inference/v1/models",
    },
    {
      id: "anyscale",
      expectedUrl: "https://api.endpoints.anyscale.com/v1/chat/completions",
      expectedModelsUrl: "https://api.endpoints.anyscale.com/v1/models",
    },
    {
      id: "perplexity",
      expectedUrl: "https://api.perplexity.ai/chat/completions",
      expectedModelsUrl: "https://api.perplexity.ai/models",
    },
    {
      id: "deepinfra",
      expectedUrl: "https://api.deepinfra.com/v1/openai/chat/completions",
      expectedModelsUrl: "https://api.deepinfra.com/v1/openai/models",
    },
    {
      id: "novita",
      expectedUrl: "https://api.novita.ai/openai/v1/chat/completions",
      expectedModelsUrl: "https://api.novita.ai/v3/openai/models",
    },
    {
      id: "ai21",
      expectedUrl: "https://api.ai21.com/studio/v1/chat/completions",
      expectedModelsUrl: "https://api.ai21.com/studio/v1/models",
    },
    {
      id: "moonshot",
      expectedUrl: "https://api.moonshot.ai/v1/chat/completions",
      expectedModelsUrl: "https://api.moonshot.ai/v1/models",
    },
  ];

  for (const provider of providers) {
    const config = getProviderConfig(provider.id);
    assert(config.baseUrl === provider.expectedUrl, `${provider.id} base URL mismatch`);
    assert(config.format === "openai", `${provider.id} should use OpenAI format`);

    const requestUrl = buildProviderUrl(provider.id, "any-model", false);
    assert(requestUrl === provider.expectedUrl, `${provider.id} request URL mismatch`);

    const headers = buildProviderHeaders(provider.id, { apiKey: "  test-key  " }, false);
    assert(headers.Authorization === "Bearer test-key", `${provider.id} should trim API key`);
    assert(headers["Content-Type"] === "application/json", `${provider.id} should use JSON requests`);

    const modelConfig = PROVIDER_MODELS_CONFIG[provider.id];
    assert(modelConfig, `${provider.id} should have models sync config`);
    assert(modelConfig.url === provider.expectedModelsUrl, `${provider.id} models endpoint mismatch`);
  }

  const kiloConfig = PROVIDER_MODELS_CONFIG.kilo;
  assert(kiloConfig?.url === "https://api.kilo.ai/api/gateway/models", "kilo models endpoint mismatch");
  assert(PROVIDER_MODELS_CONFIG.minimax?.url === "https://api.minimax.io/anthropic/v1/models", "minimax models endpoint mismatch");
  assert(PROVIDER_MODELS_CONFIG["minimax-cn"]?.url === "https://api.minimaxi.com/anthropic/v1/models", "minimax-cn models endpoint mismatch");

  // xAI fallback endpoint should be used if /models fails
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "grok-4-fast" }] }),
    };
  };
  try {
    const models = await fetchProviderModels({
      provider: "xai",
      authType: "api_key",
      apiKey: "xai_test_key",
    });
    assert(Array.isArray(models), "xAI models response should be an array");
    assert(models.length === 1, "xAI fallback endpoint should return one model");
    assert(callCount === 2, "xAI should retry against fallback endpoint");
  } finally {
    global.fetch = originalFetch;
  }

  console.log("All provider adapter tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
