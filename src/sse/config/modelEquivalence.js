/**
 * SOTA Model Equivalence Map
 * Groups models that provide comparable quality/performance for seamless failover.
 */
export const SOTA_EQUIVALENCE = {
    "opus-sota": [
        "anthropic/claude-3-5-sonnet",
        "anthropic/claude-3-opus",
        "antigravity/claude-opus-4-6-thinking",
        "antigravity/claude-opus-4-5-thinking",
        "openai/gpt-4o",
        "openai/o1-preview",
    ],
    "sonnet-sota": [
        "anthropic/claude-3-5-sonnet",
        "openai/gpt-4o",
        "gemini/gemini-1.5-pro",
        "antigravity/claude-sonnet-4-5",
    ],
    "flash-sota": [
        "openai/gpt-4o-mini",
        "gemini/gemini-1.5-flash",
        "anthropic/claude-3-haiku",
        "anthropic/claude-haiku-4-5-20251001",
        "openrouter/anthropic/claude-haiku-4-5",
    ],
    "haiku-4-sota": [
        "anthropic/claude-haiku-4-5-20251001",
        "anthropic/claude-3-haiku",
        "openai/gpt-4o-mini",
        "gemini/gemini-1.5-flash",
        "openrouter/anthropic/claude-haiku-4-5",
    ],
    "llama3-sota": [
        "groq/llama-3.1-8b-instant",
        "groq/llama-3.3-70b-versatile",
        "cerebras/llama3.1-8b",
        "github_models/llama-3.1-8b-instant",
    ]
};

/** Pattern → equivalence group for cross-provider failover on 429 */
const MODEL_PATTERN_TO_GROUP = [
    { pattern: /claude-haiku-4-5|claude-3-haiku/i, group: "haiku-4-sota" },
    { pattern: /claude-haiku|haiku/i, group: "flash-sota" },
    { pattern: /claude-sonnet|sonnet/i, group: "sonnet-sota" },
    { pattern: /claude-opus|opus/i, group: "opus-sota" },
    { pattern: /gpt-4o-mini|gemini-1\.5-flash/i, group: "flash-sota" },
];

/**
 * Get equivalent models for a given model string.
 * Enables cross-provider failover on 429 by mapping unknown models to similar-tier equivalents.
 * Puts the requested model first when it has a provider prefix (e.g. cc/claude-sonnet-4-6) so
 * the user's chosen provider is tried before equivalents (avoids wrong-format 400 from routing
 * to a different provider's API shape).
 * @param {string} modelStr
 * @param {{ enableCrossProviderFailover?: boolean }} opts - When false, skip pattern expansion
 */
export function getEquivalentModels(modelStr, opts = {}) {
    const { enableCrossProviderFailover = true } = opts;

    // Exact match in SOTA_EQUIVALENCE
    for (const [group, models] of Object.entries(SOTA_EQUIVALENCE)) {
        if (models.includes(modelStr) || group === modelStr) {
            return models;
        }
    }

    if (!enableCrossProviderFailover) return [modelStr];

    // Pattern-based: map claude-haiku-4-5-*, anthropic/claude-haiku*, cc/claude-sonnet*, etc. to equivalents
    const normalized = String(modelStr).toLowerCase();
    for (const { pattern, group } of MODEL_PATTERN_TO_GROUP) {
        if (pattern.test(normalized)) {
            const equivalents = SOTA_EQUIVALENCE[group] || [modelStr];
            // Prefer the requested provider first to avoid wrong-format 400 (e.g. sending OpenAI
            // body to Gemini when user asked for Claude). If model has no prefix but is a Claude
            // model name, put cc/ first so Claude Code (OAuth) connection is tried before antigravity.
            const hasPrefix = modelStr.includes("/");
            if (hasPrefix && !equivalents.includes(modelStr)) {
                return [modelStr, ...equivalents];
            }
            if (!hasPrefix && /claude-(sonnet|opus|haiku)/i.test(modelStr)) {
                return [`cc/${modelStr}`, ...equivalents];
            }
            return equivalents;
        }
    }

    return [modelStr];
}

/**
 * Get suggested alternatives for rate-limited model (for user-facing error messages)
 */
export function getSuggestedAlternatives(modelStr) {
    const equivalents = getEquivalentModels(modelStr);
    return equivalents.filter((m) => m !== modelStr).slice(0, 5);
}
