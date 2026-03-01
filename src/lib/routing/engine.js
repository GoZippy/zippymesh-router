
import { RateLimiter } from "./rateLimiter.js";
import { getRoutingPlaybooks, getProviderConnections, getSettings } from "../localDb.js";
import { resolveProviderId } from "../../shared/constants/providers.js";
import { getRegistryModel } from "../modelRegistry.js";

function inferIntentFromContext(context = {}) {
    const explicitIntent = typeof context.intent === "string" ? context.intent.trim().toLowerCase() : "";
    if (explicitIntent) return explicitIntent;

    const messageText = Array.isArray(context.messages)
        ? context.messages.map((m) => (typeof m?.content === "string" ? m.content : "")).join(" ")
        : "";
    const signalText = [
        context.prompt,
        context.message,
        context.task,
        context.systemPrompt,
        messageText
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (!signalText) return "generic";
    if (/(code|coding|debug|refactor|typescript|javascript|python|function|class|bug)/.test(signalText)) return "code";
    if (/(research|analy|reason|compare|investigate|summar)/.test(signalText)) return "reasoning";
    if (/(tool|function call|api call|agent|workflow|automation)/.test(signalText)) return "tool_use";
    if (/(bot|runner|batch|cron|scheduled|pipeline)/.test(signalText)) return "bot_runner";

    return "generic";
}

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
            const separator = modelStr.includes("/") ? "/" : (modelStr.includes(":") ? ":" : null);

            if (separator) {
                const parts = modelStr.split(separator);
                const providerAlias = parts[0];
                const providerId = resolveProviderId(providerAlias);
                const modelName = parts.slice(1).join(separator);

                const connections = await getProviderConnections({ provider: providerId, isActive: true, isEnabled: true });

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
                const allConnections = await getProviderConnections({ isActive: true, isEnabled: true });
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
            const cooldownUntil = cand.connection?.rateLimitedUntil ? new Date(cand.connection.rateLimitedUntil).getTime() : 0;
            if (cooldownUntil && cooldownUntil > Date.now()) {
                cand.reasons.push(`cooldown_until:${cand.connection.rateLimitedUntil}`);
                continue;
            }

            const limitCheck = await this.rateLimiter.checkLimit(cand.provider, cand.model, {
                estimatedTokens: requestContext.estimatedTokens
            });

            if (limitCheck.allowed) {
                if (limitCheck.resetTime) {
                    cand.rateLimitResetAt = new Date(limitCheck.resetTime).toISOString();
                    cand.reasons.push(`rate_limit_reset:${cand.rateLimitResetAt}`);
                }
                availableCandidates.push(cand);
            } else {
                const blockedAt = limitCheck.resetTime ? new Date(limitCheck.resetTime).toISOString() : "unknown";
                cand.reasons.push(`rate_limited_until:${blockedAt}`);
            }
        }

        // 4. Score/Sort based on Playbook or Default Strategy
        let results;
        if (activePlaybook) {
            results = await this.executePlaybook(activePlaybook, availableCandidates, requestContext);
        } else {
            results = await this.defaultStrategy(availableCandidates, requestContext);
        }

        // Favor candidates without immediate reset pressure. If both have reset timestamps,
        // prefer the one with later reset to preserve providers that recover soon.
        results.sort((a, b) => {
            const aReset = a.rateLimitResetAt ? new Date(a.rateLimitResetAt).getTime() : Number.MAX_SAFE_INTEGER;
            const bReset = b.rateLimitResetAt ? new Date(b.rateLimitResetAt).getTime() : Number.MAX_SAFE_INTEGER;
            if (aReset !== bReset) return bReset - aReset;
            return a.score - b.score;
        });

        return results;
    }

    async selectPlaybook(playbooks, context, settings) {
        const sorted = playbooks.filter(p => p.isActive).sort((a, b) => b.priority - a.priority);
        const routingMode = (context?.routingMode || settings?.routingMode || "default").toLowerCase();
        const inferredIntent = inferIntentFromContext(context);

        if (routingMode === "auto" || routingMode === "playbook") {
            for (const pb of sorted) {
                if (!pb.trigger) continue;

                if (pb.trigger.type === "intent") {
                    const targetIntent = String(pb.trigger.value || "").toLowerCase();
                    if ((context.intent && context.intent.toLowerCase() === targetIntent)
                        || (routingMode === "auto" && inferredIntent === targetIntent)) {
                        return pb;
                    }
                }
                else if (pb.trigger.type === "group") {
                    if (context.userGroup === pb.trigger.value) return pb;
                }
                else if (pb.trigger.type === "pool") {
                    if (context.poolId === pb.trigger.value || context.pool === pb.trigger.value) return pb;
                }
            }
        }

        if (routingMode === "auto") {
            // Generic intent mapping fallback: route to playbook whose name/description matches inferred intent.
            if (inferredIntent !== "generic") {
                const inferredMatch = sorted.find((pb) => {
                    const haystack = `${pb.name || ""} ${pb.description || ""}`.toLowerCase();
                    return haystack.includes(inferredIntent);
                });
                if (inferredMatch) return inferredMatch;
            }
        }

        if (settings?.defaultPlaybookId && (routingMode === "auto" || routingMode === "playbook")) {
            const defaultPb = playbooks.find(p => p.id === settings.defaultPlaybookId && p.isActive);
            if (defaultPb) return defaultPb;
        }

        if (routingMode === "default") return null;

        return null;
    }

    async defaultStrategy(candidates, context) {
        const scored = [];
        const GROUP_PRIORITY = { personal: 10, work: 20, team: 30, default: 40 };

        for (const cand of candidates) {
            const groupScore = GROUP_PRIORITY[cand.connection.group || "default"] || 99;
            const priority = cand.connection.priority || 999;

            // Fetch from Model Registry
            const registryModel = await getRegistryModel(cand.provider, cand.model);
            const inputPrice = registryModel?.inputPrice || 0;
            const outputPrice = registryModel?.outputPrice || 0;
            const avgLatency = registryModel?.avgLatency || 0;

            const costScore = (inputPrice * 1000) + (outputPrice * 1000);

            // Base score favors: Group > Manual Priority > Low Cost > Low Latency
            const finalScore = (groupScore * 1000000) + (priority * 10000) + (costScore * 100) + (avgLatency / 100);

            scored.push({
                ...cand,
                score: finalScore,
                costPer1k: costScore,
                avgLatency,
                isFree: registryModel?.isFree || false,
                isPremium: registryModel?.isPremium || false
            });
        }

        return scored.sort((a, b) => a.score - b.score);
    }

    async executePlaybook(playbook, candidates, context) {
        let filtered = [...candidates];
        const scored = [];

        // 1. Apply Rules (Filtering)
        for (const rule of playbook.rules || []) {
            if (rule.type === "filter-in") {
                filtered = filtered.filter(c => c.provider === rule.value || c.model.includes(rule.value));
            } else if (rule.type === "filter-out") {
                filtered = filtered.filter(c => c.provider !== rule.value && !c.model.includes(rule.value));
            } else if (rule.type === "cost-threshold") {
                // value is max allowed cost per 1k (input+output)
                const registryModel = await getRegistryModel(c.provider, c.model);
                const cost = (registryModel?.inputPrice || 0) * 1000 + (registryModel?.outputPrice || 0) * 1000;
                filtered = filtered.filter(() => cost <= (rule.value || Infinity));
            }
        }

        // 2. Base Scoring
        const baseScored = await this.defaultStrategy(filtered, context);

        for (const cand of baseScored) {
            let score = cand.score;

            // 3. Apply Modifier Rules
            for (const rule of playbook.rules || []) {
                const isMatch = cand.provider === rule.target || cand.model.includes(rule.target) || rule.target === "*";

                if (isMatch) {
                    if (rule.type === "boost") {
                        score -= (rule.value || 1000);
                    } else if (rule.type === "penalty") {
                        score += (rule.value || 1000);
                    } else if (rule.type === "sort-by-cheapest") {
                        // Heavily boost based on inverted cost
                        const costBoost = (1 / (cand.costPer1k + 0.000001)) * 10000;
                        score -= costBoost;
                    } else if (rule.type === "sort-by-fastest") {
                        // Boost based on inverted latency
                        const speedBoost = (1 / (cand.avgLatency + 1)) * 50000;
                        score -= speedBoost;
                    } else if (rule.type === "stack") {
                        const order = Array.isArray(rule.value) ? rule.value : (typeof rule.value === "string" ? rule.value.split(",") : []);
                        const index = order.indexOf(cand.provider) !== -1 ? order.indexOf(cand.provider) : order.indexOf(cand.model);

                        if (index !== -1) {
                            const stackBoost = (order.length - index) * 50000;
                            score -= stackBoost;
                        }
                    }
                }
            }

            // Context-Aware Routing override:
            // If the connection group matches the context userGroup, give it a massive boost
            if (context.userGroup && cand.connection.group === context.userGroup) {
                score -= 2000000;
            }

            scored.push({ ...cand, score });
        }

        return scored.sort((a, b) => a.score - b.score);
    }

    /**
     * Record usage for a successful request
     */
    async recordUsage(provider, model, usage, headers) {
        return this.rateLimiter.recordUsage(provider, model, usage, headers);
    }
}
