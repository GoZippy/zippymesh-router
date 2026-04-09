/**
 * API route: /api/mesh/providers
 * Handles provider discovery and selection
 */

import {
    discoverProviders,
    selectProvider,
    getProviderEndpoint,
    estimateCost,
    clearProviderCache
} from '@/lib/provider-discovery';

export async function GET(request) {
    try {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');
        const modelName = url.searchParams.get('model') || 'llama2';
        const maxLatency = parseInt(url.searchParams.get('maxLatency')) || 1000;
        const minTrust = parseInt(url.searchParams.get('minTrust')) || 70;
        const region = url.searchParams.get('region');

        const rpcUrl = process.env.NEXT_PUBLIC_ZIPPYCOIN_RPC_URL || 'http://10.0.97.100:8545';
        const contractAddress = process.env.SERVICE_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000';

        switch (action) {
            case 'discover':
                return handleDiscover(rpcUrl, contractAddress);
            
            case 'select':
                return handleSelect(rpcUrl, contractAddress, {
                    modelName,
                    maxLatencyMs: maxLatency,
                    minTrustScore: minTrust,
                    preferredRegion: region
                });
            
            case 'get-endpoint':
                return handleGetEndpoint(rpcUrl, contractAddress, url.searchParams.get('providerId'));
            
            case 'estimate-cost':
                const tokens = parseInt(url.searchParams.get('tokens')) || 100;
                return handleEstimateCost(rpcUrl, contractAddress, url.searchParams.get('providerId'), tokens);
            
            case 'clear-cache':
                return handleClearCache();
            
            default:
                return handleList(rpcUrl, contractAddress);
        }
    } catch (error) {
        console.error("[Providers API] Error:", error);
        return new Response(JSON.stringify({
            error: error.message,
            code: 'DISCOVERY_ERROR'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handleDiscover(rpcUrl, contractAddress) {
    const providers = await discoverProviders(rpcUrl, contractAddress);
    
    return new Response(JSON.stringify({
        success: true,
        providers: providers.map(p => ({
            nodeId: p.node_id,
            region: p.region,
            nodeName: p.node_name,
            trustScore: p.trust_score,
            rank: p.rank,
            models: p.services.map(s => s.name),
            avgLatency: p.avg_latency_ms,
            errorRate: p.error_rate
        })),
        totalProviders: providers.length
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleSelect(rpcUrl, contractAddress, requirements) {
    try {
        const providers = await discoverProviders(rpcUrl, contractAddress);
        const selected = selectProvider(providers, requirements);

        return new Response(JSON.stringify({
            success: true,
            provider: {
                nodeId: selected.node_id,
                region: selected.region,
                nodeName: selected.node_name,
                trustScore: selected.trust_score,
                models: selected.services.map(s => s.name),
                endpoint: selected.endpoints.http,
                rpcEndpoint: selected.endpoints.rpc
            },
            reason: `Selected provider ${selected.node_id} with trust score ${selected.trust_score}`
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: error.message
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handleList(rpcUrl, contractAddress) {
    const providers = await discoverProviders(rpcUrl, contractAddress);
    
    return new Response(JSON.stringify({
        success: true,
        providers: providers.map((p, idx) => ({
            id: idx,
            nodeId: p.node_id,
            region: p.region,
            models: p.services.map(s => ({
                name: s.name,
                capability: s.capability,
                maxTokens: s.max_throughput
            })),
            trustScore: p.trust_score,
            latency: p.avg_latency_ms,
            pricing: {
                perToken: p.pricing.per_token_wei,
                perSecond: p.pricing.per_second_gwei,
                networkFeeBps: p.pricing.network_fee_bps
            },
            endpoint: p.endpoints.http
        })),
        timestamp: new Date().toISOString()
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleGetEndpoint(rpcUrl, contractAddress, providerId) {
    const providers = await discoverProviders(rpcUrl, contractAddress);
    const provider = providers[parseInt(providerId)];

    if (!provider) {
        return new Response(JSON.stringify({
            error: 'Provider not found'
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const endpoint = getProviderEndpoint(provider);
    return new Response(JSON.stringify({
        success: true,
        endpoint
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleEstimateCost(rpcUrl, contractAddress, providerId, tokens) {
    const providers = await discoverProviders(rpcUrl, contractAddress);
    const provider = providers[parseInt(providerId)];

    if (!provider) {
        return new Response(JSON.stringify({
            error: 'Provider not found'
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const cost = estimateCost(provider, tokens);
    return new Response(JSON.stringify({
        success: true,
        provider: provider.node_id,
        estimatedTokens: tokens,
        cost
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleClearCache() {
    clearProviderCache();
    return new Response(JSON.stringify({
        success: true,
        message: 'Provider cache cleared'
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
