import { getProviderConnections, getPricing } from "@/lib/localDb";
import { getEquivalentModels } from "../config/modelEquivalence";
import { parseModel } from "open-sse/services/model";
import { filterAvailableAccounts } from "open-sse/services/accountFallback";
import { errorResponse } from "open-sse/utils/error.js";
import { appendRequestLog } from "@/lib/usageDb.js";

/**
 * Orchestrator Service
 * Handles cross-provider account selection and routing.
 */

/**
 * Find the best account across all equivalent models/providers
 * @param {string} requestedModel - The model string requested by user
 * @returns {Promise<Object[]>} Sorted list of connection candidates
 */
export async function findBestCandidates(requestedModel) {
    const equivalentModels = getEquivalentModels(requestedModel);
    const pricing = await getPricing();

    let allCandidates = [];

    for (const modelStr of equivalentModels) {
        const parsed = parseModel(modelStr);
        const providerId = parsed.provider;

        // Get all active connections for this provider
        const connections = await getProviderConnections({ provider: providerId, isActive: true });

        // Filter out currently rate-limited ones
        const availableConnections = filterAvailableAccounts(connections);

        for (const conn of availableConnections) {
            // Calculate a "Score" for sorting
            // 1. Group Priority (Personal > Work > Team > Default)
            const GROUP_PRIORITY = { personal: 10, work: 20, team: 30, default: 40 };
            const groupScore = GROUP_PRIORITY[conn.group || "default"] || 99;

            // 2. Base Priority (lower is better, default 999)
            const priority = conn.priority || 999;

            // 3. Cost (use pricing info if available)
            const modelShortName = parsed.model;
            const modelPricing = pricing[providerId]?.[modelShortName] || pricing[providerId]?.["default"] || { input: 0, output: 0 };
            const costScore = (modelPricing.input * 1000) + (modelPricing.output * 1000); // Simple per-1k cost heuristic

            allCandidates.push({
                connection: conn,
                modelInfo: { provider: providerId, model: modelShortName },
                score: (groupScore * 10000) + (priority * 10) + costScore, // Group is primary factor
                costPer1k: costScore
            });
        }
    }

    // Sort candidates by score (lowest first)
    return allCandidates.sort((a, b) => a.score - b.score);
}

/**
 * Orchestrate a chat request across multiple candidate accounts
 */
export async function handleOrchestratedChat(params) {
    const { body, modelStr, handleChatCore, log, clientRawRequest, userAgent } = params;

    const candidates = await findBestCandidates(modelStr);

    if (candidates.length === 0) {
        await appendRequestLog({ model: modelStr, status: 404 });
        return errorResponse(404, `No available accounts for ${modelStr} or equivalents`);
    }

    let lastError = null;
    let lastStatus = 503;

    for (const candidate of candidates) {
        const { connection, modelInfo } = candidate;
        const accountId = connection.id.slice(0, 8);

        log?.info?.("ORCHESTRATOR", `Trying ${modelInfo.provider}/${modelInfo.model} via account ${accountId}...`);

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
