import { RoutingEngine } from "@/lib/routing/engine.js";
import { getEquivalentModels } from "../config/modelEquivalence";
import { appendRequestLog } from "@/lib/usageDb.js";
import { errorResponse } from "open-sse/utils/error.js"; // re-import errorResponse if needed or keep existing

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

    if (candidates.length === 0) {
        await appendRequestLog({ model: modelStr, status: 404 });
        return errorResponse(404, `No available accounts for ${modelStr} or equivalents`);
    }

    let lastError = null;
    let lastStatus = 503;

    for (const candidate of candidates) {
        const { connection, modelInfo } = candidate;
        const accountId = connection.id.slice(0, 8);

        log?.info?.("ORCHESTRATOR", `Trying ${modelInfo.provider}/${modelInfo.model} via account ${accountId}... (Score: ${candidate.score})`);

        // Prepare body (e.g. apply context compression)
        let finalBody = { ...body, model: `${modelInfo.provider}/${modelInfo.model}` };
        if (params.prepareBody) {
            finalBody = params.prepareBody(finalBody, candidate);
        }

        const result = await handleChatCore({
            body: finalBody,
            modelInfo,
            credentials: connection,
            log,
            clientRawRequest,
            connectionId: connection.id,
            userAgent,
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
            log?.info?.("ORCHESTRATOR", `Success via ${modelInfo.provider}/${modelInfo.model}`);

            // Track Usage in Rate Limiter
            // usage object should ideally contain { tokens: val, requests: 1 }
            // context can include headers for syncing
            await routingEngine.recordUsage(modelInfo.provider, modelInfo.model, result.usage || { tokens: 0 }, result.providerHeaders);

            await appendRequestLog({
                model: modelInfo.model,
                provider: modelInfo.provider,
                connectionId: connection.id,
                status: result.status || 200,
                tokens: result.usage // Assuming handleChatCore returns usage in result
            });
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
