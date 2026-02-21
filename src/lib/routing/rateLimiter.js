
import { getRateLimitConfigs, updateRateLimitConfig, getRateLimitState, saveRateLimitState } from "../localDb.js";

/**
 * Rate Limiter Engine
 * Handles Token Bucket, Fixed Window, and Rolling Window limits.
 * Persists state to localDb.
 */
export class RateLimiter {
    constructor() {
        this.memoryStore = {
            // Key: "provider:bucketName:model" -> { count: number, resetTime: number, ... }
            windows: {},
        };
        this.configs = null;
        this.isDirty = false;

        // Auto-save interval (e.g. every 10 seconds if dirty)
        // In a real serverless env (Workers), this might need different handling (KV).
        // For Node/Local, this is fine.
        if (typeof setInterval !== 'undefined') {
            setInterval(() => this.persistState(), 10000);
        }
    }

    /**
     * Initialize or reload configs and state
     */
    async init() {
        this.configs = await getRateLimitConfigs();
        const savedState = await getRateLimitState();
        if (savedState && savedState.windows) {
            this.memoryStore = savedState;
        }
    }

    async persistState() {
        if (this.isDirty) {
            await saveRateLimitState(this.memoryStore);
            this.isDirty = false;
        }
    }

    /**
     * Check if a request is allowed
     * @param {string} provider
     * @param {string} model
     * @param {object} context (e.g. { estimatedTokens: 100 })
     * @returns {Promise<{ allowed: boolean, reason?: string, resetTime?: number, remaining?: number }>}
     */
    async checkLimit(provider, model, context = {}) {
        if (!this.configs) await this.init();

        const config = this.configs[provider];

        // If no config found for provider, assume allowed (or check defaults)
        if (!config || !config.buckets) {
            return { allowed: true };
        }

        const now = Date.now();
        const estimatedTokens = context.estimatedTokens || 100; // Default estimate if unknown

        for (const bucket of config.buckets) {
            // 1. Is this bucket applicable to this model?
            if (!this.isApplicable(bucket, model)) continue;

            // 2. Identify storage key
            const key = this.getBucketKey(provider, bucket.name, model);

            // 3. Get current usage state
            let state = this.memoryStore.windows[key];

            // 4. Evaluate specific logic based on window_type
            const result = this.evaluateBucket(bucket, state, now, estimatedTokens);

            if (!result.allowed) {
                return {
                    allowed: false,
                    reason: `Rate limit exceeded: ${bucket.name}`,
                    resetTime: result.resetTime,
                    remaining: result.remaining
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Record usage (increment counters)
     * @param {string} provider
     * @param {string} model
     * @param {object} usage { tokens: 100 }
     * @param {object} headers
     */
    async recordUsage(provider, model, usage = {}, headers = null) {
        if (!this.configs) await this.init();

        const config = this.configs[provider];
        if (!config || !config.buckets) return;

        const now = Date.now();
        const tokens = usage.tokens || 0;

        // Sync from headers if available
        let updatedKeys = new Set();
        if (headers) {
            updatedKeys = this.syncFromHeaders(provider, model, headers, config);
        }

        for (const bucket of config.buckets) {
            if (!this.isApplicable(bucket, model)) continue;

            const key = this.getBucketKey(provider, bucket.name, model);

            // If we synced this bucket from headers, don't increment locally
            if (updatedKeys.has(key)) continue;

            let state = this.memoryStore.windows[key];

            // Update state
            this.memoryStore.windows[key] = this.updateBucketState(bucket, state, now, 1, tokens);
            this.isDirty = true;
        }

        // Try to save immediately if critical? Or just wait for interval.
        // For accurate limits across restarts, interval is fine.
    }

    /**
     * Sync rate limit state from provider response headers
     * @returns {Set<string>} Set of keys that were updated
     */
    syncFromHeaders(provider, model, headers, config) {
        const updatedKeys = new Set();

        // Normalize headers to lowercase
        const normalizedHeaders = {};
        if (headers && typeof headers.forEach === "function") {
            headers.forEach((val, key) => normalizedHeaders[key.toLowerCase()] = val);
        } else if (headers) {
            for (const k in headers) normalizedHeaders[k.toLowerCase()] = headers[k];
        }

        // Generic X-RateLimit handling (Groq, GitHub, etc often follow this)
        // x-ratelimit-remaining-requests
        // x-ratelimit-reset-requests (seconds or timestamp)

        for (const bucket of config.buckets) {
            if (!this.isApplicable(bucket, model)) continue;

            let remainingHeader = null;
            let resetHeader = null;

            if (bucket.unit === "requests") {
                remainingHeader = normalizedHeaders["x-ratelimit-remaining-requests"] || normalizedHeaders["x-ratelimit-remaining"];
                resetHeader = normalizedHeaders["x-ratelimit-reset-requests"] || normalizedHeaders["x-ratelimit-reset"];
            } else if (bucket.unit === "tokens") {
                remainingHeader = normalizedHeaders["x-ratelimit-remaining-tokens"];
                resetHeader = normalizedHeaders["x-ratelimit-reset-tokens"];
            }

            if (remainingHeader !== undefined || resetHeader !== undefined) {
                const key = this.getBucketKey(provider, bucket.name, model);
                // Get existing state or init default
                let state = this.memoryStore.windows[key] || { count: 0, tokens: 0, startTime: Date.now(), resetTime: Date.now() + 86400000 };

                let didUpdate = false;

                if (resetHeader) {
                    // Check if it's seconds or timestamp
                    let resetVal = parseFloat(resetHeader);
                    const now = Date.now();
                    let newResetTime = now;

                    if (resetVal < 10000000) {
                        // Likely seconds (Groq uses seconds until reset)
                        newResetTime = now + (resetVal * 1000);
                    } else {
                        // Timestamp (ms or s?)
                        if (resetVal < 10000000000) resetVal *= 1000; // convert s to ms
                        newResetTime = resetVal;
                    }

                    state.resetTime = newResetTime;
                    didUpdate = true;
                }

                if (remainingHeader !== undefined && bucket.value_hint) {
                    const remaining = parseInt(remainingHeader, 10);
                    if (!isNaN(remaining)) {
                        if (bucket.unit === "requests") {
                            state.count = Math.max(0, bucket.value_hint - remaining);
                            didUpdate = true;
                        } else {
                            // For tokens, it's harder if limit is per minute vs per day.
                            // But assume generic behavior:
                            state.tokens = Math.max(0, bucket.value_hint - remaining);
                            didUpdate = true;
                        }
                    }
                }

                if (didUpdate) {
                    this.memoryStore.windows[key] = state;
                    updatedKeys.add(key);
                    this.isDirty = true;
                }
            }
        }
        return updatedKeys;
    }

    // ============ Internal Logic ============

    isApplicable(bucket, model) {
        if (!bucket.applies_to) return true;
        if (bucket.applies_to === "all") return true;
        if (bucket.applies_to === "per model" || bucket.applies_to === "per_model") return true;
        if (bucket.applies_to === "most models") return true;

        const applies = bucket.applies_to.split(",");
        return applies.some(a => {
            const trimmed = a.trim();
            return model === trimmed || model.includes(trimmed);
        });
    }

    getBucketKey(provider, bucketName, model) {
        // If bucket applies "per model", include model ID in key
        // Otherwise key is just provider+bucketName
        // We infer "per model" if the bucket definition suggests it (or generally for safety)
        // Most limits in the user's JSON are per-model or per-project.
        // Let's use user's explicit "applies_to" field or heuristic.

        // Simplification: assume most RPM/TPM are per-model unless clearly global
        return `${provider}:${bucketName}:${model}`;
    }

    evaluateBucket(bucket, state, now, costTokens) {
        // Default allow if state missing (first request in window)
        if (!state) return { allowed: true, remaining: 999999 };

        if (bucket.window_type === "fixed_reset") {
            // e.g. Daily quota resetting at 00:00 UTC
            // Check if we are in a new window
            if (state.resetTime && now >= state.resetTime) {
                // Reset happened
                return { allowed: true, remaining: bucket.value_hint || 999999 };
            }

            // Check consumption
            if (bucket.unit === "requests") {
                if (state.count >= (bucket.value_hint || 10000)) { // Fallback limit
                    return { allowed: false, resetTime: state.resetTime, remaining: 0 };
                }
            } else if (bucket.unit === "neurons" || bucket.unit === "tokens") {
                if (state.tokens >= (bucket.value_hint || 10000)) {
                    return { allowed: false, resetTime: state.resetTime, remaining: 0 };
                }
            }
        }
        else if (bucket.window_type === "rolling") {
            // Sliding window logic (simplified as fixed window of X seconds for MVP)
            // Check if window expired
            const windowMs = (bucket.window_seconds || 60) * 1000;
            if (now - state.startTime > windowMs) {
                return { allowed: true, remaining: bucket.value_hint || 999 };
            }

            if (bucket.unit === "requests") {
                if (state.count >= (bucket.value_hint || 60)) {
                    return { allowed: false, resetTime: state.startTime + windowMs, remaining: 0 };
                }
            }
        }

        return { allowed: true, remaining: 999 };
    }

    updateBucketState(bucket, state, now, reqCount, tokenCount) {
        const windowMs = (bucket.window_seconds || 60) * 1000;

        // Initialize if needed or reset if expired
        let newState = state;

        if (bucket.window_type === "fixed_reset") {
            // Complex timezone logic omitted for brevity; using simple 24h from first request
            // ideally we parse "00:00" and timezone.
            const resetTime = state?.resetTime || (now + 86400000);

            if (!state || now >= resetTime) {
                newState = { count: 0, tokens: 0, resetTime: now + 86400000, startTime: now };
            }
        } else {
            // Rolling / Simple Window
            if (!state || (now - state.startTime > windowMs)) {
                newState = { count: 0, tokens: 0, startTime: now, resetTime: now + windowMs };
            }
        }

        newState.count += reqCount;
        newState.tokens += tokenCount;

        return newState;
    }
}

