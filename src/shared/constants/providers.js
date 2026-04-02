// Provider definitions

// Local Providers (Ollama, LM Studio, etc.)
export const LOCAL_PROVIDERS = {
  ollama: { id: "ollama", alias: "ol", name: "Ollama", icon: "computer", color: "#1E1E1E", textIcon: "OL", helpText: "Local LLM server via ollama.ai" },
  lmstudio: { id: "lmstudio", alias: "lm", name: "LM Studio", icon: "desktop_windows", color: "#00D4AA", textIcon: "LM", helpText: "Local LLM server via lmstudio.ai" },
};

// Free Providers
export const FREE_PROVIDERS = {
  iflow: {
    id: "iflow",
    alias: "if",
    name: "iFlow AI",
    icon: "water_drop",
    color: "#6366F1",
    requiresOAuthClientSecret: true,
  },
  qwen: { id: "qwen", alias: "qw", name: "Qwen Code", icon: "psychology", color: "#10B981" },
};

// OAuth Providers
export const OAUTH_PROVIDERS = {
  claude: { id: "claude", alias: "cc", name: "Claude Code", icon: "smart_toy", color: "#E85C4A" },
  antigravity: {
    id: "antigravity",
    alias: "ag",
    name: "Antigravity",
    icon: "rocket_launch",
    color: "#F59E0B",
    requiresOAuthClientSecret: true,
  },
  codex: { id: "codex", alias: "cx", name: "OpenAI Codex", icon: "code", color: "#3B82F6" },
  "gemini-cli": {
    id: "gemini-cli",
    alias: "gc",
    name: "Gemini CLI",
    icon: "terminal",
    color: "#4285F4",
    requiresOAuthClientSecret: true,
  },
  github: { id: "github", alias: "gh", name: "GitHub Copilot", icon: "code", color: "#333333", helpText: "Requires an active GitHub Copilot subscription." },
  cursor: { id: "cursor", alias: "cu", name: "Cursor IDE", icon: "edit_note", color: "#00D4AA" },
  kiro: { id: "kiro", alias: "kr", name: "Kiro AI", icon: "psychology_alt", color: "#FF6B35", helpText: "Requires Kiro IDE or CLI to be installed and authenticated." },
};

