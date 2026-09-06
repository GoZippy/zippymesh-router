/**
 * API route: /api/mesh/wallet
 *
 * The ZippyCoin wallet is owned by the Rust sidecar: it generates a single
 * ML-DSA-65 keypair at startup, derives the canonical `zpc1` address (the
 * exact formula the core node accepts), and auto-registers its pubkey. This
 * route is a thin, read-mostly bridge to that wallet.
 *
 * NOTE: the old Ed25519 `0x` keygen (src/lib/wallet-management.js) was retired
 * — it produced an address the chain can never register or verify. Do NOT mint
 * keys in JS; always surface the sidecar's zpc1 wallet.
 */

import { getSidecarWalletBalance } from '@/lib/sidecar.js';
import { zippyRpc } from '@/lib/zippycoin-wallet.js';

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Fetch the node-managed wallet (address + live balance) from the sidecar. */
async function sidecarWallet() {
    // { balance, currency, address, source }
    return getSidecarWalletBalance();
}

export async function GET(request) {
    try {
        const action = new URL(request.url).searchParams.get('action');
        switch (action) {
            case 'status':
                return handleGetStatus();
            case 'details':
            default:
                return handleGetDetails();
        }
    } catch (error) {
        return json({ error: error.message, code: 'WALLET_ERROR' }, 500);
    }
}

export async function POST(request) {
    try {
        const { action } = await request.json();
        switch (action) {
            case 'initialize':
            case 'generate':
                // The sidecar wallet always exists; "generate" just surfaces it.
                return handleGenerate();
            case 'export':
            case 'restore':
            case 'remove':
                return handleNodeManaged(action);
            default:
                return json({ error: 'Unknown action', code: 'INVALID_ACTION' }, 400);
        }
    } catch (error) {
        return json({ error: error.message, code: 'WALLET_ERROR' }, 500);
    }
}

async function handleGetDetails() {
    try {
        const w = await sidecarWallet();
        // Best-effort nonce + exact ZAT balance direct from the node RPC
        // (falls back gracefully if the node is unreachable).
        let nonce = 0;
        let balanceWei;
        try {
            const nonceHex = await zippyRpc('zippycoin_getNonce', [w.address, 'latest']);
            nonce = parseInt(nonceHex, 16) || 0;
        } catch { /* node down — leave nonce 0 */ }
        try {
            const balHex = await zippyRpc('zippycoin_getBalance', [w.address, 'latest']);
            balanceWei = BigInt(balHex).toString(); // ZAT, exact
        } catch { /* use sidecar balance only */ }

        return json({
            success: true,
            details: {
                address: w.address,
                balance: (w.balance ?? 0).toString(),
                balanceWei,
                nonce,
                keyType: 'ml-dsa-65',
                source: w.source,
            },
        });
    } catch {
        return json({
            success: false,
            message: 'Node wallet unavailable — is the ZippyCoin sidecar running?',
            wallet: null,
        });
    }
}

async function handleGenerate() {
    try {
        const w = await sidecarWallet();
        return json({
            success: true,
            wallet: {
                address: w.address,
                balance: (w.balance ?? 0).toString(),
                keyType: 'ml-dsa-65',
                isActive: true,
            },
        });
    } catch {
        return json({
            success: false,
            error: 'Cannot reach the ZippyCoin sidecar. Start the node/sidecar; the wallet is created automatically.',
        }, 502);
    }
}

async function handleGetStatus() {
    try {
        const w = await sidecarWallet();
        return json({ success: true, hasWallet: !!w.address, address: w.address });
    } catch {
        return json({ success: false, hasWallet: false });
    }
}

/**
 * export / restore / remove used to operate on the retired JS keystore. The
 * zpc1 wallet's key material is the sidecar's ML-DSA seed file on this host,
 * so these are node-managed operations, not JSON-keystore ones.
 */
function handleNodeManaged(action) {
    return json({
        success: false,
        error: `'${action}' is managed by the node sidecar. The wallet key is the sidecar's ML-DSA seed file on this machine; back it up / restore it at the node level rather than through the browser.`,
        code: 'NODE_MANAGED_WALLET',
    }, 400);
}
