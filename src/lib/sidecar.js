const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:9480";

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
 * Get Sidecar Node Info (Identity, Status).
 * @returns {Promise<object|null>} Node info or null if failed
 */
export async function getSidecarInfo() {
    try {
        const res = await fetch(`${SIDECAR_URL}/node/info`, { signal: AbortSignal.timeout(1000) });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
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

/**
 * Open a mock payment channel.
 * @param {string} targetPeerId
 * @param {number} amount
 */
export async function openPaymentChannel(targetPeerId, amount) {
    try {
        const res = await fetch(`${SIDECAR_URL}/payment/open_channel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_peer_id: targetPeerId, amount })
        });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (error) {
        console.error("Error opening channel:", error);
        throw error;
    }
}

/**
 * Get Wallet Balance.
 */
export async function getWalletBalance() {
    try {
        const res = await fetch(`${SIDECAR_URL}/wallet/balance`);
        if (!res.ok) return { balance: 0, currency: 'ZIP' };
        return await res.json();
    } catch (error) {
        console.error("Error fetching balance:", error);
        return { balance: 0, currency: 'ZIP' };
    }
}

/**
 * Get Wallet Transactions.
 */
export async function getWalletTransactions() {
    try {
        const res = await fetch(`${SIDECAR_URL}/wallet/transactions`);
        if (!res.ok) return [];
        return await res.json();
    } catch (error) {
        console.error("Error fetching transactions:", error);
        return [];
    }
}

/**
 * Get Wallet Earnings.
 */
export async function getWalletEarnings() {
    try {
        const res = await fetch(`${SIDECAR_URL}/wallet/earnings`);
        if (!res.ok) return 0;
        const data = await res.json();
        return data.earnings || 0;
    } catch (error) {
        console.error("Error fetching earnings:", error);
        return 0;
    }
}
