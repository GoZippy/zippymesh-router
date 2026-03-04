import { RateLimiter } from "./rateLimiter.js";
import {
  getRoutingPlaybooks,
  getProviderConnections,
  getSettings,
  getRoutingFilters,
  getRoutingControls,
  getPeerMetadata,
  getPeerMetadataBatch
} from "../localDb.js";
import { resolveProviderId, FREE_PROVIDERS, APIKEY_PROVIDERS } from "../../shared/constants/providers.js";
import { getRegistryModel } from "../modelRegistry.js";
import { getTrustScore } from "../trustScore.js";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "../../shared/constants/models.js";
import { getRoutingMemorySuggestions } from "../routingMemory.js";

/** Model id patterns that indicate vision/multimodal capability (for routing image requests). */
const VISION_MODEL_PATTERNS = [
    /vision/i, /gpt-4o/i, /gpt-4-vision/i, /gpt-4-turbo/i,
    /claude-3/i, /claude-3-5/i, /gemini/i, /llama-3\.2.*vision/i
];
function isVisionCapable(modelId) {
    if (!modelId || typeof modelId !== "string") return false;
    return VISION_MODEL_PATTERNS.some((re) => re.test(modelId));
}

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
        let availableCandidates = [];
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

        // 4. Apply Routing Filters (trust score, IP, country, cost, latency)
        availableCandidates = await this.applyRoutingFilters(availableCandidates);

        // 5. Score/Sort based on Playbook or Default Strategy
        let results;
        if (activePlaybook) {
            results = await this.executePlaybook(activePlaybook, availableCandidates, requestContext);
        } else {
            results = await this.defaultStrategy(availableCandidates, requestContext);
        }

        // Optional: bias toward models that worked for similar requests (routing memory)
        if (settings?.enableRoutingMemory && results?.length > 0) {
            const memorySuggestions = getRoutingMemorySuggestions({
                intent: requestContext.intent || "generic",
                clientId: requestContext.clientId || null,
                limit: 15
            });
            const memorySet = new Set(memorySuggestions.map((s) => `${s.provider}:${s.model}`));
            const MEMORY_BOOST = 50000;
            for (const r of results) {
                if (memorySet.has(`${r.provider}:${r.model}`)) {
                    r.score = Math.max(0, (r.score || 0) - MEMORY_BOOST);
                }
            }
        }

        // Favor candidates without immediate reset pressure. If both have reset timestamps,
        // prefer the one with later reset to preserve providers that recover soon.
        results.sort((a, b) => {
            const aReset = a.rateLimitResetAt ? new Date(a.rateLimitResetAt).getTime() : Number.MAX_SAFE_INTEGER;
            const bReset = b.rateLimitResetAt ? new Date(b.rateLimitResetAt).getTime() : Number.MAX_SAFE_INTEGER;
            if (aReset !== bReset) return bReset - aReset;
            return a.score - b.score;
        });

        // Optional: external router hook — merge suggested order from external URL
        const externalUrl = settings?.externalRouterUrl?.trim?.();
        if (externalUrl && results?.length > 0) {
            try {
                const payload = {
                    model: modelStr,
                    intent: requestContext.intent || null,
                    hasImage: requestContext.hasImage || false,
                    estimatedTokens: requestContext.estimatedTokens || 100,
                    clientId: requestContext.clientId || null
                };
                // Validate payload size to prevent excessive memory/network usage
                const payloadStr = JSON.stringify(payload);
                if (payloadStr.length > 10000) { // 10KB limit
                    console.warn("[routing] External router payload too large, skipping");
                } else {
                const res = await fetch(externalUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: payloadStr,
                    signal: AbortSignal.timeout(3000)
                });
                if (res.ok) {
                    const data = await res.json();
                    const suggested = Array.isArray(data.suggestedModelIds) ? data.suggestedModelIds : [];
                    if (suggested.length > 0) {
                        const toClientId = (r) => `${PROVIDER_ID_TO_ALIAS[r.provider] || r.provider}/${r.model}`;
                        const key = (r) => `${r.connection?.id}:${r.provider}:${r.model}`;
                        const byClientId = new Map();
                        for (const r of results) byClientId.set(toClientId(r), r);
                        const ordered = [];
                        const seen = new Set();
                        for (const id of suggested) {
                            const c = byClientId.get(id);
                            if (c && !seen.has(key(c))) { ordered.push(c); seen.add(key(c)); }
                        }
                        for (const r of results) if (!seen.has(key(r))) ordered.push(r);
                        if (ordered.length === results.length) results = ordered;
                    }
                }
                }
            } catch (_) { /* non-fatal */ }
        }

        // Optional: append free-tier candidates as last resort when preferFreeOnRateLimit is on
        if (settings?.preferFreeOnRateLimit) {
            const freeProviderIds = new Set([
                ...Object.keys(FREE_PROVIDERS || {}),
                ...Object.keys(APIKEY_PROVIDERS || {}).filter((id) => APIKEY_PROVIDERS[id]?.freeTier)
            ]);
            const seenKey = (c) => `${c.connection?.id}:${c.provider}:${c.model}`;
            const existingKeys = new Set(results.map(seenKey));
            for (const providerId of freeProviderIds) {
                const connections = await getProviderConnections({ provider: providerId, isActive: true, isEnabled: true });
                const models = getModelsByProviderId(providerId) || [];
                for (const conn of connections) {
                    for (const m of models) {
                        const modelId = typeof m === "string" ? m : m?.id;
                        if (!modelId) continue;
                        const cand = { connection: conn, provider: providerId, model: modelId, score: 0, reasons: [] };
                        if (existingKeys.has(seenKey(cand))) continue;
                        const cooldownUntil = conn.rateLimitedUntil ? new Date(conn.rateLimitedUntil).getTime() : 0;
                        if (cooldownUntil && cooldownUntil > Date.now()) continue;
                        const limitCheck = await this.rateLimiter.checkLimit(providerId, modelId, { estimatedTokens: requestContext.estimatedTokens || 100 });
                        if (!limitCheck.allowed) continue;
                        cand.rateLimitResetAt = limitCheck.resetTime ? new Date(limitCheck.resetTime).toISOString() : null;
                        results.push(cand);
                        existingKeys.add(seenKey(cand));
                    }
                }
            }
        }

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
                else                 if (pb.trigger.type === "group") {
                    if (context.userGroup === pb.trigger.value) return pb;
                }
                else if (pb.trigger.type === "pool") {
                    if (context.poolId === pb.trigger.value || context.pool === pb.trigger.value) return pb;
                }
                else if (pb.trigger.type === "client") {
                    if (context.clientId && context.clientId === pb.trigger.value) return pb;
                }
                else if (pb.trigger.type === "device") {
                    if (context.deviceId && context.deviceId === pb.trigger.value) return pb;
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
        const LOCAL_PROVIDERS = ["ollama", "lmstudio", "lm_studio", "llamacpp", "llama.cpp", "local"];
        const isLocal = (p) => LOCAL_PROVIDERS.includes(String(p).toLowerCase());
        const preferLocal = context.preferLocalForSimpleTasks && (context.intent === "generic" || !context.intent);

        for (const cand of candidates) {
            const groupScore = GROUP_PRIORITY[cand.connection.group || "default"] || 99;
            const priority = cand.connection.priority || 999;

            // Fetch from Model Registry
            const registryModel = await getRegistryModel(cand.provider, cand.model);
            const inputPrice = registryModel?.inputPrice || 0;
            const outputPrice = registryModel?.outputPrice || 0;
            const avgLatency = registryModel?.avgLatency || 0;

            const costScore = (inputPrice || 0) + (outputPrice || 0);

            // Trust score: when peer_id/meshPeerId exists, factor in (higher trust = better)
            let trustBonus = 0;
            const peerId = cand.connection.peer_id ?? cand.connection.meshPeerId;
            if (peerId) {
                const trust = await getTrustScore(peerId);
                // Use smaller multiplier (10 instead of 100) to prevent trust from overwhelming other factors
                if (trust != null) trustBonus = trust * 10; // Higher trust lowers effective score
            }

            // Prefer local for simple/generic tasks when enabled
            let localBoost = 0;
            if (preferLocal && isLocal(cand.provider)) {
                localBoost = 3000000; // Strong preference for local
            }

            // Prefer vision-capable models when request contains images
            let visionBoost = 0;
            if (context.hasImage && isVisionCapable(cand.model)) {
                visionBoost = 2000000;
            }

            // Base score favors: Group > Manual Priority > Low Cost > Low Latency; trust reduces score
            const finalScore = (groupScore * 1000000) + (priority * 10000) + (costScore * 100) + (avgLatency / 100) - trustBonus - localBoost - visionBoost;

            scored.push({
                ...cand,
                score: Math.max(0, finalScore),
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
                // value is max allowed cost per 1k (input+output); cost stored as $/1M
                const maxPer1M = (rule.value || Infinity) * 1000;
                const keep = [];
                for (const c of filtered) {
                    const registryModel = await getRegistryModel(c.provider, c.model);
                    const costPer1M = (registryModel?.inputPrice || 0) + (registryModel?.outputPrice || 0);
                    if (costPer1M <= maxPer1M) keep.push(c);
                }
                filtered = keep;
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
     * Apply routing filters to candidates
     * Filters candidates based on trust score, IP, country, cost, and latency rules
     * @param {Array} candidates - Candidate providers
     * @returns {Promise<Array>} Filtered candidates
     */
    async applyRoutingFilters(candidates) {
        // Load active filters and controls
        const [filters, controls] = await Promise.all([
            getRoutingFilters(true),
            getRoutingControls()
        ]);

        if (!filters?.length && !controls?.minTrustScore && !controls?.maxCostPer1k && !controls?.maxLatencyMs) {
            return candidates; // No filters active
        }

        // Batch fetch all peer metadata and trust scores upfront to avoid N+1 queries
        const peerIds = [...new Set(candidates
            .map(c => c.connection?.peer_id ?? c.connection?.meshPeerId)
            .filter(Boolean))];

        const [metadataMap, trustScoresMap] = await Promise.all([
            getPeerMetadataBatch(peerIds),
            this.fetchTrustScoresBatch(peerIds)
        ]);

        // Pre-fetch registry models for unique provider/model combinations
        const registryModelCache = new Map();
        const getCachedRegistryModel = async (provider, model) => {
            const key = `${provider}:${model}`;
            if (!registryModelCache.has(key)) {
                registryModelCache.set(key, await getRegistryModel(provider, model));
            }
            return registryModelCache.get(key);
        };

        const filtered = [];

        // Sort filters once before the loop (O(m log m) instead of O(n*m log m))
        const sortedFilters = [...filters].sort((a, b) => a.priority - b.priority);

        for (const cand of candidates) {
            const peerId = cand.connection?.peer_id ?? cand.connection?.meshPeerId;
            const metadata = peerId ? metadataMap.get(peerId) ?? null : null;
            const trustScore = peerId ? trustScoresMap.get(peerId) ?? null : null;

            // Check global controls first
            if (controls?.minTrustScore != null && trustScore != null) {
                if (trustScore < controls.minTrustScore) {
                    cand.reasons.push(`filter:trust_score_below_${controls.minTrustScore}`);
                    continue;
                }
            }

            // Check cost against global max
            if (controls?.maxCostPer1k != null) {
                const registryModel = await getCachedRegistryModel(cand.provider, cand.model);
                const costPer1M = (registryModel?.inputPrice || 0) + (registryModel?.outputPrice || 0);
                if (costPer1M > controls.maxCostPer1k * 1000) {
                    cand.reasons.push(`filter:cost_above_${controls.maxCostPer1k}`);
                    continue;
                }
            }

            // Check latency against global max
            if (controls?.maxLatencyMs != null) {
                const registryModel = await getCachedRegistryModel(cand.provider, cand.model);
                const latency = registryModel?.avgLatency || metadata?.avgLatency;
                if (latency !== undefined && latency > controls.maxLatencyMs) {
                    cand.reasons.push(`filter:latency_above_${controls.maxLatencyMs}`);
                    continue;
                }
            }

            // Check country restrictions
            const countryCode = metadata?.countryCode;
            if (countryCode) {
                if (controls?.allowedCountries?.length > 0 && !controls.allowedCountries.includes(countryCode)) {
                    cand.reasons.push(`filter:country_not_allowed`);
                    continue;
                }
                if (controls?.blockedCountries?.length > 0 && controls.blockedCountries.includes(countryCode)) {
                    cand.reasons.push(`filter:country_blocked`);
                    continue;
                }
            }

            // Check IP range restrictions
            const ipAddress = metadata?.ipAddress;
            if (ipAddress && (controls?.allowedIpRanges?.length > 0 || controls?.blockedIpRanges?.length > 0)) {
                // Check blocked ranges
                if (controls?.blockedIpRanges?.length > 0) {
                    const isBlocked = controls.blockedIpRanges.some(cidr => this.ipInCidr(ipAddress, cidr));
                    if (isBlocked) {
                        cand.reasons.push(`filter:ip_blocked`);
                        continue;
                    }
                }

                // Check allowed ranges (must match at least one if specified)
                if (controls?.allowedIpRanges?.length > 0) {
                    const isAllowed = controls.allowedIpRanges.some(cidr => this.ipInCidr(ipAddress, cidr));
                    if (!isAllowed) {
                        cand.reasons.push(`filter:ip_not_allowed`);
                        continue;
                    }
                }
            }

            // Evaluate individual filter rules (using pre-sorted filters)
            let blockedByFilter = null;

            for (const filter of sortedFilters) {
                const matches = this.evaluateFilter(cand, filter, { trustScore, countryCode, ipAddress, metadata });

                if (matches) {
                    if (filter.action === "block") {
                        blockedByFilter = filter.name;
                        cand.reasons.push(`filter:blocked_by_${filter.name}`);
                        break;
                    } else if (filter.action === "allow") {
                        // Explicit allow - stop processing further filters for this candidate
                        blockedByFilter = null;
                        break;
                    }
                }
            }

            if (blockedByFilter) {
                continue;
            }

            filtered.push(cand);
        }

        return filtered;
    }

    /**
     * Fetch trust scores for multiple peers in parallel
     * @param {string[]} peerIds - Array of peer IDs
     * @returns {Promise<Map<string, number>>} Map of peerId to trust score
     */
    async fetchTrustScoresBatch(peerIds) {
        const trustScores = new Map();
        if (!peerIds?.length) return trustScores;

        // Fetch all trust scores in parallel
        const results = await Promise.all(
            peerIds.map(async (peerId) => ({
                peerId,
                score: await getTrustScore(peerId)
            }))
        );

        for (const { peerId, score } of results) {
            trustScores.set(peerId, score);
        }

        return trustScores;
    }

    /**
     * Evaluate if a candidate matches a single filter
     */
    evaluateFilter(cand, filter, context) {
        const { trustScore, countryCode, ipAddress, metadata } = context;
        let value;

        switch (filter.filter_type) {
            case "trust_score":
                value = trustScore;
                break;
            case "ip_address":
                value = ipAddress;
                break;
            case "country":
                value = countryCode;
                break;
            case "cost": {
                // Cost per 1k tokens
                const inputPrice = cand.connection?.inputPrice || metadata?.inputPrice || 0;
                const outputPrice = cand.connection?.outputPrice || metadata?.outputPrice || 0;
                value = (inputPrice || 0) + (outputPrice || 0);
                break;
            }
            case "latency": {
                value = cand.connection?.avgLatency || metadata?.avgLatency;
                break;
            }
            default:
                return false;
        }

        if (value === undefined || value === null) {
            return false;
        }

        const filterValue = filter.value;

        switch (filter.operator) {
            case "eq":
                return value === filterValue;
            case "gte":
                return value >= filterValue;
            case "lte":
                return value <= filterValue;
            case "in_range":
                return Array.isArray(filterValue) &&
                       filterValue.length === 2 &&
                       value >= filterValue[0] &&
                       value <= filterValue[1];
            case "in_list":
                return Array.isArray(filterValue) && filterValue.includes(value);
            case "not_in_list":
                return Array.isArray(filterValue) && !filterValue.includes(value);
            default:
                return false;
        }
    }

    /**
     * Check if an IP address is within a CIDR range
     * Supports IPv4 and IPv6 CIDR notation
     */
    ipInCidr(ip, cidr) {
        try {
            const [rangeIp, prefix] = cidr.split("/");
            const prefixLength = parseInt(prefix, 10);

            if (!rangeIp || isNaN(prefixLength)) {
                return false;
            }

            // Check if this is IPv6
            if (ip.includes(":") || rangeIp.includes(":")) {
                // IPv6 support - basic validation only
                // Note: Full IPv6 CIDR matching is complex and requires BigInt
                // For now, we'll do simple prefix matching for IPv6
                console.warn(`[routing] IPv6 CIDR matching not fully implemented: ${ip}/${cidr}`);
                return false;
            }

            // IPv4 validation
            const ipParts = ip.split(".").map(Number);
            const rangeParts = rangeIp.split(".").map(Number);

            if (ipParts.length !== 4 || rangeParts.length !== 4) {
                return false;
            }

            // Convert to 32-bit unsigned integers using multiplication to avoid bitwise overflow
            // JavaScript bitwise operators convert to 32-bit SIGNED integers, causing issues
            // for IP addresses where the first octet >= 128 (values > 0x7FFFFFFF)
            const ipInt = (ipParts[0] * 16777216) + (ipParts[1] * 65536) + (ipParts[2] * 256) + ipParts[3];
            const rangeInt = (rangeParts[0] * 16777216) + (rangeParts[1] * 65536) + (rangeParts[2] * 256) + rangeParts[3];

            // Create mask using multiplication to avoid bitwise overflow
            // For /24 prefix: mask = 0xFFFFFFFF << 8 = 0xFFFFFF00
            const mask = Math.pow(2, 32) - Math.pow(2, 32 - prefixLength);

            // Use unsigned right shift (>>> 0) to convert back to unsigned 32-bit
            // This fixes issues with IPs where first octet >= 128
            const ipMasked = (ipInt & mask) >>> 0;
            const rangeMasked = (rangeInt & mask) >>> 0;
            return ipMasked === rangeMasked;
        } catch {
            return false;
        }
    }

    /**
     * Record usage for a successful request
     */
    async recordUsage(provider, model, usage, headers) {
        return this.rateLimiter.recordUsage(provider, model, usage, headers);
    }
}
