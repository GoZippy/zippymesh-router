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
    ],
    "llama3-sota": [
        "groq/llama-3.1-8b-instant",
        "groq/llama-3.3-70b-versatile",
        "cerebras/llama3.1-8b",
        "github_models/llama-3.1-8b-instant",
    ]
};

/**
 * Get equivalent models for a given model string
 */
export function getEquivalentModels(modelStr) {
    // If explicitly requested a provider/model, we still might want to fail over to equivalents
    // if the user enables "cross-provider failover" globally.

    for (const [group, models] of Object.entries(SOTA_EQUIVALENCE)) {
        if (models.includes(modelStr) || group === modelStr) {
            return models;
        }
    }

    return [modelStr];
}
