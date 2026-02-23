import { RoutingEngine } from "@/lib/routing/engine.js";
import { getEquivalentModels } from "../config/modelEquivalence";
import { updateProviderConnection, getP2pSubscriptions, getPricingForModel, getNodeIdentity } from "@/lib/localDb.js";
import { appendRequestLog } from "@/lib/usageDb.js";
import { signPayload, verifyPayload } from "@/lib/security.js";
import { calculateCostFromTokens } from "@/shared/constants/pricing.js";
import { errorResponse } from "open-sse/utils/error.js";
import { queueManager } from "@/lib/routing/queueManager.js"; // Added queueManager

// Instantiate RoutingEngine (Singleton-like)
const routingEngine = new RoutingEngine();

/**
 * Orchestrator Service
 * Handles cross-provider account selection and routing.
 */

/**
 * Find the best account across all equivalent models/providers
 * @param {string} requestedModel - The model string requested by user (e.g. "gpt-4")
 * @param {object} context - Additional context (userGroup, tokens, etc)
 * @returns {Promise<Object[]>} Sorted list of connection candidates
 */
export async function findBestCandidates(requestedModel, context = {}) {
    const equivalentModels = getEquivalentModels(requestedModel);

    // Use Routing Engine to find and rank candidates
    const routes = await routingEngine.findRoute({
        model: requestedModel,
        equivalentModels: equivalentModels,
        estimatedTokens: context.estimatedTokens || 100, // Default estimate
        userGroup: context.userGroup || "default"
    });

    // Map back to format expected by orchestrator loop
    return routes.map(route => ({
        ...route,
        modelInfo: { provider: route.provider, model: route.model }
    }));
}

/**
 * Orchestrate a chat request across multiple candidate accounts
 */
export async function handleOrchestratedChat(params) {
    const { body, modelStr, handleChatCore, log, clientRawRequest, userAgent } = params;

    // Wrap in Queue
    return await queueManager.enqueue(async () => {
        return await _executeOrchestratedChat(params);
    }, {
        group: params.user?.group || "default",
        intent: body.intent || params.intent || null
    });
}

/**
 * Internal execution after queueing
 */
