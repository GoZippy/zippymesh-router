import { getProviderConnections, getRoutingPlaybooks, getCombos } from "../localDb.js";
import { PROVIDER_MODELS } from "../../shared/constants/models";
import { isOpenAICompatibleProvider } from "../../shared/constants/providers";

/**
 * Model Discovery Service
 * Syncs provider model lists and detects deprecated models in use.
 */
export class ModelDiscovery {
    /**
     * Sync models for all active connections
     */
    async syncAll() {
        const connections = await getProviderConnections({ isActive: true });
        const results = [];

        for (const conn of connections) {
            const discovered = await this.fetchProviderModels(conn);
            results.push({ connectionId: conn.id, provider: conn.provider, models: discovered });
        }

        return results;
    }

    /**
     * Fetch models from a provider's API
     */
    async fetchProviderModels(connection) {
        // For OpenAI-compatible providers, we can try /v1/models
        if (isOpenAICompatibleProvider(connection.provider) || connection.authType === "apikey") {
            try {
                const baseUrl = connection.baseUrl || this.getDefaultBaseUrl(connection.provider);
                if (!baseUrl) return [];

                const headers = {
                    "Authorization": `Bearer ${connection.apiKey || connection.accessToken}`
                };

                const res = await fetch(`${baseUrl}/models`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    // OpenAI returns { data: [{ id: "model-id", ... }] }
                    return (data.data || []).map(m => m.id);
                }
            } catch (err) {
                console.error(`[Discovery] Failed to fetch models for ${connection.provider}:`, err.message);
            }
        }

        // Fallback to static list for known providers if dynamic fails
        return (PROVIDER_MODELS[connection.provider] || []).map(m => m.id);
    }

    /**
     * Detect deprecated models used in Playbooks or Combos
     */
    async detectDeprecations() {
        const playbooks = await getRoutingPlaybooks();
        const combos = await getCombos();
        const connections = await getProviderConnections({ isActive: true });

        // Build a map of currently available models across all connections
        const available = new Set();
        for (const conn of connections) {
            const models = await this.fetchProviderModels(conn);
            models.forEach(m => available.add(`${conn.provider}/${m}`));
        }

        const issues = [];

        // Check Playbooks
        for (const pb of playbooks) {
            for (const rule of pb.rules || []) {
                if (rule.type === "boost" || rule.type === "penalty") {
                    // Rule targets are often provider/model strings
                    if (rule.target.includes("/") && !available.has(rule.target)) {
                        issues.push({
                            type: "playbook",
                            id: pb.id,
                            name: pb.name,
                            target: rule.target,
                            reason: "Model no longer reported by provider"
                        });
                    }
                }
            }
        }

        // Check Combos
        for (const cb of combos) {
            for (const modelString of cb.models || []) {
                if (!available.has(modelString)) {
                    issues.push({
                        type: "combo",
                        id: cb.id,
                        name: cb.name,
                        target: modelString,
                        reason: "Model no longer reported by provider"
                    });
                }
            }
        }

        return issues;
    }

    getDefaultBaseUrl(provider) {
        const urls = {
            groq: "https://api.groq.com/openai/v1",
            openai: "https://api.openai.com/v1",
            anthropic: "https://api.anthropic.com/v1", // Note: Anthropic models API is different, handling here simplified
            cerebras: "https://api.cerebras.ai/v1",
        };
        return urls[provider] || null;
    }

    /**
     * Get suggestions for alternative models
     */
    getSuggestions(deprecatedModelId) {
        // Simple intelligence: if llama-3-8b is gone, suggest llama-3.1-8b or llama-3.3-70b
        // This could be enhanced with a static mapping of quality tiers
        return [
            "meta-llama/llama-3.1-8b-instruct",
            "meta-llama/llama-3.3-70b-instruct",
            "openai/gpt-4o-mini"
        ];
    }
}

export const modelDiscovery = new ModelDiscovery();
