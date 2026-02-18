const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:9000";

/**
 * Fetch all discovered peers from the Sidecar.
 * @returns {Promise<Array>} List of peers
 */
export async function getSidecarPeers() {
    try {
        const res = await fetch(`${SIDECAR_URL}/peers`);
        if (!res.ok) return [];
        return await res.json();
    } catch (error) {
        console.error("Error fetching sidecar peers:", error);
        return [];
    }
}

/**
 * Find routes (peers) for a specific model.
 * @param {string} modelName 
 * @returns {Promise<Array>} List of peers offering the model
 */
export async function getSidecarRoutes(modelName) {
    try {
        const res = await fetch(`${SIDECAR_URL}/routes?model=${encodeURIComponent(modelName)}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (error) {
        console.error(`Error fetching routes for ${modelName}:`, error);
        return [];
    }
}

/**
 * Check if Sidecar is healthy.
 */
export async function getSidecarHealth() {
    try {
        const res = await fetch(`${SIDECAR_URL}/health`, { signal: AbortSignal.timeout(1000) });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Proxy chat completion to Sidecar.
 * @param {object} payload - Chat completion request body
 * @returns {Promise<Response>} Fetch response
 */
export async function proxyChatCompletion(payload) {
    return fetch(`${SIDECAR_URL}/proxy/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
}
