/**
 * API route: /api/mesh/wallet
 * Handles wallet generation, retrieval, and management
 */

import { initializeWallet, generateNewWallet, getCurrentWallet, getWalletDetails, removeWallet, restoreWalletFromBackup } from '@/lib/wallet-management';

export async function GET(request) {
    try {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        switch (action) {
            case 'details':
                return handleGetDetails();
            case 'status':
                return handleGetStatus();
            default:
                return handleGetCurrent();
        }
    } catch (error) {
        return new Response(JSON.stringify({
            error: error.message,
            code: 'WALLET_ERROR'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { action } = body;

        switch (action) {
            case 'initialize':
                return handleInitialize();
            case 'generate':
                return handleGenerate();
            case 'remove':
                return handleRemove(body);
            case 'export':
                return handleExport();
            case 'restore':
                return handleRestore(body);
            default:
                return new Response(JSON.stringify({
                    error: 'Unknown action',
                    code: 'INVALID_ACTION'
                }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
    } catch (error) {
        return new Response(JSON.stringify({
            error: error.message,
            code: 'WALLET_ERROR'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handleInitialize() {
    const walletDir = await initializeWallet();
    return new Response(JSON.stringify({
        success: true,
        message: 'Wallet directory initialized',
        walletDir
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleGenerate() {
    const wallet = await generateNewWallet();
    return new Response(JSON.stringify({
        success: true,
        wallet: {
            address: wallet.address,
            createdAt: wallet.createdAt,
            keyType: wallet.keyType
        }
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleGetCurrent() {
    const wallet = await getCurrentWallet();
    if (!wallet) {
        return new Response(JSON.stringify({
            success: false,
            message: 'No wallet found. Generate a new one first.',
            wallet: null
        }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
        success: true,
        wallet: {
            address: wallet.address,
            createdAt: wallet.createdAt,
            keyType: wallet.keyType,
            isActive: wallet.isActive
        }
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleGetDetails() {
    const rpcUrl = process.env.NEXT_PUBLIC_ZIPPYCOIN_RPC_URL || 'http://10.0.97.100:8545';
    const details = await getWalletDetails(rpcUrl);
    return new Response(JSON.stringify({
        success: true,
        details
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleGetStatus() {
    try {
        const wallet = await getCurrentWallet();
        return new Response(JSON.stringify({
            success: true,
            hasWallet: !!wallet,
            address: wallet?.address
        }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            hasWallet: false
        }), { headers: { 'Content-Type': 'application/json' } });
    }
}

async function handleExport() {
    const { exportWalletForBackup } = await import('@/lib/wallet-management');
    const backup = await exportWalletForBackup();
    return new Response(JSON.stringify({
        success: true,
        backup
    }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleRestore(body) {
    const { backup, overwrite } = body || {};
    if (!backup) {
        return new Response(JSON.stringify({ success: false, error: 'Missing backup payload' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    try {
        const wallet = await restoreWalletFromBackup(backup, { overwrite: !!overwrite });
        return new Response(JSON.stringify({
            success: true,
            message: 'Wallet restored',
            wallet: { address: wallet.address, createdAt: wallet.createdAt, keyType: wallet.keyType }
        }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({
            success: false,
            error: e.message || 'Restore failed'
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handleRemove(body) {
    const { confirmationCode } = body;
    try {
        await removeWallet(confirmationCode);
        return new Response(JSON.stringify({
            success: true,
            message: 'Wallet removed'
        }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        return new Response(JSON.stringify({
            error: error.message
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
}
