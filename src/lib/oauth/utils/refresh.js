
import {
    GEMINI_CONFIG,
    ANTIGRAVITY_CONFIG,
    CODEX_CONFIG,
    KIRO_CONFIG,
    CLAUDE_CONFIG
} from "../constants/oauth.js";
import { updateProviderConnection } from "../../localDb.js";
import { resolveOAuthClientSecret } from "./secrets.js";

/**
 * Refresh OAuth token using refresh_token
 */
export async function refreshOAuthToken(connection) {
    const provider = connection.provider;
    const refreshToken = connection.refreshToken;

    if (!refreshToken) return null;

    try {
        let result = null;

        // Google-based providers
        if (provider === "gemini-cli" || provider === "antigravity") {
            const config = provider === "gemini-cli" ? GEMINI_CONFIG : ANTIGRAVITY_CONFIG;
            const providerName = provider === "gemini-cli" ? "gemini-cli" : "antigravity";
            const clientSecret = await resolveOAuthClientSecret(providerName, config);
            const payload = {
                client_id: config.clientId,
                grant_type: "refresh_token",
                refresh_token: refreshToken,
            };
            if (clientSecret) {
                payload.client_secret = clientSecret;
            }
            const response = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams(payload),
            });

            if (!response.ok) return null;
            const data = await response.json();
            result = {
                accessToken: data.access_token,
                expiresIn: data.expires_in,
                refreshToken: data.refresh_token || refreshToken,
            };
        }

        // OpenAI/Codex
        else if (provider === "codex") {
            const response = await fetch(CODEX_CONFIG.tokenUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: CODEX_CONFIG.clientId,
                    refresh_token: refreshToken,
                }),
            });

            if (!response.ok) return null;
            const data = await response.json();
            result = {
                accessToken: data.access_token,
                expiresIn: data.expires_in,
                refreshToken: data.refresh_token || refreshToken,
            };
        }

        // Claude
        else if (provider === "claude") {
            const response = await fetch(CLAUDE_CONFIG.tokenUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: CLAUDE_CONFIG.clientId,
                    refresh_token: refreshToken,
                }),
            });

            if (!response.ok) return null;
            const data = await response.json();
            result = {
                accessToken: data.access_token,
                expiresIn: data.expires_in,
                refreshToken: data.refresh_token || refreshToken,
            };
        }

        // Kiro
        else if (provider === "kiro") {
            const { clientId, clientSecret, region } = connection;
            if (clientId && clientSecret) {
                const endpoint = `https://oidc.${region || "us-east-1"}.amazonaws.com/token`;
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        clientId,
                        clientSecret,
                        refreshToken,
                        grantType: "refresh_token",
                    }),
                });

                if (response.ok) {
                    const data = await response.json();
                    result = {
                        accessToken: data.accessToken,
                        expiresIn: data.expiresIn || 3600,
                        refreshToken: data.refreshToken || refreshToken,
                    };
                }
            } else {
                const response = await fetch(KIRO_CONFIG.socialRefreshUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ refreshToken }),
                });

                if (response.ok) {
                    const data = await response.json();
                    result = {
                        accessToken: data.accessToken,
                        expiresIn: data.expiresIn || 3600,
                        refreshToken: data.refreshToken || refreshToken,
                    };
                }
            }
        }

        if (result) {
            // Auto-persist new tokens
            const updateData = {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                updatedAt: new Date().toISOString()
            };
            if (result.expiresIn) {
                updateData.expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
            }
            await updateProviderConnection(connection.id, updateData);
            return result.accessToken;
        }

        return null;
    } catch (err) {
        console.error(`Error refreshing ${provider} token:`, err);
        return null;
    }
}

/**
 * Check if token is expired
 */
export function isTokenExpired(connection) {
    if (!connection.expiresAt) return false;
    const expiresAt = new Date(connection.expiresAt).getTime();
    const buffer = 5 * 60 * 1000; // 5 minutes
    return expiresAt <= Date.now() + buffer;
}
