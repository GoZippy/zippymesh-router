/**
 * Sign-up and info URLs for each provider.
 * Used to link from the app provider page to provider websites.
 *
 * referralProgram: brief note if provider has referral/affiliate program (for future monetization).
 */
export const PROVIDER_URLS = {
  // Free
  iflow: { signupUrl: "https://iflow.team", infoUrl: "https://iflow.team" },
  qwen: { signupUrl: "https://qwenlm.github.io", infoUrl: "https://qwenlm.github.io" },

  // OAuth
  claude: { signupUrl: "https://claude.ai", infoUrl: "https://anthropic.com" },
  antigravity: { signupUrl: "https://antigravity.ai", infoUrl: "https://antigravity.ai" },
  codex: { signupUrl: "https://platform.openai.com", infoUrl: "https://openai.com" },
  "gemini-cli": { signupUrl: "https://aistudio.google.com", infoUrl: "https://ai.google.dev" },
  github: { signupUrl: "https://github.com/features/copilot", infoUrl: "https://github.com/features/copilot" },
  cursor: { signupUrl: "https://cursor.com", infoUrl: "https://cursor.com" },
  kiro: { signupUrl: "https://kiro.ai", infoUrl: "https://kiro.ai" },

  // API Key - Free tier
  groq: {
    signupUrl: "https://console.groq.com",
    infoUrl: "https://groq.com",
    referralProgram: "Partner Program (groq.com/apply-to-the-groq-partner-program); Groq for Startups ($10k credits)",
  },
  cerebras: {
    signupUrl: "https://cloud.cerebras.ai",
    infoUrl: "https://cerebras.ai",
    referralProgram: "None found",
  },
  github_models: {
    signupUrl: "https://github.com/marketplace/models",
    infoUrl: "https://github.com/marketplace/models",
    referralProgram: "None",
  },
  cohere: {
    signupUrl: "https://dashboard.cohere.com",
    infoUrl: "https://cohere.com",
    referralProgram: "Partner Program (cohere.ai/partners) - strategic, not API referral",
  },
  kilo: { signupUrl: "https://kilo.ai", infoUrl: "https://kilo.ai" },

  // API Key - Paid
  kiro_api: { signupUrl: "https://kiro.ai", infoUrl: "https://kiro.ai" },
  openrouter: {
    signupUrl: "https://openrouter.ai",
    infoUrl: "https://openrouter.ai/docs",
    referralProgram: "Contact support@openrouter.ai for partnership",
  },
  glm: { signupUrl: "https://open.bigmodel.cn", infoUrl: "https://open.bigmodel.cn" },
  kimi: { signupUrl: "https://platform.moonshot.cn", infoUrl: "https://kimi.moonshot.cn" },
  minimax: { signupUrl: "https://api.minimax.chat", infoUrl: "https://minimax.chat" },
  "minimax-cn": { signupUrl: "https://api.minimaxi.com", infoUrl: "https://minimaxi.com" },
  openai: {
    signupUrl: "https://platform.openai.com/signup",
    infoUrl: "https://platform.openai.com/docs",
    referralProgram: "None found for API",
  },
  anthropic: {
    signupUrl: "https://console.anthropic.com",
    infoUrl: "https://docs.anthropic.com",
    referralProgram: "Enterprise Referral (anthropic.com/referral); Consumer affiliate (30% recurring)",
  },
  gemini: {
    signupUrl: "https://aistudio.google.com",
    infoUrl: "https://ai.google.dev",
    referralProgram: "None found",
  },
  mistral: {
    signupUrl: "https://console.mistral.ai",
    infoUrl: "https://docs.mistral.ai",
    referralProgram: "None found",
  },
  togetherai: {
    signupUrl: "https://api.together.xyz",
    infoUrl: "https://together.ai",
    referralProgram: "Referral program (togetherplatform.com/referral) - verify if API-specific",
  },
  replicate: { signupUrl: "https://replicate.com", infoUrl: "https://replicate.com/docs" },
  anyscale: { signupUrl: "https://console.anyscale.com", infoUrl: "https://docs.anyscale.com" },
  fireworks: { signupUrl: "https://fireworks.ai", infoUrl: "https://fireworks.ai" },
  perplexity: { signupUrl: "https://perplexity.ai", infoUrl: "https://docs.perplexity.ai" },
  huggingface: {
    signupUrl: "https://huggingface.co/join",
    infoUrl: "https://huggingface.co/docs/api-inference",
    referralProgram: "None found",
  },
  deepinfra: { signupUrl: "https://deepinfra.com", infoUrl: "https://deepinfra.com/docs" },
  novita: { signupUrl: "https://novita.ai", infoUrl: "https://novita.ai" },
  lepton: { signupUrl: "https://lepton.ai", infoUrl: "https://lepton.ai/docs" },
  hyperbolic: { signupUrl: "https://hyperbolic.app", infoUrl: "https://hyperbolic.app" },
  featherless: { signupUrl: "https://featherless.ai", infoUrl: "https://featherless.ai" },
  abacus: { signupUrl: "https://abacus.ai", infoUrl: "https://abacus.ai" },
  ai21: { signupUrl: "https://studio.ai21.com", infoUrl: "https://docs.ai21.com" },
  nvidia: { signupUrl: "https://build.nvidia.com", infoUrl: "https://build.nvidia.com" },
  cloudflare: {
    signupUrl: "https://dash.cloudflare.com/sign-up",
    infoUrl: "https://developers.cloudflare.com/workers-ai",
    referralProgram: "Cloudflare Referral (cloudflare.com/referral)",
  },
  ibm: { signupUrl: "https://cloud.ibm.com", infoUrl: "https://www.ibm.com/products/watsonx-ai" },
  azure: {
    signupUrl: "https://azure.microsoft.com/products/cognitive-services/openai-service",
    infoUrl: "https://learn.microsoft.com/azure/ai-services/openai",
  },
  bedrock: {
    signupUrl: "https://aws.amazon.com/bedrock",
    infoUrl: "https://docs.aws.amazon.com/bedrock",
  },
  vertex: {
    signupUrl: "https://cloud.google.com/vertex-ai",
    infoUrl: "https://cloud.google.com/vertex-ai/docs",
  },
  sandstone: { signupUrl: "https://sandstone.io", infoUrl: "https://sandstone.io" },
  skypilot: { signupUrl: "https://skypilot.org", infoUrl: "https://skypilot.readthedocs.io" },
  databricks: { signupUrl: "https://databricks.com", infoUrl: "https://docs.databricks.com/ai" },
  alephalpha: { signupUrl: "https://aleph-alpha.com", infoUrl: "https://docs.aleph-alpha.com" },
  writer: { signupUrl: "https://writer.com", infoUrl: "https://writer.com" },
  ossscore: { signupUrl: "https://openscore.ai", infoUrl: "https://openscore.ai" },
  volta: { signupUrl: "https://voltaapi.com", infoUrl: "https://voltaapi.com" },
  wordware: { signupUrl: "https://wordware.ai", infoUrl: "https://wordware.ai" },
  poolside: { signupUrl: "https://poolside.ai", infoUrl: "https://poolside.ai" },
  xai: { signupUrl: "https://x.ai", infoUrl: "https://docs.x.ai" },
  lighton: { signupUrl: "https://lighton.ai", infoUrl: "https://lighton.ai" },
  ayfie: { signupUrl: "https://ayfie.com", infoUrl: "https://ayfie.com" },
  volcengine: { signupUrl: "https://volcengine.com", infoUrl: "https://www.volcengine.com/docs" },
  baidu: { signupUrl: "https://cloud.baidu.com", infoUrl: "https://cloud.baidu.com/product/wenxinworkshop" },
  tencent: { signupUrl: "https://cloud.tencent.com/product/hunyuan", infoUrl: "https://cloud.tencent.com/document/product/1729" },
  ali_bailian: { signupUrl: "https://dashscope.aliyun.com", infoUrl: "https://help.aliyun.com/zh/dashscope" },
  moonshot: { signupUrl: "https://platform.moonshot.cn", infoUrl: "https://moonshot.cn" },
  zhipu: { signupUrl: "https://open.bigmodel.cn", infoUrl: "https://open.bigmodel.cn" },
  zerooneai: { signupUrl: "https://platform.lingyiwanwu.com", infoUrl: "https://01.ai" },
  siliconflow: { signupUrl: "https://cloud.siliconflow.cn", infoUrl: "https://siliconflow.cn" },
};

/** Returns URL for provider icon (static file from public/providers). */
export function getProviderIconUrl(iconId) {
  return `/providers/${iconId}.png`;
}

export function getProviderSignupUrl(providerId) {
  return PROVIDER_URLS[providerId]?.signupUrl || null;
}

export function getProviderInfoUrl(providerId) {
  return PROVIDER_URLS[providerId]?.infoUrl || null;
}

export function getProviderUrls(providerId) {
  return PROVIDER_URLS[providerId] || null;
}
