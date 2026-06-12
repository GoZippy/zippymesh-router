import { getProviderConnections, updateProviderConnection } from "../localDb.js";
import {
    refreshAccessToken,
    refreshCopilotToken,
    refreshGitHubToken
} from "../../sse/services/tokenRefresh.js";

// Refresh thresholds
const STANDARD_REFRESH_THRESHOLD_MS = 2 * 60 * 60 * 1000;   // 2 hours
const COPILOT_REFRESH_THRESHOLD_MS  = 25 * 60 * 1000;         // 25 minutes

/**
 * Background Token Refresh Job
 *
 * Proactively refreshes OAuth tokens before they expire so that overnight
 * idle periods do not leave tokens in an expired state.  The job is driven
 * by MaintenanceScheduler and runs on two cadences:
 *   - Every 30 minutes  → sweep all OAuth connections (2-hour threshold)
 *   - Every 20 minutes  → same sweep, but the 25-minute threshold for GitHub
 *                         Copilot tokens means they get caught on this pass too
 */
export class TokenRefreshJob {
    constructor() {
        // Set of connection IDs currently being refreshed – prevents concurrent
        // duplicate refreshes if a sweep takes longer than the interval.
        this._inProgress = new Set();
    }

    /**
     * Run a full sweep of all active provider connections.
     * Each connection is processed independently; one failure does not abort
     * the rest of the sweep.
     */
    async run() {
        console.log("[TokenRefresh] Starting background token refresh sweep...");

        let connections;
        try {
            connections = await getProviderConnections({ isActive: true });
        } catch (err) {
            console.error("[TokenRefresh] Failed to load provider connections:", err.message);
            return;
        }

        let refreshed = 0;
        let skipped   = 0;
        let failed    = 0;

        for (const conn of connections) {
            // Skip API-key providers – they have no OAuth tokens to refresh.
            if (conn.authType === "apiKey" || !conn.refreshToken) {
                skipped++;
                continue;
            }

            // Concurrent-refresh guard
            if (this._inProgress.has(conn.id)) {
                console.log(`[TokenRefresh] Skipping ${conn.provider}/${conn.id} – refresh already in progress`);
                skipped++;
                continue;
            }

            this._inProgress.add(conn.id);
            try {
                const result = await this._refreshConnection(conn);
                if (result === "refreshed") refreshed++;
                else if (result === "failed")  failed++;
                else                           skipped++;
            } finally {
                this._inProgress.delete(conn.id);
            }
        }

        console.log(
            `[TokenRefresh] Sweep complete – refreshed: ${refreshed}, failed: ${failed}, skipped: ${skipped}`
        );
    }

    /**
     * Evaluate and refresh a single connection.
     *
     * @returns {"refreshed"|"failed"|"skipped"}
     */
    async _refreshConnection(conn) {
        const now = Date.now();
        const provider = conn.provider;

        // ── GitHub / Copilot special handling ──────────────────────────────
        if (provider === "github") {
            return await this._refreshGitHub(conn, now);
        }

        // ── Standard OAuth token ────────────────────────────────────────────
        if (!conn.expiresAt) {
            // No expiry recorded – cannot determine if refresh is needed.
            return "skipped";
        }

        const expiresAt = new Date(conn.expiresAt).getTime();
        if (expiresAt - now > STANDARD_REFRESH_THRESHOLD_MS) {
            // Token still has more than 2 hours of life remaining.
            return "skipped";
        }

        console.log(
            `[TokenRefresh] Refreshing ${provider} token for connection ${conn.id} ` +
            `(expires in ${Math.round((expiresAt - now) / 60000)} min)`
        );

        try {
            const newCredentials = await refreshAccessToken(provider, conn.refreshToken, conn);
            if (newCredentials && newCredentials.accessToken) {
                const updates = {
                    accessToken: newCredentials.accessToken,
                };
                if (newCredentials.refreshToken) {
                    updates.refreshToken = newCredentials.refreshToken;
                }
                if (newCredentials.expiresIn) {
                    updates.expiresAt = new Date(now + newCredentials.expiresIn * 1000).toISOString();
                }
                await updateProviderConnection(conn.id, updates);
                console.log(`[TokenRefresh] Successfully refreshed ${provider} token for connection ${conn.id}`);
                return "refreshed";
            }

            await this._markNeedsReauth(conn.id, provider);
            return "failed";
        } catch (err) {
            console.warn(
                `[TokenRefresh] Error refreshing ${provider} token for connection ${conn.id}:`,
                err.message
            );
            await this._markNeedsReauth(conn.id, provider);
            return "failed";
        }
    }

