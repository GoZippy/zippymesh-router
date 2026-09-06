import { refreshOAuthToken, isTokenExpired } from "../oauth/utils/refresh.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "../../shared/constants/providers.js";

// Provider models endpoints configuration
export const PROVIDER_MODELS_CONFIG = {
    claude: {
        url: "https://api.anthropic.com/v1/models",
        method: "GET",
        headers: {
            "Anthropic-Version": "2023-06-01",
            "Anthropic-Beta": "oauth-2025-04-20",
            "Content-Type": "application/json"
        },
        // Not used directly for claude — fetchProviderModels() branches this
        // provider on apiKey vs. accessToken (Anthropic rejects an OAuth
        // token sent via x-api-key), mirroring open-sse/executors/default.js.
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
        // NOTE: previously "daily-cloudcode-pa.sandbox.googleapis.com" — a
        // typo'd host that doesn't match the real API used everywhere else
        // (open-sse/config/constants.js, src/lib/oauth/constants/oauth.js),
        // so every Antigravity model-sync attempt failed outright.
        url: "https://daily-cloudcode-pa.googleapis.com/v1internal:models",
        fallbackUrls: ["https://cloudcode-pa.googleapis.com/v1internal:models"],
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
    kilo: {
        url: "https://api.kilo.ai/api/gateway/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => {
            const raw = data?.data ?? data?.models ?? data?.results ?? (Array.isArray(data) ? data : []);
            return Array.isArray(raw) ? raw : [];
        }
    },
    groq: {
        url: "https://api.groq.com/openai/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    mistral: {
        url: "https://api.mistral.ai/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => Array.isArray(data) ? data : (data.data || [])
    },
    xai: {
        url: "https://api.x.ai/v1/models",
        fallbackUrls: ["https://api.x.ai/v1/language-models"],
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    deepseek: {
        url: "https://api.deepseek.com/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    cerebras: {
        url: "https://api.cerebras.ai/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    cohere: {
        url: "https://api.cohere.com/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.models || data.data || []
    },
    glm: {
        url: "https://api.z.ai/api/anthropic/v1/models",
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        },
        authHeader: "x-api-key",
        parseResponse: (data) => data.data || data.models || []
    },
    kimi: {
        url: "https://api.kimi.com/coding/v1/models",
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        },
        authHeader: "x-api-key",
        parseResponse: (data) => data.data || data.models || []
    },
    minimax: {
        url: "https://api.minimax.io/anthropic/v1/models",
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        },
        authHeader: "x-api-key",
        parseResponse: (data) => data.data || data.models || []
    },
    "minimax-cn": {
        url: "https://api.minimaxi.com/anthropic/v1/models",
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        },
        authHeader: "x-api-key",
        parseResponse: (data) => data.data || data.models || []
    },
    togetherai: {
        url: "https://api.together.xyz/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    fireworks: {
        url: "https://api.fireworks.ai/inference/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    anyscale: {
        url: "https://api.endpoints.anyscale.com/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || []
    },
    perplexity: {
        url: "https://api.perplexity.ai/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || data.models || []
    },
    deepinfra: {
        url: "https://api.deepinfra.com/v1/openai/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || data.models || []
    },
    novita: {
        url: "https://api.novita.ai/v3/openai/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || data.models || []
    },
    ai21: {
        url: "https://api.ai21.com/studio/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || data.models || []
    },
    moonshot: {
        url: "https://api.moonshot.ai/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => data.data || data.models || []
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
    },
    replicate: {
        url: "https://api.replicate.com/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        parseResponse: (data) => (Array.isArray(data?.results) ? data.results : data?.data || [])
    }
};

/**
 * Fetch models from a provider connection
 */
export async function fetchProviderModels(connection) {
    const normalizedApiKey = typeof connection?.apiKey === "string" ? connection.apiKey.trim() : connection?.apiKey;

    if (isOpenAICompatibleProvider(connection.provider)) {
        const baseUrl = connection.providerSpecificData?.baseUrl || connection.metadata?.baseUrl;
        if (!baseUrl) throw new Error("No base URL configured for OpenAI compatible provider");

        const url = `${baseUrl.replace(/\/$/, "")}/models`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${normalizedApiKey}`,
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
                "x-api-key": normalizedApiKey,
                "anthropic-version": "2023-06-01",
                "Authorization": `Bearer ${normalizedApiKey}`
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
    let token = connection.accessToken || normalizedApiKey;
    if (!token) throw new Error("No valid token found");
    if (typeof token === "string") token = token.trim();

    // Auto-refresh for OAuth if expired
    const isOAuth = connection.authType === "oauth";
    if (isOAuth && isTokenExpired(connection)) {
        const newToken = await refreshOAuthToken(connection);
        if (newToken) {
            token = newToken;
        }
    }

    const endpointCandidates = [config.url, ...(Array.isArray(config.fallbackUrls) ? config.fallbackUrls : [])];
    let lastStatus = null;

    for (const baseEndpoint of endpointCandidates) {
        let url = baseEndpoint;
        if (config.authQuery) {
            url += `?${config.authQuery}=${encodeURIComponent(token)}`;
        }

        // Build headers
        const headers = { ...config.headers };
        if (connection.provider === "claude") {
            // Anthropic only accepts an OAuth access token via `Authorization:
            // Bearer`, not `x-api-key` — sending it as x-api-key (the classic
            // API-key header) gets an unconditional 401. Mirrors the branch
            // already used by the real chat executor for this provider.
            if (normalizedApiKey) {
                headers["x-api-key"] = normalizedApiKey;
            } else {
                headers["Authorization"] = `Bearer ${token}`;
            }
        } else if (config.authHeader && !config.authQuery) {
            headers[config.authHeader] = (config.authPrefix || "") + token;
        }

        const fetchOptions = {
            method: config.method,
            headers
        };

        if (config.body && config.method === "POST") {
            fetchOptions.body = JSON.stringify(config.body);
        }

        const debugKiroSync = connection.provider === "kiro" && process.env.NODE_ENV !== "production";

        const response = await fetch(url, fetchOptions);
        if (!response.ok) {
            lastStatus = response.status;
            if (debugKiroSync) {
                const bodyText = await response.text().catch(() => "<unreadable>");
                console.log(`[fetchProviderModels] kiro ${baseEndpoint} -> HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
            }
            continue;
        }

        const data = await response.json();
        if (connection.provider === "kiro") {
            const parsed = config.parseResponse(data);
            if (debugKiroSync) {
                // Diagnostic: confirm what api.kiro.ai/api/openrouter/models actually
                // returns for this account (curated subset vs. full IDE-parity catalog),
                // and surface pagination hints if the API truncates the list. Dev-only.
                console.log(`[fetchProviderModels] kiro raw response keys: ${Object.keys(data || {}).join(", ")}`);
                console.log(`[fetchProviderModels] kiro parsed model count: ${Array.isArray(parsed) ? parsed.length : "n/a"}`);
                console.log(`[fetchProviderModels] kiro model ids: ${Array.isArray(parsed) ? parsed.map(m => m.id || m.name || m.model).join(", ") : "n/a"}`);
                if (data && (data.has_more || data.next_page || data.nextCursor || data.pagination)) {
                    console.log(`[fetchProviderModels] kiro response appears paginated:`, JSON.stringify({ has_more: data.has_more, next_page: data.next_page, nextCursor: data.nextCursor, pagination: data.pagination }));
                }
            }
            return parsed;
        }
        return config.parseResponse(data);
    }

    throw new Error(`Failed to fetch models: ${lastStatus ?? "unknown"}`);
}
