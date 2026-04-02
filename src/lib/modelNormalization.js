import { resolveProviderId } from "@/shared/constants/providers.js";

const FAMILY_PATTERNS = [
  { family: "gpt", patterns: [/^gpt[-_]/, /^o\d/, /^chatgpt/] },
  { family: "claude", patterns: [/^claude[-_]/] },
  { family: "gemini", patterns: [/^gemini[-_]/] },
  { family: "llama", patterns: [/^llama[-_]/, /^meta[-_]llama/] },
  { family: "qwen", patterns: [/^qwen[-_]/] },
  { family: "mistral", patterns: [/^mistral[-_]/] },
  { family: "deepseek", patterns: [/^deepseek[-_]/] },
  { family: "kimi", patterns: [/^kimi[-_]/] },
  { family: "glm", patterns: [/^glm[-_]/, /^chatglm/] },
];

export function normalizeProviderId(provider) {
  return resolveProviderId(String(provider || "").trim().toLowerCase());
}

export function canonicalizeModelId(modelId) {
  const raw = String(modelId || "").trim().toLowerCase();
  if (!raw) return "unknown-model";

  const withoutPrefix = raw
    .replace(/^(openai|anthropic|gemini|google|cursor|kiro|github|groq|cerebras|openrouter)[/:]/, "")
    .replace(/^(models\/)/, "");

  return withoutPrefix
    .replace(/@[\w.\-]+$/g, "")
    .replace(/[-_](latest|preview|experimental)$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function inferModelFamily(canonicalModelId) {
  for (const { family, patterns } of FAMILY_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(canonicalModelId))) {
      return family;
    }
  }
  const first = canonicalModelId.split(/[-_./]/)[0];
  return first || "other";
}

export function toCanonicalModel(provider, providerModelId, metadata = null) {
  const canonicalModelId = metadata?.canonicalModelId || canonicalizeModelId(providerModelId);
  return {
    canonicalModelId,
    modelFamily: metadata?.modelFamily || inferModelFamily(canonicalModelId),
    providerModelId: String(providerModelId || ""),
    providerId: normalizeProviderId(provider),
  };
}