async function _executeOrchestratedChat(params) {
    const { body, modelStr, handleChatCore, log, clientRawRequest, userAgent } = params;

    // Extract Context for Routing
    let estimatedTokens = 100;
    if (body.messages) {
        // Rough estimate: 1 char ~= 0.25 tokens
        const textContent = JSON.stringify(body.messages);
        estimatedTokens = Math.max(10, Math.ceil(textContent.length / 4));
    } else if (body.prompt) {
        estimatedTokens = Math.max(10, Math.ceil(typeof body.prompt === 'string' ? body.prompt.length / 4 : JSON.stringify(body.prompt).length / 4));
    }

    const routingContext = {
        estimatedTokens,
        intent: body.intent || params.intent || null,
        userGroup: params.user?.group || "default"
    };

    const candidates = await findBestCandidates(modelStr, routingContext);

    // Check for batch strategy in candidates' metadata if available
    // or if explicitly requested in body
    const batchRule = body.routing?.rule === "batch" ? body.routing :
        candidates.find(c => c.batchRule)?.batchRule;

    if (candidates.length === 0) {
        await appendRequestLog({ model: modelStr, status: 404 });
        return errorResponse(404, `No available accounts for ${modelStr} or equivalents`);
    }

    // Filter candidates by P2P Subscription if they are peer nodes
    const subscriptions = await getP2pSubscriptions();
    const authorizedCandidates = [];
    for (const cand of candidates) {
        if (cand.provider !== "peer") {
            authorizedCandidates.push(cand);
            continue;
        }
        const nodeId = cand.connection.providerSpecificData?.nodeId;
        const sub = subscriptions.find(s => s.offerId === nodeId && s.status === "active");
        if (!sub) continue;

        // Verify sub signature if it exists (Phase 12)
        if (sub.signature) {
            try {
                const identity = await getNodeIdentity();
                // We verify with OUR own public key because we signed it
                await verifyPayload(sub.signature, identity.publicKey);
                authorizedCandidates.push(cand);
            } catch (e) {
                log?.error?.("ORCHESTRATOR", `Subscription signature verification failed for node ${nodeId}`);
            }
        } else {
            authorizedCandidates.push(cand);
        }
    }

    if (authorizedCandidates.length === 0 && candidates.some(c => c.provider === "peer")) {
        return errorResponse(403, "Subscription required to access peer nodes. Visit the Marketplace.");
    }

    // Use authorized candidates if available, fallback to candidates (which might only have non-peer ones if any)
    const finalCandidates = authorizedCandidates.length > 0 ? authorizedCandidates : candidates;

    if (batchRule) {
        log?.info?.("ORCHESTRATOR", `Entering Batch Mode: Strategy=${batchRule.strategy || 'race'}, Parallel=${batchRule.parallel || 2}`);
        return await _executeBatchChat(params, finalCandidates, batchRule);
    }

    let lastError = null;
    let lastStatus = 503;

    for (const candidate of finalCandidates) {
        const { connection, modelInfo } = candidate;
        const accountId = connection.id.slice(0, 8);
        const startTime = Date.now();

        log?.info?.("ORCHESTRATOR", `Trying ${modelInfo.provider}/${modelInfo.model} via account ${accountId}... (Score: ${candidate.score})`);

        // Prepare body (e.g. apply context compression)
        let finalBody = { ...body, model: `${modelInfo.provider}/${modelInfo.model}` };
        if (params.prepareBody) {
            finalBody = params.prepareBody(finalBody, candidate);
        }

        // For peer nodes, add a signed identity header (Phase 12)
        let requestHeaders = {};
        if (modelInfo.provider === "peer") {
            const token = await signPayload({
                timestamp: Date.now(),
                targetNode: connection.id
            });
            requestHeaders["X-Zippy-Identity"] = token;
        }

        const result = await handleChatCore({
            body: finalBody,
            modelInfo,
            credentials: connection,
            log,
            clientRawRequest,
            connectionId: connection.id,
            userAgent,
            headers: requestHeaders, // Pass the signed identity header
            onCredentialsRefreshed: async (newCreds) => {
                if (params.callbacks?.onCredentialsRefreshed) {
                    await params.callbacks.onCredentialsRefreshed(newCreds, connection.id);
                }
            },
            onRequestSuccess: async () => {
                if (params.callbacks?.onRequestSuccess) {
                    await params.callbacks.onRequestSuccess(connection.id, connection);
                }
            }
        });

        if (result.success) {
            const latency = Date.now() - startTime;
            log?.info?.("ORCHESTRATOR", `Success via ${modelInfo.provider}/${modelInfo.model} in ${latency}ms`);

            // Update health metrics
            const tokens = result.usage?.total_tokens || 1;
            const tps = parseFloat((tokens / (latency / 1000)).toFixed(2));

            await updateProviderConnection(connection.id, {
                latency,
                tps,
                lastTested: new Date().toISOString()
            });

            // Track Usage in Rate Limiter
            await routingEngine.recordUsage(modelInfo.provider, modelInfo.model, result.usage || { tokens: 0 }, result.providerHeaders);

            await appendRequestLog({
                model: modelInfo.model,
                provider: modelInfo.provider,
                connectionId: connection.id,
                status: result.status || 200,
                tokens: result.usage,
                latency // Store latency in logs too
            });

            // P2P Billing Integration
            if (modelInfo.provider === "peer") {
                try {
                    const pricing = await getPricingForModel(modelInfo.provider, modelInfo.model);
                    if (pricing) {
                        const costDollars = calculateCostFromTokens(result.usage, pricing);
                        const amountZipc = Math.max(0.01, parseFloat((costDollars * 100).toFixed(4))); // 1c = 1 ZIPc, minimum 0.01

                        await recordP2pTransaction({
                            type: "spend",
                            amount: amountZipc,
                            offerId: connection.providerSpecificData?.nodeId,
                            model: modelInfo.model,
                            tokens: result.usage
                        });
                        log?.info?.("ORCHESTRATOR", `P2P Transaction Recorded: ${amountZipc} ZIPc spent`);
                    }
                } catch (billingErr) {
                    log?.error?.("ORCHESTRATOR", `P2P Billing failed: ${billingErr.message}`);
                }
            }

            return result;
        }

        // Handle failure
        if (params.callbacks?.onFailure) {
            await params.callbacks.onFailure(connection.id, result.status, result.error, modelInfo.provider);
        }

        log?.warn?.("ORCHESTRATOR", `Failover from account ${accountId}... status=${result.status}`);
        lastError = result.error;
        lastStatus = result.status;
    }

    await appendRequestLog({ model: modelStr, status: lastStatus });
    return errorResponse(lastStatus, lastError || "All candidates failed");
}