    /**
     * GitHub-specific refresh: handles both the GitHub OAuth token and the
     * short-lived Copilot token stored in providerSpecificData.
     *
     * @returns {"refreshed"|"failed"|"skipped"}
     */
    async _refreshGitHub(conn, now) {
        let refreshed = false;

        // ── 1. GitHub OAuth token (standard expiry, 2-hour threshold) ──────
        if (conn.expiresAt) {
            const expiresAt = new Date(conn.expiresAt).getTime();
            if (expiresAt - now <= STANDARD_REFRESH_THRESHOLD_MS) {
                console.log(
                    `[TokenRefresh] Refreshing GitHub OAuth token for connection ${conn.id} ` +
                    `(expires in ${Math.round((expiresAt - now) / 60000)} min)`
                );
                try {
                    const newGH = await refreshGitHubToken(conn.refreshToken);
                    if (newGH && newGH.accessToken) {
                        const updates = { accessToken: newGH.accessToken };
                        if (newGH.refreshToken) updates.refreshToken = newGH.refreshToken;
                        if (newGH.expiresIn) {
                            updates.expiresAt = new Date(now + newGH.expiresIn * 1000).toISOString();
                        }
                        await updateProviderConnection(conn.id, updates);
                        // Use the fresh access token for copilot refresh below
                        conn = { ...conn, ...updates };
                        console.log(`[TokenRefresh] Successfully refreshed GitHub token for connection ${conn.id}`);
                        refreshed = true;
                    } else {
                        await this._markNeedsReauth(conn.id, "github");
                        return "failed";
                    }
                } catch (err) {
                    console.warn(
                        `[TokenRefresh] Error refreshing GitHub token for connection ${conn.id}:`,
                        err.message
                    );
                    await this._markNeedsReauth(conn.id, "github");
                    return "failed";
                }
            }
        }

        // ── 2. Copilot token (25-minute threshold) ──────────────────────────
        const psd = conn.providerSpecificData || conn.metadata;
        if (psd && psd.copilotTokenExpiresAt) {
            const copilotExpiresAt = psd.copilotTokenExpiresAt * 1000; // stored as Unix seconds
            if (copilotExpiresAt - now <= COPILOT_REFRESH_THRESHOLD_MS) {
                console.log(
                    `[TokenRefresh] Refreshing Copilot token for connection ${conn.id} ` +
                    `(expires in ${Math.round((copilotExpiresAt - now) / 60000)} min)`
                );
                try {
                    const copilotToken = await refreshCopilotToken(conn.accessToken);
                    if (copilotToken) {
                        await updateProviderConnection(conn.id, {
                            providerSpecificData: {
                                ...psd,
                                copilotToken: copilotToken.token,
                                copilotTokenExpiresAt: copilotToken.expiresAt
                            }
                        });
                        console.log(`[TokenRefresh] Successfully refreshed Copilot token for connection ${conn.id}`);
                        refreshed = true;
                    } else {
                        console.warn(
                            `[TokenRefresh] Copilot token refresh returned null for connection ${conn.id}`
                        );
                        // Don't mark needs_reauth just for copilot – the GitHub token may still be valid
                    }
                } catch (err) {
                    console.warn(
                        `[TokenRefresh] Error refreshing Copilot token for connection ${conn.id}:`,
                        err.message
                    );
                }
            }
        }

        return refreshed ? "refreshed" : "skipped";
    }

    /**
     * Mark a connection as needing re-authentication after a failed refresh.
     */
    async _markNeedsReauth(connectionId, provider) {
        console.warn(
            `[TokenRefresh] Token refresh failed for ${provider}/${connectionId} – marking needs_reauth`
        );
        try {
            await updateProviderConnection(connectionId, {
                testStatus: "needs_reauth",
                lastError: "Token refresh failed - reconnection required",
                lastErrorAt: new Date().toISOString()
            });
        } catch (err) {
            console.error(
                `[TokenRefresh] Could not update needs_reauth status for ${connectionId}:`,
                err.message
            );
        }
    }
}

export const tokenRefreshJob = new TokenRefreshJob();
