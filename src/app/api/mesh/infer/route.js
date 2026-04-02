/**
 * API route: /api/mesh/infer
 * Routes inference requests through selected edge node providers
 */

import { discoverProviders, selectProvider, estimateCost } from '@/lib/provider-discovery';
import { getCurrentWallet, getWalletBalance, createPaymentCommitment } from '@/lib/wallet-management';

export async function POST(request) {
    try {
        const body = await request.json();
        const {
            prompt,
            model = 'llama2',
            maxTokens = 256,
            temperature = 0.7,
            providerId = null,
            region = null
        } = body;

        if (!prompt) {
            return new Response(JSON.stringify({
                error: 'Prompt is required',
                code: 'MISSING_PROMPT'
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Get wallet and check balance
        const wallet = await getCurrentWallet();
        if (!wallet) {
            return new Response(JSON.stringify({
                error: 'No wallet found. Generate a wallet first.',
                code: 'NO_WALLET'
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const rpcUrl = process.env.NEXT_PUBLIC_ZIPPYCOIN_RPC_URL || 'http://10.0.97.100:8545';
        const contractAddress = process.env.SERVICE_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000';

        // Check wallet balance
        try {
            const balance = await getWalletBalance(rpcUrl, wallet.address);
            const balanceZip = parseFloat(balance.balanceZip);
            if (balanceZip < 0.001) {
                return new Response(JSON.stringify({
                    error: 'Insufficient balance for inference',
                    code: 'INSUFFICIENT_BALANCE',
                    balance: balance.balanceZip
                }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        } catch (error) {
            console.warn("[Infer] Could not check balance:", error);
            // Allow to proceed if balance check fails
        }

        // Discover providers
        const providers = await discoverProviders(rpcUrl, contractAddress);
        if (providers.length === 0) {
            return new Response(JSON.stringify({
                error: 'No providers available',
                code: 'NO_PROVIDERS'
            }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }

        // Select provider
        let selectedProvider;
        if (providerId !== null) {
            selectedProvider = providers[providerId];
            if (!selectedProvider) {
                return new Response(JSON.stringify({
                    error: 'Provider not found',
                    code: 'PROVIDER_NOT_FOUND'
                }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            }
        } else {
            selectedProvider = selectProvider(providers, {
                modelName: model,
                maxLatencyMs: 1000,
                minTrustScore: 70,
                preferredRegion: region
            });
        }

        // Estimate cost
        const estimatedTokens = Math.ceil(maxTokens * 1.1); // Add 10% overhead
        const cost = estimateCost(selectedProvider, estimatedTokens);

        console.log(`[Infer] Routing to ${selectedProvider.node_id}`, {
            model,
            promptLength: prompt.length,
            estimatedTokens,
            costZip: cost.totalCostZip
        });

        // Create payment commitment
        const paymentCommitment = createPaymentCommitment(selectedProvider, estimatedTokens, '0x' + '0'.repeat(64));

        // Route inference request to edge node
        const inferenceResponse = await routeInferenceRequest(selectedProvider, {
            prompt,
            model,
            maxTokens,
            temperature
        });

        return new Response(JSON.stringify({
            success: true,
            response: inferenceResponse.response,
            provider: {
                nodeId: selectedProvider.node_id,
                region: selectedProvider.region
            },
            usage: {
                promptTokens: prompt.split(/\s+/).length,
                completionTokens: inferenceResponse.response.split(/\s+/).length,
                totalTokens: estimatedTokens
            },
            cost: {
                charged: cost.totalCostZip,
                currency: 'ZIP'
            },
            metadata: {
                latency: inferenceResponse.latencyMs,
                model: model,
                timestamp: new Date().toISOString()
            }
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("[Infer] Error:", error);
        return new Response(JSON.stringify({
            error: error.message,
            code: 'INFERENCE_ERROR'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

/**
 * Route inference request to edge node provider
 */
async function routeInferenceRequest(provider, request) {
    try {
        const startTime = Date.now();
        
        const endpoint = `${provider.endpoints.http}/infer`;
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model,
                prompt: request.prompt,
                streams: false,
                temperature: request.temperature,
                max_tokens: request.maxTokens
            }),
            timeout: 30000
        });

        if (!response.ok) {
            throw new Error(`Provider returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const latencyMs = Date.now() - startTime;

        return {
            response: data.response || '',
            latencyMs,
            tokensGenerated: data.tokens_generated || 0
        };
    } catch (error) {
        console.error("[Infer] Failed to route to provider:", error);
        
        // Try fallback provider or fail gracefully
        throw new Error(`Inference failed: ${error.message}`);
    }
}

/**
 * Stream inference response
 */
export async function GET(request) {
    try {
        const url = new URL(request.url);
        const prompt = url.searchParams.get('prompt');
        const model = url.searchParams.get('model') || 'llama2';

        if (!prompt) {
            return new Response(JSON.stringify({
                error: 'Prompt parameter required'
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // For now, return regular response instead of streaming
        return new Response(JSON.stringify({
            message: 'Use POST for inference requests',
            example: {
                method: 'POST',
                endpoint: '/api/mesh/infer',
                body: {
                    prompt: 'Your prompt here',
                    model: 'llama2',
                    maxTokens: 256
                }
            }
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: error.message
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
