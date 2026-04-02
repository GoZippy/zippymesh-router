// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getRoutingPlaybooks } from "@/lib/localDb";
import { parseModel, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";

export { parseModel };

/**
 * Map zippymesh/* playbook names to intents for routing
 * e.g., "zippymesh/code-focus" -> triggers "code" intent routing
 */
const PLAYBOOK_INTENT_MAP = {
  "zippymesh/code-focus": "code",
  "zippymesh/fast-code": "fast_code",
  "zippymesh/architect": "architect",
  "zippymesh/ask": "ask",
  "zippymesh/debug": "debug",
  "zippymesh/review": "review",
  "zippymesh/orchestrator": "orchestrator",
  "zippymesh/document": "document",
  "zippymesh/tool-agent": "tool_use",
  "free/code-focus": "free_code",
  "free/fast": "free_fast",
  "free/reasoning": "free_reasoning",
  "free/chat": "free_chat",
  "local/privacy-strict": "local",
  "urgent/premium": "urgent",
  "mixed/budget-quality": null // default playbook, no specific intent
};

/**
 * Check if model string is a playbook name and return the intent
 * @param {string} modelStr - Model string (e.g., "zippymesh/code-focus")
 * @returns {{ isPlaybook: boolean, intent?: string, playbookName?: string }}
 */
export function resolvePlaybookIntent(modelStr) {
  if (!modelStr) return { isPlaybook: false };
  
  const lower = modelStr.toLowerCase();
  
  // Check static map first
  if (lower in PLAYBOOK_INTENT_MAP) {
    return { 
      isPlaybook: true, 
      intent: PLAYBOOK_INTENT_MAP[lower],
      playbookName: lower
    };
  }
  
  // Check for zippymesh/, free/, local/, urgent/, mixed/ prefixes
  const prefixes = ["zippymesh/", "free/", "local/", "urgent/", "mixed/"];
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return { 
        isPlaybook: true, 
        playbookName: lower,
        intent: lower.replace(prefix, "").replace(/-/g, "_")
      };
    }
  }
  
  return { isPlaybook: false };
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

// Local provider IDs for unified routing
const LOCAL_PROVIDER_IDS = ["ollama", "lmstudio"];

/**
 * Check if a provider ID is a local provider
 */
export function isLocalProvider(providerId) {
  return LOCAL_PROVIDER_IDS.includes(providerId);
}

/**
 * Get full model info (parse or resolve)
 * Also handles playbook-prefixed models (zippymesh/*, free/*, etc.)
 */
export async function getModelInfo(modelStr) {
  // Check if this is a playbook name - if so, return special marker
  const playbookInfo = resolvePlaybookIntent(modelStr);
  if (playbookInfo.isPlaybook) {
    return {
      provider: "auto",
      model: "auto",
      isPlaybook: true,
      intent: playbookInfo.intent,
      playbookName: playbookInfo.playbookName
    };
  }

  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Check if this is a local provider (ollama/model or lmstudio/model)
    if (isLocalProvider(parsed.provider)) {
      return {
        provider: parsed.provider,
        model: parsed.model,
        isLocal: true
      };
    }

    if (parsed.provider === parsed.providerAlias) {
      // Check OpenAI Compatible nodes
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      // Check Anthropic Compatible nodes
      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;
  
  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
