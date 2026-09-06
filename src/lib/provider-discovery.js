/**
 * Provider Discovery Module
 * Queries ServiceRegistry contract and maintains local provider cache.
 *
 * On-chain registration requires a deployed ServiceRegistry contract.
 * Set NEXT_PUBLIC_SERVICE_REGISTRY_ADDRESS to the deployed contract address.
 * Until governance contracts are deployed, registration calls are no-ops with a
 * warning log.
 */

const SERVICE_REGISTRY_ABI = [
    {
        "name": "get_providers_by_service",
        "inputs": [{ "name": "service_type", "type": "uint8" }],
        "outputs": [{ "name": "", "type": "tuple[]" }]
    },
    {
        "name": "get_provider",
        "inputs": [{ "name": "provider_address", "type": "address" }],
        "outputs": [{ "name": "", "type": "tuple" }]
    },
    {
        "name": "submit_heartbeat",
        "inputs": [
            { "name": "service_index", "type": "uint32" },
            { "name": "requests_processed", "type": "uint64" },
            { "name": "avg_latency_ms", "type": "uint64" },
            { "name": "error_count", "type": "uint64" }
        ]
    }
];

const SERVICE_TYPES = {
    LLM: 0,
    STORAGE: 1,
    COMPUTE: 2,
    VPN: 3,
    BRIDGE: 4
};

// In-memory provider cache
let providerCache = {
    providers: [],
    lastUpdated: 0,
    ttlMs: 60000 // 60 second TTL
};

/**
 * Discover available LLM providers from ServiceRegistry contract
 * @param {string} rpcUrl - The ZippyCoin RPC endpoint
 * @param {string} contractAddress - The ServiceRegistry contract address
 * @returns {Promise<Array>} List of available providers
 */
export async function discoverProviders(rpcUrl, contractAddress) {
    try {
        // Check cache first
        const now = Date.now();
        if (providerCache.lastUpdated && (now - providerCache.lastUpdated) < providerCache.ttlMs) {
            return providerCache.providers;
        }

        // Query contract for LLM providers
        const providers = await queryServiceRegistry(rpcUrl, contractAddress, SERVICE_TYPES.LLM);
        
        // Sort by trust score (descending) and latency (ascending)
        const sortedProviders = providers
            .sort((a, b) => {
                if (b.trust_score !== a.trust_score) {
                    return b.trust_score - a.trust_score;
                }
                return a.avg_latency_ms - b.avg_latency_ms;
            })
            .map((p, idx) => ({
                ...p,
                rank: idx + 1
            }));

        // Update cache
        providerCache = {
            providers: sortedProviders,
            lastUpdated: now,
            ttlMs: providerCache.ttlMs
        };

        console.log(`[Discovery] Found ${sortedProviders.length} LLM providers`);
        return sortedProviders;
    } catch (error) {
        console.error("[Discovery] Failed to discover providers:", error);
        // Return cached providers if query fails
        if (providerCache.providers.length > 0) {
            console.warn("[Discovery] Using cached providers");
            return providerCache.providers;
        }
        throw error;
    }
}

/**
 * Query the ZippyCoin node's on-chain provider registry for LLM providers.
 *
 * Calls the native `zippycoin_getProviders` RPC (no contract/ABI needed) and
 * maps each on-chain provider record into the shape the rest of this module
 * expects. Returns `[]` on empty/failure so callers surface "no providers"
 * rather than routing real inference to a fabricated endpoint.
 *
 * On-chain record: { address(zpc1), endpoint, service_type, model,
 *   rate_zat_per_token, active, registered_at, last_heartbeat }.
 */
async function queryServiceRegistry(rpcUrl, contractAddress, serviceType) {
    // Only the LLM service maps to on-chain "llm_inference" providers.
    if (serviceType !== SERVICE_TYPES.LLM) {
        return [];
    }
    let records = [];
    try {
        const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'zippycoin_getProviders',
                params: [{ service_type: 'llm_inference' }],
            }),
            signal: AbortSignal.timeout(5000),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error.message || 'RPC error');
        records = json.result?.providers ?? [];
    } catch (err) {
        console.warn('[Discovery] zippycoin_getProviders failed:', err.message);
        return [];
    }

    // Map on-chain records → internal provider shape. rate_zat_per_token is the
    // smallest-unit (ZAT) price per token, which is exactly what estimateCost
    // treats `per_token_wei` as (1 ZIP = 1e18 ZAT), so the ZIP cost comes out
    // correct without a conversion.
    return records
        .filter((p) => p.active !== false && p.address)
        .map((p) => ({
            node_id: p.address.slice(0, 12),
            address: p.address,      // zpc1 — used for on-chain settlement
            wallet: p.address,
            region: p.region || '',
            node_name: p.model ? `${p.model}@${p.address.slice(0, 8)}` : p.address.slice(0, 8),
            trust_score: typeof p.trust_score === 'number' ? p.trust_score : 80,
            services: [{
                name: p.model || 'llama2',
                capability: p.service_type || 'llm_inference',
                max_throughput: 0,
                latency_sla_ms: 1000,
            }],
            pricing: {
                per_token_wei: String(p.rate_zat_per_token ?? 1000),
                per_second_gwei: '0',
                network_fee_bps: 0,
            },
            endpoints: {
                http: p.endpoint || '',
                rpc: '',
            },
            heartbeat_timestamp: p.last_heartbeat || 0,
            avg_latency_ms: 0,
            error_rate: 0,
        }));
}

