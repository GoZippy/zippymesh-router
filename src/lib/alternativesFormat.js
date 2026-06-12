/**
 * Normalize provider/model strings to client-visible format (alias/modelId).
 * Clients receive model IDs from GET /v1/models as alias/modelId; 429 alternatives
 * must use the same format so clients can retry with them.
 */
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";

/**
 * @param {string[]} providerModelStrings - e.g. ["anthropic/claude-3-5-sonnet", "openai/gpt-4o"]
 * @returns {string[]} Client-visible format e.g. ["anthropic/claude-3-5-sonnet", "openai/gpt-4o"] (alias/modelId), deduplicated
 */
export function normalizeAlternativesToClientFormat(providerModelStrings) {
  if (!Array.isArray(providerModelStrings) || providerModelStrings.length === 0) return [];
  const seen = new Set();
  return providerModelStrings
    .filter(Boolean)
    .map((str) => {
      const idx = str.indexOf("/");
      if (idx === -1) return str;
      const provider = str.slice(0, idx);
      const model = str.slice(idx + 1);
      const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
      return `${alias}/${model}`;
    })
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}
