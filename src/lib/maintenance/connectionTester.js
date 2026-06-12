import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { updateProviderConnection } from "../localDb.js";
import { PROVIDER_MODELS } from "../../shared/constants/models";

/**
 * Connection Tester Service
 * Validates provider connections and tracks performance metrics.
 */
export class ConnectionTester {
    /**
     * Test a specific connection
     * @param {object} connection - The provider connection object from DB
     * @returns {Promise<object>} Results of the test
     */
    async testConnection(connection) {
        const startTime = Date.now();
        const provider = connection.provider;

        // Pick a lightweight model for testing (default to first available)
        const models = PROVIDER_MODELS[provider] || [];
        const testModel = connection.defaultModel || (models[0]?.id) || "gpt-3.5-turbo"; // Fallback

        const testPayload = {
            model: testModel,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 5,
            stream: false
        };

        try {
            // Send a real minimal request to verify the live connection
            const result = await handleChatCore({
                body: testPayload,
                modelInfo: { provider, model: testModel },
                credentials: connection,
                connectionId: connection.id,
                // We don't want to log this as a real user request
                isTest: true
            });

            const latency = Date.now() - startTime;

            if (result.success) {
                // Calculate rough TPS if usage data is available
                const tokens = result.usage?.total_tokens || 1;
                const tps = (tokens / (latency / 1000)).toFixed(2);

                const updates = {
                    testStatus: "active",
                    lastTested: new Date().toISOString(),
                    lastError: null,
                    latency: latency,
                    tps: parseFloat(tps)
                };

                await updateProviderConnection(connection.id, updates);
                return { success: true, ...updates };
            } else {
                const errorUpdate = {
                    testStatus: "error",
                    lastTested: new Date().toISOString(),
                    lastError: result.error || "Unknown error",
                    lastErrorAt: new Date().toISOString()
                };
                await updateProviderConnection(connection.id, errorUpdate);
                return { success: false, ...errorUpdate };
            }
        } catch (err) {
            const errorUpdate = {
                testStatus: "error",
                lastTested: new Date().toISOString(),
                lastError: err.message,
                lastErrorAt: new Date().toISOString()
            };
            await updateProviderConnection(connection.id, errorUpdate);
            return { success: false, ...errorUpdate };
        }
    }

    /**
     * Discovery: Fetch models served by the provider
     * @param {object} connection 
     */
    async discoverModels(connection) {
        // This will be implemented in discovery.js but ConnectionTester provides the probe
        // Some providers have /models endpoints, others we must rely on our static list
        // or try to probe common ones.
    }
}

export const connectionTester = new ConnectionTester();