/**
 * Execute multiple candidates in parallel
 */
async function _executeBatchChat(params, candidates, batchRule) {
    const { handleChatCore, log, body, modelStr, clientRawRequest, userAgent } = params;
    const parallelLimit = batchRule.parallel || 2;
    const batchCandidates = candidates.slice(0, parallelLimit);

    const abortController = new AbortController();
    const startTime = Date.now();

    const tasks = batchCandidates.map(async (candidate) => {
        const { connection, modelInfo } = candidate;
        const accountId = connection.id.slice(0, 8);

        log?.info?.("ORCHESTRATOR", `[Batch] Starting ${modelInfo.provider}/${modelInfo.model} via ${accountId}`);

        try {
            let finalBody = { ...body, model: `${modelInfo.provider}/${modelInfo.model}` };
            if (params.prepareBody) {
                finalBody = params.prepareBody(finalBody, candidate);
            }

            // For peer nodes, add a signed identity header (Phase 12)
            let requestHeaders = {};
            if (modelInfo.provider === "peer") {
                const token = await signPayload({
                    timestamp: Date.now(),
                    targetNode: connection.id
                });
                requestHeaders["X-Zippy-Identity"] = token;
            }

            const result = await handleChatCore({
                body: finalBody,
                modelInfo,
                credentials: connection,
                log,
                clientRawRequest,
                connectionId: connection.id,
                userAgent,
                headers: requestHeaders, // Pass the signed identity header
                signal: abortController.signal, // Pass signal for cancellation
                onCredentialsRefreshed: async (newCreds) => {
                    if (params.callbacks?.onCredentialsRefreshed) {
                        await params.callbacks.onCredentialsRefreshed(newCreds, connection.id);
                    }
                },
                onRequestSuccess: async () => {
                    if (params.callbacks?.onRequestSuccess) {
                        await params.callbacks.onRequestSuccess(connection.id, connection);
                    }
                }
            });

            if (result.success) {
                const latency = Date.now() - startTime;
                log?.info?.("ORCHESTRATOR", `[Batch] Winner identified: ${modelInfo.provider}/${modelInfo.model} (${latency}ms)`);

                // Cancel other pending requests in the batch
                abortController.abort();

                // Record metrics (same as sequential)
                const tokens = result.usage?.total_tokens || 1;
                const tps = parseFloat((tokens / (latency / 1000)).toFixed(2));
                await updateProviderConnection(connection.id, { latency, tps, lastTested: new Date().toISOString() });
                await routingEngine.recordUsage(modelInfo.provider, modelInfo.model, result.usage || { tokens: 0 }, result.providerHeaders);
                await appendRequestLog({
                    model: modelInfo.model,
                    provider: modelInfo.provider,
                    connectionId: connection.id,
                    status: 200,
                    tokens: result.usage,
                    latency
                });

                // P2P Billing
                if (modelInfo.provider === "peer") {
                    try {
                        const pricing = await getPricingForModel(modelInfo.provider, modelInfo.model);
                        if (pricing) {
                            const costDollars = calculateCostFromTokens(result.usage, pricing);
                            const amountZipc = Math.max(0.01, parseFloat((costDollars * 100).toFixed(4)));
                            await recordP2pTransaction({
                                type: "spend",
                                amount: amountZipc,
                                offerId: connection.providerSpecificData?.nodeId,
                                model: modelInfo.model,
                                tokens: result.usage
                            });
                        }
                    } catch (e) { }
                }

                return result;
            } else {
                throw new Error(result.error || "Batch candidate failed");
            }
        } catch (err) {
            if (err.name === 'AbortError') return { aborted: true };
            log?.warn?.("ORCHESTRATOR", `[Batch] Candidate ${accountId} failed: ${err.message}`);
            throw err;
        }
    });

    try {
        // Promise.any returns the first fulfilled promise (success)
        return await Promise.any(tasks);
    } catch (aggregateError) {
        log?.error?.("ORCHESTRATOR", "All batch candidates failed");
        return errorResponse(503, "All batch candidates failed");
    }
}