/**
 * Find best provider for inference request
 * @param {Array} providers - List of available providers
 * @param {Object} requirements - Inference requirements
 * @returns {Object} Selected provider
 */
export function selectProvider(providers, requirements = {}) {
    if (!providers || providers.length === 0) {
        throw new Error("No providers available");
    }

    const {
        modelName = "llama2",
        maxLatencyMs = 1000,
        minTrustScore = 70,
        preferredRegion = null
    } = requirements;

    // Filter providers by requirements
    const qualified = providers.filter(p => {
        // Check minimum trust score
        if (p.trust_score < minTrustScore) return false;

        // Check latency SLA
        const modelService = p.services.find(s => s.name.includes(modelName));
        if (!modelService || modelService.latency_sla_ms > maxLatencyMs) return false;

        // Check region if specified
        if (preferredRegion && p.region !== preferredRegion) return false;

        return true;
    });

    if (qualified.length === 0) {
        // Fall back to best available provider
        console.warn("[Discovery] No qualified providers, using best available");
        return providers[0];
    }

    // Return provider with highest trust score (already sorted)
    return qualified[0];
}

/**
 * Get provider endpoint for inference
 */
export function getProviderEndpoint(provider) {
    return {
        http: provider.endpoints.http,
        rpc: provider.endpoints.rpc,
        nodeId: provider.node_id,
        wallet: provider.wallet
    };
}

/**
 * Estimate cost for inference request
 */
export function estimateCost(provider, estimatedTokens) {
    const {
        per_token_wei,
        per_second_gwei,
        network_fee_bps
    } = provider.pricing;

    const tokenCost = BigInt(per_token_wei) * BigInt(estimatedTokens);
    const networkFee = (tokenCost * BigInt(network_fee_bps)) / BigInt(10000);
    const totalCost = tokenCost + networkFee;

    return {
        tokenCostWei: tokenCost.toString(),
        networkFeeWei: networkFee.toString(),
        totalCostWei: totalCost.toString(),
        totalCostZip: (Number(totalCost) / 1e18).toFixed(6)
    };
}

/**
 * Clear provider cache
 */
export function clearProviderCache() {
    providerCache = {
        providers: [],
        lastUpdated: 0,
        ttlMs: providerCache.ttlMs
    };
}

/**
 * Register a provider on-chain via the native ZippyCoin RPC.
 *
 * @deprecated Current core requires a valid ML-DSA signature over
 * `zippy-op-v1|registerProvider|address|endpoint||nonce` (see core
 * `zippycoin_register_provider` → `authorize_op`). This unsigned JS call is
 * REJECTED by the node. Use the sidecar's signed `POST /provider/register`
 * instead (it holds the ML-DSA key). Retained only for reference.
 *
 * @param {string} rpcUrl - ZippyCoin RPC endpoint
 * @param {Object} providerInfo - { address, endpoint, model, rate_zat_per_token, ... }
 * @returns {Promise<void>}
 */
export async function registerProviderOnChain(rpcUrl, providerInfo) {
    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'zippycoin_registerProvider',
                params: [{
                    address: providerInfo.address,
                    endpoint: providerInfo.endpoint,
                    service_type: 'llm_inference',
                    model: providerInfo.model || '',
                    rate_zat_per_token: providerInfo.rate_zat_per_token ?? 1000,
                }]
            })
        });
        const json = await response.json();
        if (json.result?.error) {
            console.error('[ProviderDiscovery] On-chain registration failed:', json.result.error);
        } else {
            console.log(`[ProviderDiscovery] Provider ${providerInfo.address} registered on-chain.`);
        }
    } catch (err) {
        console.warn('[ProviderDiscovery] Registration failed:', err.message);
    }
}

export { SERVICE_TYPES };
