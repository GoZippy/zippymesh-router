
import {
    GEMINI_CONFIG,
    ANTIGRAVITY_CONFIG,
    CODEX_CONFIG,
    KIRO_CONFIG,
    CLAUDE_CONFIG
} from "../constants/oauth.js";
import { updateProviderConnection } from "../../localDb.js";
import { resolveOAuthClientSecret } from "./secrets.js";

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

const REFRESH_HANDLERS = {
  "gemini-cli": async (connection) => {
    const clientSecret = await resolveOAuthClientSecret("gemini-cli", GEMINI_CONFIG, { connection });
    const payload = {
      client_id: GEMINI_CONFIG.clientId,
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    };
    if (clientSecret) {
      payload.client_secret = clientSecret;
    }

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload),
    });
    if (!response.ok) return null;

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token || connection.refreshToken,
    };
  },

  antigravity: async (connection) => {
    const clientSecret = await resolveOAuthClientSecret("antigravity", ANTIGRAVITY_CONFIG, { connection });
    const payload = {
      client_id: ANTIGRAVITY_CONFIG.clientId,
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    };
    if (clientSecret) {
      payload.client_secret = clientSecret;
    }

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload),
    });
    if (!response.ok) return null;

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token || connection.refreshToken,
    };
  },

  codex: async (connection) => {
    const response = await fetch(CODEX_CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CODEX_CONFIG.clientId,
        refresh_token: connection.refreshToken,
      }),
    });
    if (!response.ok) return null;

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token || connection.refreshToken,
    };
  },

  claude: async (connection) => {
    const response = await fetch(CLAUDE_CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLAUDE_CONFIG.clientId,
        refresh_token: connection.refreshToken,
      }),
    });
    if (!response.ok) return null;

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token || connection.refreshToken,
    };
  },

  kiro: async (connection) => {
    const { clientId, clientSecret, region } = connection;
    if (clientId && clientSecret) {
      const endpoint = `https://oidc.${region || "us-east-1"}.amazonaws.com/token`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken: connection.refreshToken,
          grantType: "refresh_token",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          accessToken: data.accessToken,
          expiresIn: data.expiresIn || 3600,
          refreshToken: data.refreshToken || connection.refreshToken,
        };
      }
      return null;
    }

    const response = await fetch(KIRO_CONFIG.socialRefreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: connection.refreshToken }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      expiresIn: data.expiresIn || 3600,
      refreshToken: data.refreshToken || connection.refreshToken,
    };
  },
};

/**
 * Refresh OAuth token using refresh_token
 */
export async function refreshOAuthToken(connection) {
    const provider = connection.provider;
    const refreshToken = connection.refreshToken;

    if (!refreshToken) return null;

    try {
        const handler = REFRESH_HANDLERS[provider];
        if (!handler) return null;

        const result = await handler(connection);
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
