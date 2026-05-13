/**
 * OpenRouter Provider
 * Meta-provider giving access to 300+ models via OpenAI-compatible API.
 * Base URL: https://openrouter.ai/api/v1
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:20128";
const SITE_NAME = "ZippyMesh LLM Router";

export function getOpenRouterHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": SITE_URL,
    "X-Title": SITE_NAME,
  };
}

/**
 * List all models from OpenRouter, normalized to ZMLR format
 */
export async function listOpenRouterModels(apiKey) {
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: getOpenRouterHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.data || []).map(model => ({
    id: `openrouter/${model.id}`,
    name: model.name || model.id,
    provider: "openrouter",
    fullId: `openrouter/${model.id}`,
    contextWindow: model.context_length || 4096,
    isFree: model.pricing?.prompt === "0" && model.pricing?.completion === "0",
    inputPrice: parseFloat(model.pricing?.prompt || "0") * 1_000_000,
    outputPrice: parseFloat(model.pricing?.completion || "0") * 1_000_000,
    capabilities: inferCapabilities(model),
    metadata: { openrouterId: model.id, description: model.description },
  }));
}

function inferCapabilities(model) {
  const caps = ["chat"];
  const id = (model.id || "").toLowerCase();
  const name = (model.name || "").toLowerCase();
  if (id.includes("vision") || id.includes("vl") || name.includes("vision")) caps.push("vision");
  if (id.includes("code") || id.includes("coder") || id.includes("codestral")) caps.push("code");
  if (id.includes("embed")) caps.push("embedding");
  if (id.includes("opus") || id.includes("r1") || id.includes("o1") || id.includes("reasoning")) caps.push("reasoning");
  return caps;
}

/**
 * Forward a chat completion to OpenRouter
 */
export async function openRouterChatCompletion(apiKey, body) {
  // Strip openrouter/ prefix from model ID before forwarding
  const forwardBody = { ...body, model: body.model.replace(/^openrouter\//, "") };
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: getOpenRouterHeaders(apiKey),
    body: JSON.stringify(forwardBody),
  });
  return res;
}

/**
 * Check if an OpenRouter API key is valid
 */
export async function checkOpenRouterHealth(apiKey) {
  try {
    const res = await fetch(`${OPENROUTER_BASE}/auth/key`, {
      headers: getOpenRouterHeaders(apiKey),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
