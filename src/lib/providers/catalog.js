import { AI_PROVIDERS, OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS } from "../../shared/constants/providers.js";
import { PROVIDERS as RUNTIME_PROVIDER_CONFIG } from "../../../open-sse/config/constants.js";

const PROVIDER_DOCS = {
  openai: {
    models: "https://platform.openai.com/docs/api-reference/models/list",
    pricing: "https://developers.openai.com/api/docs/pricing",
    auth: "https://platform.openai.com/docs/quickstart",
  },
  anthropic: {
    models: "https://docs.anthropic.com/en/api/models",
    pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    usage: "https://docs.anthropic.com/en/api/usage-cost-api",
  },
  "gemini-cli": {
    models: "https://ai.google.dev/api/models",
    pricing: "https://ai.google.dev/gemini-api/docs/pricing",
    auth: "https://ai.google.dev/gemini-api/docs/oauth",
  },
  gemini: {
    models: "https://ai.google.dev/api/models",
    pricing: "https://ai.google.dev/gemini-api/docs/pricing",
    auth: "https://ai.google.dev/gemini-api/docs/api-key",
  },
  openrouter: {
    models: "https://openrouter.ai/docs/guides/overview/models",
    pricing: "https://openrouter.ai/pricing",
    auth: "https://openrouter.ai/docs/api-reference/overview/authentication",
  },
  deepseek: {
    models: "https://api-docs.deepseek.com/api/list-models",
    pricing: "https://api-docs.deepseek.com/quick_start/pricing",
    auth: "https://api-docs.deepseek.com/",
  },
  cerebras: {
    models: "https://inference-docs.cerebras.ai/api-reference/models",
    pricing: "https://www.cerebras.ai/pricing",
    auth: "https://inference-docs.cerebras.ai/quickstart",
  },
  cohere: {
    models: "https://docs.cohere.com/reference/list-models",
    pricing: "https://cohere.com/pricing",
    auth: "https://docs.cohere.com/reference/about",
  },
  kilo: {
    models: "https://kilo.ai/docs/gateway/models-and-providers",
    pricing: "https://kilo.ai/pricing",
    auth: "https://kilo.ai/docs/gateway/authentication",
  },
  mistral: {
    models: "https://docs.mistral.ai/api/endpoint/models",
    pricing: "https://mistral.ai/pricing",
    auth: "https://docs.mistral.ai/getting-started/quickstart/",
  },
  xai: {
    models: "https://docs.x.ai/developers/models",
    pricing: "https://docs.x.ai/developers/models",
    auth: "https://docs.x.ai/docs/quickstart",
  },
  groq: {
    models: "https://console.groq.com/docs/models",
    pricing: "https://wow.groq.com/pricing",
    auth: "https://console.groq.com/docs/quickstart",
  },
  minimax: {
    models: "https://platform.minimax.io/docs/api-reference/text-anthropic-api",
    pricing: "https://www.minimax.io/platform/document/Price?key=66701f0c1d57f38758d58184",
    auth: "https://platform.minimax.io/docs/guides/quickstart-sdk",
  },
  "minimax-cn": {
    models: "https://platform.minimax.io/docs/api-reference/text-anthropic-api",
    pricing: "https://www.minimax.io/platform/document/Price?key=66701f0c1d57f38758d58184",
    auth: "https://platform.minimax.io/docs/guides/quickstart-sdk",
  },
  togetherai: {
    models: "https://docs.together.ai/reference/list-models",
    pricing: "https://www.together.ai/pricing",
    auth: "https://docs.together.ai/docs/openai-api-compatibility",
  },
  fireworks: {
    models: "https://docs.fireworks.ai/api-reference/list-models",
    pricing: "https://www.fireworks.ai/pricing",
    auth: "https://docs.fireworks.ai/guides/querying-text-models",
  },
  anyscale: {
    models: "https://docs.anyscale.com/endpoints/text-generation/query-a-model",
    pricing: "https://www.anyscale.com/pricing",
    auth: "https://docs.anyscale.com/endpoints/text-generation/authenticate",
  },
  perplexity: {
    models: "https://docs.perplexity.ai/guides/model-cards",
    pricing: "https://docs.perplexity.ai/docs/pricing",
    auth: "https://docs.perplexity.ai/docs/getting-started/quickstart",
  },
  deepinfra: {
    models: "https://deepinfra.com/docs/openai_api",
    pricing: "https://deepinfra.com/pricing",
    auth: "https://deepinfra.com/docs/",
  },
  novita: {
    models: "https://novita.ai/docs/api-reference/model-apis-llm-create-chat-completion",
    pricing: "https://novita.ai/pricing",
    auth: "https://novita.ai/docs/",
  },
  ai21: {
    models: "https://docs.ai21.com/reference/chat-completions",
    pricing: "https://www.ai21.com/pricing",
    auth: "https://docs.ai21.com/docs/getting-started",
  },
  moonshot: {
    models: "https://platform.moonshot.ai/docs/api/chat",
    pricing: "https://platform.moonshot.ai/docs/pricing",
    auth: "https://platform.moonshot.ai/docs/guide/start-using-kimi-api",
  },
  claude: {
    models: "https://docs.anthropic.com/en/api/models",
    pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    auth: "https://docs.anthropic.com/en/docs/claude-code/overview",
  },
  codex: {
    models: "https://platform.openai.com/docs/api-reference/models/list",
    pricing: "https://developers.openai.com/api/docs/pricing",
    auth: "https://platform.openai.com/docs/guides/oauth",
  },
  github: {
    models: "https://docs.github.com/en/copilot/reference/ai-models",
    pricing: "https://github.com/pricing",
    auth: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
  },
  qwen: {
    models: "https://chat.qwen.ai/",
    pricing: "https://www.alibabacloud.com/help/en/model-studio/billing-overview",
    auth: "https://chat.qwen.ai/",
  },
};

function inferAuthMode(providerId) {
  if (OAUTH_PROVIDERS[providerId]) return "oauth";
  if (APIKEY_PROVIDERS[providerId]) return "api_key";
  if (FREE_PROVIDERS[providerId]) return "oauth_or_embedded";
  return "unknown";
}

function inferSyncCapability(providerId) {
  // These providers have known list-model endpoints in the current integration.
  const supportsModelSync = Boolean(RUNTIME_PROVIDER_CONFIG[providerId]) || providerId === "anthropic";
  const supportsLivePricingFromModels = ["openrouter", "kilo", "groq", "mistral", "xai", "deepseek"].includes(providerId);
  const supportsUsageCostApi = providerId === "anthropic";
  return { supportsModelSync, supportsLivePricingFromModels, supportsUsageCostApi };
}

export function getProviderCatalog() {
  const runtimeProviderIds = new Set(Object.keys(RUNTIME_PROVIDER_CONFIG || {}));
  const providers = Object.values(AI_PROVIDERS).map((provider) => {
    const docs = PROVIDER_DOCS[provider.id] || null;
    const sync = inferSyncCapability(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      alias: provider.alias,
      authMode: inferAuthMode(provider.id),
      runtimeConfigured: runtimeProviderIds.has(provider.id),
      docs,
      ...sync,
    };
  });

  const summary = {
    totalProviders: providers.length,
    runtimeConfigured: providers.filter((p) => p.runtimeConfigured).length,
    supportsModelSync: providers.filter((p) => p.supportsModelSync).length,
    supportsLivePricingFromModels: providers.filter((p) => p.supportsLivePricingFromModels).length,
  };

  return { summary, providers };
}

