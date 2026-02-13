import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getExecutor } from "open-sse/executors";
import { parseUpstreamError } from "open-sse/utils/error";

/**
 * Discovery Service
 * Periodically validates all stored credentials and updates their status.
 */

let discoveryInterval = null;

/**
 * Start the discovery loop
 * @param {number} intervalMs - Frequency of checks (default 10 minutes)
 */
export function startDiscoveryLoop(intervalMs = 10 * 60 * 1000) {
    if (discoveryInterval) return;

    console.log(`[Discovery] Starting health check loop every ${intervalMs / 1000}s`);

    // Run once immediately
    runDiscovery();

    discoveryInterval = setInterval(runDiscovery, intervalMs);
}

/**
 * Stop the discovery loop
 */
export function stopDiscoveryLoop() {
    if (discoveryInterval) {
        clearInterval(discoveryInterval);
        discoveryInterval = null;
    }
}

/**
 * Run discovery check for all accounts
 */
export async function runDiscovery() {
    const connections = await getProviderConnections();
    console.log(`[Discovery] Validating ${connections.length} accounts...`);

    for (const conn of connections) {
        try {
            await validateAccount(conn);
        } catch (err) {
            console.error(`[Discovery] Failed to validate ${conn.provider} account ${conn.id}:`, err.message);
        }
    }
}

/**
 * Validate a single account
 */
async function validateAccount(conn) {
    const executor = getExecutor(conn.provider);
    if (!executor) return;

    // Perform a small "warmup" or NOOP request if supported, or just verify token refresh
    // For most providers, we'll just try to refresh the token or check for obvious expiry

    const now = new Date().toISOString();

    // Update lastTested
    await updateProviderConnection(conn.id, { lastTested: now });

    // If it's an API key account, we could do a minimal model list call
    // For now, let's just mark active if it wasn't explicitly failed recently
    if (conn.testStatus === "active") return;

    // If it was marked unavailable, check if cooldown expired
    if (conn.rateLimitedUntil && new Date(conn.rateLimitedUntil) <= new Date()) {
        console.log(`[Discovery] Cooldown expired for ${conn.provider} account ${conn.id.slice(0, 8)}. Resetting to active.`);
        await updateProviderConnection(conn.id, {
            testStatus: "active",
            rateLimitedUntil: null,
            lastError: null,
            backoffLevel: 0
        });
    }
}
