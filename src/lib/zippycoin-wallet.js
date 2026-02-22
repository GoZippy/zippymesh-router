/**
 * ZippyCoin Wallet Client
 * 
 * Provides interaction with the ZippyCoin Node via JSON-RPC.
 * Canonical RPC Port: 8545
 * Canonical Chain ID: 777
 */

const RPC_URL = process.env.NEXT_PUBLIC_ZIPPYCOIN_RPC_URL || "http://localhost:8545";

export async function zippyRpc(method, params = []) {
    try {
        const response = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method,
                params,
                id: Date.now()
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.result;
    } catch (error) {
        console.error(`ZippyCoin RPC Error (${method}):`, error);
        throw error;
    }
}

export async function getZippyBalance(address) {
    if (!address) return "0";
    const balanceHex = await zippyRpc("eth_getBalance", [address, "latest"]);
    return (parseInt(balanceHex, 16) / 10 ** 18).toString(); // Assuming 18 decimals like ETH
}

export async function getZippyChainId() {
    return await zippyRpc("eth_chainId");
}

export async function getZippyBlockNumber() {
    return await zippyRpc("eth_blockNumber");
}

/**
 * ZippyCoin specific extensions
 */
export async function getZippyTrustScore(address) {
    return await zippyRpc("zippycoin_getTrustScore", [address]);
}

export async function getZippyEnvironmentalData() {
    return await zippyRpc("zippycoin_getEnvironmentalData", []);
}
