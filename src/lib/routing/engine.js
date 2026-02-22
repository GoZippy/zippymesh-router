
import { RateLimiter } from "./rateLimiter.js";
import { getRoutingPlaybooks, getProviderConnections, getPricingForModel, getSettings } from "../localDb.js";
import { resolveProviderId } from "../../shared/constants/providers.js";

/**
 * Routing Engine
 * Coordinates Playbooks, Rate Limits, and Cost analysis to select the best provider.
 */
export class RoutingEngine {
    constructor() {
        this.rateLimiter = new RateLimiter();
    }

    /**
     * Find the best candidates for a request
     * @param {object} requestContext
     * @param {string} requestContext.model - Requested model ID
     * @param {string} requestContext.userGroup - User group (personal, work, etc)
     * @param {number} requestContext.estimatedTokens - Token estimate
     * @returns {Promise<Array>} Sorted candidates
     */
    async findRoute(requestContext) {
        const { model } = requestContext;

        // 1. Identify applicable Playbook
        const playbooks = await getRoutingPlaybooks();
        const settings = await getSettings();
        const activePlaybook = await this.selectPlaybook(playbooks, requestContext, settings);



        // 2. Get all potential connections
        const equivalentModels = requestContext.equivalentModels || [model];
        let candidates = [];

        // Gather all candidates
        for (const modelStr of equivalentModels) {
            // Support both provider/model and provider:model
            const separator = modelStr.includes("/") ? "/" : (modelStr.includes(":") ? ":" : null);

            if (separator) {
                const parts = modelStr.split(separator);
                const providerAlias = parts[0];
                const providerId = resolveProviderId(providerAlias);
                const modelName = parts.slice(1).join(separator);

                const connections = await getProviderConnections({ provider: providerId, isActive: true });

                for (const conn of connections) {
                    candidates.push({
                        connection: conn,
                        provider: providerId,
                        model: modelName,
                        score: 0,
                        reasons: []
                    });
                }
            } else {
                // If no provider specified, check ALL active connections
                const allConnections = await getProviderConnections({ isActive: true });
                for (const conn of allConnections) {
                    candidates.push({
                        connection: conn,
                        provider: conn.provider,
                        model: modelStr,
                        score: 0,
                        reasons: []
                    });
                }
            }
        }



        // 3. Filter by Rate Limits
        const availableCandidates = [];
        for (const cand of candidates) {
            const limitCheck = await this.rateLimiter.checkLimit(cand.provider, cand.model, {
                estimatedTokens: requestContext.estimatedTokens
            });

            if (limitCheck.allowed) {
                availableCandidates.push(cand);
            }
        }



        // 4. Score/Sort based on Playbook or Default Strategy
        let results;
        if (activePlaybook) {
            results = await this.executePlaybook(activePlaybook, availableCandidates, requestContext);
        } else {
            results = await this.defaultStrategy(availableCandidates, requestContext);
        }



        return results;
    }

    async selectPlaybook(playbooks, context, settings) {
        // Sort playbooks by priority
        const sorted = playbooks.filter(p => p.isActive).sort((a, b) => b.priority - a.priority);

        for (const pb of sorted) {
            // Check triggers if they exist
            if (pb.trigger) {
                // Intent Trigger
                if (pb.trigger.type === "intent") {
                    // Context must have matching intent
                    if (context.intent === pb.trigger.value) return pb;
                }
                // Group Trigger
                else if (pb.trigger.type === "group") {
                    if (context.userGroup === pb.trigger.value) return pb;
                }
                // If trigger doesn't match, skip this playbook
                continue;
            }

            // If no trigger, it's a candidate for "global" playbook if it was manually set
            // but we'll prioritize the one defined in settings if none of the triggered ones match.
        }

        // Fallback to default playbook from settings
        if (settings?.defaultPlaybookId) {
            const defaultPb = playbooks.find(p => p.id === settings.defaultPlaybookId && p.isActive);
            if (defaultPb) return defaultPb;
        }

        return null;
    }

    async defaultStrategy(candidates, context) {
        // Re-implement the existing "Group > Priority > Cost" logic
        const scored = [];

        const GROUP_PRIORITY = { personal: 10, work: 20, team: 30, default: 40 };

        for (const cand of candidates) {
            const groupScore = GROUP_PRIORITY[cand.connection.group || "default"] || 99;
            const priority = cand.connection.priority || 999;

            // Pricing
            const pricing = await getPricingForModel(cand.provider, cand.model) || { input: 0, output: 0 };
            const costScore = (pricing.input * 1000) + (pricing.output * 1000);

            const finalScore = (groupScore * 10000) + (priority * 10) + costScore;

            scored.push({
                ...cand,
                score: finalScore,
                costPer1k: costScore
            });
        }

        return scored.sort((a, b) => a.score - b.score);
    }

    async executePlaybook(playbook, candidates, context) {
        let filtered = [...candidates];
        const scored = [];

        // 1. Apply Filtering Rules first
        for (const rule of playbook.rules || []) {
            if (rule.type === "filter-in") {
                // Only keep matching providers
                filtered = filtered.filter(c => c.provider === rule.value);
            } else if (rule.type === "filter-out") {
                // Remove matching providers
                filtered = filtered.filter(c => c.provider !== rule.value);
            }
        }

        // 2. Score remaining using Default Strategy as base, then apply modifiers
        // We reuse defaultStrategy logic for base scoring to keep consistency
        const baseScored = await this.defaultStrategy(filtered, context);

        for (const cand of baseScored) {
            let score = cand.score; // Lower is better in default strategy

            // Apply Boost/Penalty Rules
            for (const rule of playbook.rules || []) {
                const isMatch = cand.provider === rule.target || cand.model.includes(rule.target);

                if (isMatch) {
                    if (rule.type === "boost") {
                        // Reduce score (lower is better)
                        score -= (rule.value || 1000);
                    } else if (rule.type === "penalty") {
                        // Increase score
                        score += (rule.value || 1000);
                    } else if (rule.type === "stack") {
                        // Value is an array or comma-separated string of preferred order
                        const order = Array.isArray(rule.value) ? rule.value : (typeof rule.value === "string" ? rule.value.split(",") : []);
                        const index = order.indexOf(cand.provider) !== -1 ? order.indexOf(cand.provider) : order.indexOf(cand.model);

                        if (index !== -1) {
                            // Boost based on position in stack (position 0 gets biggest boost)
                            const stackBoost = (order.length - index) * 10000;
                            score -= stackBoost;
                        }
                    }
                }
            }

            scored.push({ ...cand, score });
        }

        // 3. Find if there is a batch rule defined in the playbook
        const batchRule = playbook.rules?.find(r => r.type === "batch");
        if (batchRule) {
            scored.forEach(s => s.batchRule = batchRule);
        }

        return scored.sort((a, b) => a.score - b.score);
    }

    /**
     * Record usage for a successful request
     * @param {string} provider
     * @param {string} model
     * @param {object} usage
     * @param {object} headers
     */
    async recordUsage(provider, model, usage, headers) {
        return this.rateLimiter.recordUsage(provider, model, usage, headers);
    }
}