export const APIKEY_PROVIDERS = {
  // Free-tier API key providers
  groq: { id: "groq", alias: "groq", name: "Groq", icon: "bolt", color: "#F55036", textIcon: "GQ", freeTier: true, helpText: "Free tier available at console.groq.com. Supports Llama, Mistral, Gemma models." },
  cerebras: { id: "cerebras", alias: "cerebras", name: "Cerebras", icon: "memory", color: "#FF6B00", textIcon: "CB", freeTier: true, helpText: "Free tier available at cloud.cerebras.ai. World's fastest inference." },
  github_models: { id: "github_models", alias: "github_models", name: "GitHub Models", icon: "hub", color: "#238636", textIcon: "GM", freeTier: true, helpText: "Free via GitHub account at github.com/marketplace/models. Uses your GitHub Personal Access Token." },
  cohere: { id: "cohere", alias: "cohere", name: "Cohere", icon: "psychology", color: "#D18EE2", textIcon: "CO", freeTier: true, helpText: "Free trial tier available at cohere.com. Command and Embed models." },
  kilo: { id: "kilo", alias: "kilo", name: "Kilo.ai", icon: "hub", color: "#6366F1", textIcon: "KL", freeTier: true, passthroughModels: true, helpText: "Budget and free models through Kilo AI Gateway." },
  // Paid / Standard API key providers
  kiro_api: { id: "kiro_api", alias: "kiro", name: "Kiro (API Key)", icon: "bolt", color: "#FF6B35", textIcon: "KR", passthroughModels: true, helpText: "Direct API key only. For Kiro IDE / OAuth or import token, use the Kiro AI provider instead." },
  openrouter: { id: "openrouter", alias: "openrouter", name: "OpenRouter", icon: "router", color: "#6366F1", textIcon: "OR", passthroughModels: true },
  glm: { id: "glm", alias: "glm", name: "GLM Coding", icon: "code", color: "#2563EB", textIcon: "GL" },
  kimi: { id: "kimi", alias: "kimi", name: "Kimi Coding", icon: "psychology", color: "#1E3A8A", textIcon: "KM" },
  minimax: { id: "minimax", alias: "minimax", name: "Minimax Coding", icon: "memory", color: "#7C3AED", textIcon: "MM" },
  "minimax-cn": { id: "minimax-cn", alias: "minimax-cn", name: "Minimax (China)", icon: "memory", color: "#DC2626", textIcon: "MC" },
  openai: { id: "openai", alias: "openai", name: "OpenAI", icon: "auto_awesome", color: "#10A37F", textIcon: "OA" },
  anthropic: { id: "anthropic", alias: "anthropic", name: "Anthropic", icon: "smart_toy", color: "#E85C4A", textIcon: "AN" },
  gemini: { id: "gemini", alias: "gemini", name: "Gemini", icon: "diamond", color: "#4285F4", textIcon: "GE" },
  // Additional providers for 50+ target
  mistral: { id: "mistral", alias: "mistral", name: "Mistral AI", icon: "cloud", color: "#FF6B00", textIcon: "MT", helpText: "Mistral models via mistral.ai API." },
  togetherai: { id: "togetherai", alias: "together", name: "Together AI", icon: "hub", color: "#6366F1", textIcon: "TA", passthroughModels: true, helpText: "100+ open and custom models via together.ai." },
  replicate: { id: "replicate", alias: "replicate", name: "Replicate", icon: "copy", color: "#333333", textIcon: "RP", passthroughModels: true, helpText: "Run open-source models via replicate.com." },
  anyscale: { id: "anyscale", alias: "anyscale", name: "Anyscale", icon: "screen_rotation", color: "#6366F1", textIcon: "AS", passthroughModels: true, helpText: "Fine-tuned and base models via anyscale.com." },
  fireworks: { id: "fireworks", alias: "fireworks", name: "Fireworks AI", icon: "local_fire_department", color: "#FF6B00", textIcon: "FW", passthroughModels: true, helpText: "High-performance inference via fireworks.ai." },
  perplexity: { id: "perplexity", alias: "perplexity", name: "Perplexity", icon: "psychology", color: "#6366F1", textIcon: "PX", helpText: "Online LLMs via perplexity.ai." },
  huggingface: { id: "huggingface", alias: "huggingface", name: "Hugging Face", icon: "face", color: "#FF9D00", textIcon: "HF", passthroughModels: true, helpText: "Inference Endpoints via huggingface.co." },
  deepinfra: { id: "deepinfra", alias: "deepinfra", name: "DeepInfra", icon: "dns", color: "#6366F1", textIcon: "DI", passthroughModels: true, helpText: "Serverless inference via deepinfra.com." },
  novita: { id: "novita", alias: "novita", name: "Novita AI", icon: "auto_awesome", color: "#8B5CF6", textIcon: "NV", passthroughModels: true, helpText: "1000+ models via novita.ai." },
  lepton: { id: "lepton", alias: "lepton", name: "Lepton AI", icon: "bolt", color: "#6366F1", textIcon: "LP", passthroughModels: true, helpText: "Turnkey inference via lepton.ai." },
  hyperbolic: { id: "hyperbolic", alias: "hyperbolic", name: "Hyperbolic", icon: "local_offer", color: "#8B5CF6", textIcon: "HB", passthroughModels: true, helpText: "Affordable GPU computing via hyperbolic.app." },
  featherless: { id: "featherless", alias: "featherless", name: "Featherless", icon: "flight", color: "#6366F1", textIcon: "FL", passthroughModels: true, helpText: "Model deployment via featherless.ai." },
  abacus: { id: "abacus", alias: "abacus", name: "Abacus AI", icon: "calculate", color: "#2563EB", textIcon: "AB", passthroughModels: true, helpText: "Smaug and other models via abacus.ai." },
  ai21: { id: "ai21", alias: "ai21", name: "AI21 Labs", icon: "auto_stories", color: "#8B5CF6", textIcon: "AI", helpText: "Jurassic models via ai21.com." },
  nvidia: { id: "nvidia", alias: "nvidia", name: "NVIDIA AI", icon: "memory", color: "#76B900", textIcon: "NVDA", passthroughModels: true, helpText: "NIM microservices via build.nvidia.com." },
  cloudflare: { id: "cloudflare", alias: "cloudflare", name: "Cloudflare Workers AI", icon: "cloud", color: "#F38020", textIcon: "CF", passthroughModels: true, helpText: "Serverless AI via workers.ai." },
  ibm: { id: "ibm", alias: "ibm", name: "IBM watsonx", icon: "cloud", color: "#054ADA", textIcon: "IBM", passthroughModels: true, helpText: "Enterprise AI via watsonx.ai." },
  azure: { id: "azure", alias: "azure", name: "Azure OpenAI", icon: "cloud", color: "#0078D4", textIcon: "AZ", helpText: "OpenAI models via Microsoft Azure." },
  bedrock: { id: "bedrock", alias: "bedrock", name: "AWS Bedrock", icon: "cloud", color: "#FF9900", textIcon: "AWS", passthroughModels: true, helpText: "Amazon Bedrock via AWS." },
  vertex: { id: "vertex", alias: "vertex", name: "Google Vertex AI", icon: "cloud", color: "#4285F4", textIcon: "VRTX", passthroughModels: true, helpText: "Google models via Vertex AI." },
  sandstone: { id: "sandstone", alias: "sandstone", name: "Sandstone", icon: "cloud", color: "#6366F1", textIcon: "SS", passthroughModels: true, helpText: "Infrastructure via sandstone.io." },
  skypilot: { id: "skypilot", alias: "skypilot", name: "SkyPilot", icon: "flight_takeoff", color: "#6366F1", textIcon: "SP", passthroughModels: true, helpText: "Unified inference via skypilot.org." },
  databricks: { id: "databricks", alias: "databricks", name: "Databricks", icon: "analytics", color: "#FF36200", textIcon: "DB", passthroughModels: true, helpText: "Foundation models via databricks.com." },
  alephalpha: { id: "alephalpha", alias: "alephalpha", name: "Aleph Alpha", icon: "psychology", color: "#8B5CF6", textIcon: "AA", helpText: "European AI via aleph-alpha.com." },
  writer: { id: "writer", alias: "writer", name: "Writer", icon: "edit", color: "#6366F1", textIcon: "WR", helpText: "Enterprise LLMs via writer.com." },
  ossscore: { id: "ossscore", alias: "ossscore", name: "OpenScore", icon: "music_note", color: "#6366F1", textIcon: "OS", passthroughModels: true, helpText: "Open source models via openscore.ai." },
  volta: { id: "volta", alias: "volta", name: "Volta AI", icon: "bolt", color: "#FF6B00", textIcon: "VOLT", passthroughModels: true, helpText: "GPU inference via voltaapi.com." },
  wordware: { id: "wordware", alias: "wordware", name: "Wordware", icon: "text_fields", color: "#6366F1", textIcon: "WD", passthroughModels: true, helpText: "App-building LLMs via wordware.ai." },
  poolside: { id: "poolside", alias: "poolside", name: "Poolside", icon: "pool", color: "#8B5CF6", textIcon: "PL", helpText: "Coding assistant via poolside.ai." },
  xai: { id: "xai", alias: "xai", name: "xAI", icon: "smart_toy", color: "#000000", textIcon: "XAI", helpText: "Grok models via x.ai." },
  lighton: { id: "lighton", alias: "lighton", name: "LightOn", icon: "lightbulb", color: "#6366F1", textIcon: "LO", helpText: "Large context models via lighton.ai." },
  ayfie: { id: "ayfie", alias: "ayfie", name: "Ayfie", icon: "search", color: "#6366F1", textIcon: "AY", helpText: "Enterprise text analysis via ayfie.com." },
  volcengine: { id: "volcengine", alias: "volcengine", name: "Volcengine", icon: "cloud", color: "#FF4D4D", textIcon: "VC", helpText: "ByteDance's AI via volcengine.com." },
  baidu: { id: "baidu", alias: "baidu", name: "Baidu ERNIE", icon: "search", color: "#2932E1", textIcon: "BD", helpText: "ERNIE Bot via baidu.com." },
  tencent: { id: "tencent", alias: "tencent", name: "Tencent Hunyuan", icon: "cloud", color: "#12B7F5", textIcon: "TC", helpText: "Hunyuan models via cloud.tencent.com." },
  ali_bailian: { id: "ali_bailian", alias: "ali_bailian", name: "Alibaba Tongyi", icon: "cloud", color: "#FF6A00", textIcon: "ALI", helpText: "Tongyi Qianwen via alibabacloud.com." },
  moonshot: { id: "moonshot", alias: "moonshot", name: "Moonshot AI", icon: "nightlight", color: "#6366F1", textIcon: "MOON", helpText: "Kimi models via moonshot.ai." },
  zhipu: { id: "zhipu", alias: "zhipu", name: "Zhipu AI", icon: "psychology", color: "#635CFF", textIcon: "ZP", helpText: "GLM models via zhipuai.cn." },
  zerooneai: { id: "zerooneai", alias: "zerooneai", name: "01.AI", icon: "numeric", color: "#FF6B00", textIcon: "01", helpText: "Yi models via 01.ai." },
  siliconflow: { id: "siliconflow", alias: "siliconflow", name: "SiliconFlow", icon: "memory", color: "#6366F1", textIcon: "SF", passthroughModels: true, helpText: "Chinese models via siliconflow.cn." },
};

