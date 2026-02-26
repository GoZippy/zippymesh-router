import { refreshOAuthToken, isTokenExpired } from "../oauth/utils/refresh.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "../../shared/constants/providers.js";

// Provider models endpoints configuration
export const PROVIDER_MODELS_CONFIG = {
    claude: {
        url: "https://api.anthropic.com/v1/models",
        method: "GET",
        headers: {
            "Anthropic-Version": "2023-06-01",
            "Content-Type": "application/json"
        },
        authHeader: "x-api-key",
        parseResponse: (data) => data.data || []
    },
    gemini: {
        url: "https://generativelanguage.googleapis.com/v1beta/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authQuery: "key", // Use query param for API key
        parseResponse: (data) => data.models || []
    },
    "gemini-cli": {
        url: "https://generativelanguage.googleapis.com/v1beta/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.models || []
    },
    qwen: {
        url: "https://portal.qwen.ai/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    antigravity: {
        url: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        body: {},
        parseResponse: (data) => data.models || []
    },
    openai: {
        url: "https://api.openai.com/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    openrouter: {
        url: "https://openrouter.ai/api/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    kiro: {
        url: "https://api.kiro.ai/api/openrouter/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    anthropic: {
        url: "https://api.anthropic.com/v1/models",
        method: "GET",
        headers: {
            "Anthropic-Version": "2023-06-01",
            "Content-Type": "application/json"
        },
        authHeader: "x-api-key",
        parseResponse: (data) => data.data || []
    }
};

/**
 * Fetch models from a provider connection
 */
export async function fetchProviderModels(connection) {
    if (isOpenAICompatibleProvider(connection.provider)) {
        const baseUrl = connection.providerSpecificData?.baseUrl || connection.metadata?.baseUrl;
        if (!baseUrl) throw new Error("No base URL configured for OpenAI compatible provider");

        const url = `${baseUrl.replace(/\/$/, "")}/models`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${connection.apiKey}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
        }

        const data = await response.json();
        return data.data || data.models || [];
    }

    if (isAnthropicCompatibleProvider(connection.provider)) {
        let baseUrl = connection.providerSpecificData?.baseUrl || connection.metadata?.baseUrl;
        if (!baseUrl) throw new Error("No base URL configured for Anthropic compatible provider");

        baseUrl = baseUrl.replace(/\/$/, "");
        if (baseUrl.endsWith("/messages")) {
            baseUrl = baseUrl.slice(0, -9);
        }

        const url = `${baseUrl}/models`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": connection.apiKey,
                "anthropic-version": "2023-06-01",
                "Authorization": `Bearer ${connection.apiKey}`
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
        }

        const data = await response.json();
        return data.data || data.models || [];
    }

    const config = PROVIDER_MODELS_CONFIG[connection.provider];
    if (!config) {
        throw new Error(`Provider ${connection.provider} does not support models listing`);
    }

    // Get auth token
    let token = connection.accessToken || connection.apiKey;
    if (!token) throw new Error("No valid token found");

    // Auto-refresh for OAuth if expired
    const isOAuth = connection.authType === "oauth";
    if (isOAuth && isTokenExpired(connection)) {
        const newToken = await refreshOAuthToken(connection);
        if (newToken) {
            token = newToken;
        }
    }

    // Build request URL
    let url = config.url;
    if (config.authQuery) {
        url += `?${config.authQuery}=${token}`;
    }

    // Build headers
    const headers = { ...config.headers };
    if (config.authHeader && !config.authQuery) {
        headers[config.authHeader] = (config.authPrefix || "") + token;
    }

    // Make request
    const fetchOptions = {
        method: config.method,
        headers
    };

    if (config.body && config.method === "POST") {
        fetchOptions.body = JSON.stringify(config.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = await response.json();
    return config.parseResponse(data);
}
