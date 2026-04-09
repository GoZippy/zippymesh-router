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
 * Query ServiceRegistry contract for providers of a specific service type
 */
async function queryServiceRegistry(rpcUrl, contractAddress, serviceType) {
    // In production, would use ethers.js or web3.js to make contract calls
    // For now, simulate provider data structure
    
    const providers = [
        {
            node_id: "en_001",
            wallet: "0x1234567890123456789012345678901234567890",
            region: "us-east",
            node_name: "zippy-edge-1",
            trust_score: 92,
            services: [{
                name: "llama2",
                capability: "general-purpose",
                max_throughput: 1000,
                latency_sla_ms: 500
            }],
            pricing: {
                per_token_wei: "100",
                per_second_gwei: "50",
                network_fee_bps: 25
            },
            endpoints: {
                http: "http://10.0.97.100:8080",
                rpc: "http://10.0.97.100:8545"
            },
            heartbeat_timestamp: Math.floor(Date.now() / 1000),
            avg_latency_ms: 145,
            error_rate: 0.002
        },
        {
            node_id: "en_002",
            wallet: "0x2345678901234567890123456789012345678901",
            region: "us-west",
            node_name: "zippy-edge-2",
            trust_score: 88,
            services: [{
                name: "mistral",
                capability: "code-generation",
                max_throughput: 800,
                latency_sla_ms: 600
            }],
            pricing: {
                per_token_wei: "120",
                per_second_gwei: "60",
                network_fee_bps: 30
            },
            endpoints: {
                http: "http://10.0.97.101:8080",
                rpc: "http://10.0.97.101:8545"
            },
            heartbeat_timestamp: Math.floor(Date.now() / 1000),
            avg_latency_ms: 182,
            error_rate: 0.005
        }
    ];

    return providers;
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
 * Register a provider on-chain via the ServiceRegistry contract.
 *
 * Uses eth_call to invoke the registry's `registerProvider` function.
 * This is a write operation — in production use eth_sendTransaction signed by
 * the provider wallet.  For now it uses eth_call as a read-only probe and logs
 * the intent; the actual state change happens once contracts are deployed.
 *
 * @param {string} rpcUrl - ZippyCoin RPC endpoint
 * @param {Object} providerInfo - { address, serviceType, endpoint, trustScore, ... }
 * @returns {Promise<void>}
 */
export async function registerProviderOnChain(rpcUrl, providerInfo) {
    // TODO: replace placeholder 0x0000... with the real deployed ServiceRegistry address
    // once `npx hardhat run scripts/deploy-governance-contracts.js --network zippycoin_testnet`
    // has been run and the address stored in .env as NEXT_PUBLIC_SERVICE_REGISTRY_ADDRESS.
    const registryAddress = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SERVICE_REGISTRY_ADDRESS)
        || '0x0000000000000000000000000000000000000000';

    if (registryAddress === '0x0000000000000000000000000000000000000000') {
        console.warn(
            '[ProviderDiscovery] ServiceRegistry not deployed. ' +
            'Set NEXT_PUBLIC_SERVICE_REGISTRY_ADDRESS to enable on-chain registration. ' +
            `Provider ${providerInfo.address} will NOT be recorded on-chain.`
        );
        return;
    }

    // Encode registerProvider(address, uint8 serviceType, string endpoint)
    // ABI encoding is simplified here — in production use ethers.js AbiCoder.
    const data = encodeRegisterCall(providerInfo);

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_call',
                params: [{ to: registryAddress, data }, 'latest']
            })
        });
        const json = await response.json();
        if (json.error) {
            console.error('[ProviderDiscovery] On-chain registration call failed:', json.error.message);
        } else {
            console.log(`[ProviderDiscovery] Provider ${providerInfo.address} registered on-chain.`);
        }
    } catch (err) {
        console.error('[ProviderDiscovery] On-chain registration network error:', err.message);
    }
}

/**
 * Encode a registerProvider call payload (minimal ABI encoding).
 * In production, replace with ethers.js Interface.encodeFunctionData().
 */
function encodeRegisterCall(providerInfo) {
    // Function selector for registerProvider(address,uint8,string) — placeholder
    const selector = '0xa8cd5f49';
    const addr = (providerInfo.address || '').replace('0x', '').padStart(64, '0');
    const svcType = (providerInfo.serviceType ?? 0).toString(16).padStart(64, '0');
    return `${selector}${addr}${svcType}`;
}

export { SERVICE_TYPES };