export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";

export function isOpenAICompatibleProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

export function isAnthropicCompatibleProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

// All providers (combined)
export const AI_PROVIDERS = { ...LOCAL_PROVIDERS, ...FREE_PROVIDERS, ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS };

export function requiresOAuthClientSecret(providerId) {
  return Boolean(AI_PROVIDERS[providerId]?.requiresOAuthClientSecret);
}

// Auth methods
export const AUTH_METHODS = {
  oauth: { id: "oauth", name: "OAuth", icon: "lock" },
  apikey: { id: "apikey", name: "API Key", icon: "key" },
};

// Helper: Get provider by alias
export function getProviderByAlias(alias) {
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.alias === alias || provider.id === alias) {
      return provider;
    }
  }
  return null;
}

// Helper: Get provider ID from alias
export function resolveProviderId(aliasOrId) {
  const provider = getProviderByAlias(aliasOrId);
  return provider?.id || aliasOrId;
}

// Helper: Get alias from provider ID
export function getProviderAlias(providerId) {
  const provider = AI_PROVIDERS[providerId];
  return provider?.alias || providerId;
}

// Alias to ID mapping (for quick lookup)
export const ALIAS_TO_ID = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.alias] = p.id;
  return acc;
}, {});

// ID to Alias mapping
export const ID_TO_ALIAS = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.id] = p.alias;
  return acc;
}, {});

// Providers that support usage/quota API
export const USAGE_SUPPORTED_PROVIDERS = ["antigravity", "kiro", "github"];
