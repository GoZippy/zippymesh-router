'use client';

/**
 * Wallet Management Component
 * Handles wallet generation, display, and management
 */

import React, { useState, useEffect, useRef } from 'react';
import { Copy, RefreshCw, Download, Trash2, Plus, Upload } from 'lucide-react';

export default function WalletManager() {
    const [wallet, setWallet] = useState(null);
    const [balance, setBalance] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showDetails, setShowDetails] = useState(false);
    const [copied, setCopied] = useState(false);

    // Load wallet on component mount
    useEffect(() => {
        loadWallet();
    }, []);

    const loadWallet = async () => {
        try {
            setLoading(true);
            setError(null);
            
            const response = await fetch('/api/mesh/wallet?action=details');
            const data = await response.json();

            if (data.success) {
                setWallet(data.details);
            } else if (data.wallet) {
                setWallet({
                    address: data.wallet.address,
                    balance: '0.000000',
                    nonce: 0
                });
            }
        } catch (err) {
            console.error('Failed to load wallet:', err);
            // Wallet might not exist yet
        } finally {
            setLoading(false);
        }
    };

    const generateWallet = async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch('/api/mesh/wallet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'generate' })
            });

            const data = await response.json();

            if (data.success) {
                setWallet(data.wallet);
                setError(null);
            } else {
                setError(data.error || 'Failed to generate wallet');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const copyAddress = () => {
        if (wallet?.address) {
            navigator.clipboard.writeText(wallet.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const exportWallet = async () => {
        try {
            const response = await fetch('/api/mesh/wallet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'export' })
            });

            const data = await response.json();

            if (data.success) {
                const element = document.createElement('a');
                element.setAttribute('href', `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data.backup, null, 2))}`);
                element.setAttribute('download', `zippycoin-wallet-backup-${Date.now()}.json`);
                element.style.display = 'none';
                document.body.appendChild(element);
                element.click();
                document.body.removeChild(element);
            } else {
                setError(data.error || 'Export failed');
            }
        } catch (err) {
            setError('Failed to export wallet');
        }
    };

    const fileInputRef = useRef(null);
    const [restoring, setRestoring] = useState(false);

    const restoreWallet = async (file, overwrite = false) => {
        if (!file) return;
        setRestoring(true);
        setError(null);
        try {
            const text = await file.text();
            const backup = JSON.parse(text);
            const response = await fetch('/api/mesh/wallet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'restore', backup, overwrite })
            });
            const data = await response.json();
            if (data.success) {
                await loadWallet();
            } else {
                if (data.error && data.error.includes('already exists') && !overwrite && window.confirm('A wallet already exists. Overwrite it with this backup?')) {
                    await restoreWallet(file, true);
                    return;
                }
                if (!data.success) setError(data.error || 'Restore failed');
            }
        } catch (err) {
            setError(err.message || 'Invalid backup file');
        } finally {
            setRestoring(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    if (loading && !wallet) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-center">
                    <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                    <p>Loading wallet...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-lg border border-gray-200">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">My ZippyCoin Wallet</h2>
                <p className="text-gray-600">Manage your wallet for mesh network participation</p>
            </div>

            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-700">{error}</p>
                </div>
            )}

            {!wallet ? (
                <div className="text-center py-8">
                    <p className="text-gray-600 mb-4">No wallet found. Create one to start participating.</p>
                    <button
                        onClick={generateWallet}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                    >
                        <Plus size={20} />
                        Generate New Wallet
                    </button>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Wallet Address */}
                    <div className="border rounded-lg p-4 bg-gray-50">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Wallet Address
                        </label>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 p-3 bg-white border rounded font-mono text-sm break-all">
                                {wallet.address}
                            </code>
                            <button
                                onClick={copyAddress}
                                className="p-2 hover:bg-gray-200 rounded transition-colors"
                                title="Copy address"
                            >
                                <Copy size={20} className={copied ? 'text-green-600' : 'text-gray-600'} />
                            </button>
                        </div>
                        {copied && <p className="text-green-600 text-sm mt-1">Copied!</p>}
                    </div>

                    {/* Balance */}
                    {wallet.balance !== undefined && (
                        <div className="border rounded-lg p-4 bg-gradient-to-r from-blue-50 to-indigo-50">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Balance
                            </label>
                            <div className="text-3xl font-bold text-blue-600">
                                {wallet.balance} ZIP
                            </div>
                            <p className="text-xs text-gray-600 mt-1">
                                {wallet.balanceWei} Wei
                            </p>
                        </div>
                    )}

                    {/* Detailed Information */}
                    <div className="border rounded-lg p-4">
                        <button
                            onClick={() => setShowDetails(!showDetails)}
                            className="flex items-center justify-between w-full"
                        >
                            <span className="font-semibold text-gray-800">Advanced Details</span>
                            <span className={`transform transition-transform ${showDetails ? 'rotate-180' : ''}`}>
                                ▼
                            </span>
                        </button>
                        
                        {showDetails && (
                            <div className="mt-4 space-y-3 border-t pt-4">
                                <div>
                                    <label className="text-xs font-semibold text-gray-600">Transaction Nonce</label>
                                    <p className="text-gray-800">{wallet.nonce || 0}</p>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-600">Key Type</label>
                                    <p className="text-gray-800">{wallet.keyType || 'hybrid'}</p>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-600">Created</label>
                                    <p className="text-gray-800">
                                        {wallet.createdAt ? new Date(wallet.createdAt).toLocaleString() : 'N/A'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-3 pt-4 border-t">
                        <button
                            onClick={loadWallet}
                            className="flex-1 min-w-[100px] flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                            title="Refresh wallet data"
                        >
                            <RefreshCw size={18} />
                            Refresh
                        </button>
                        <button
                            onClick={exportWallet}
                            className="flex-1 min-w-[100px] flex items-center justify-center gap-2 px-4 py-2 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                            title="Export wallet backup"
                        >
                            <Download size={18} />
                            Backup
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            className="hidden"
                            onChange={(e) => { const f = e.target?.files?.[0]; if (f) restoreWallet(f); }}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={restoring}
                            className="flex-1 min-w-[100px] flex items-center justify-center gap-2 px-4 py-2 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-50"
                            title="Restore from backup file"
                        >
                            <Upload size={18} />
                            {restoring ? 'Restoring…' : 'Restore'}
                        </button>
                    </div>

                    {/* Warning */}
                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-xs text-yellow-900 font-semibold mb-2">⚠️ Important Security Notice</p>
                        <ul className="text-xs text-yellow-800 space-y-1">
                            <li>• Private keys are stored locally on this machine only</li>
                            <li>• Never share your wallet address or backup with anyone</li>
                            <li>• Keep your backup file secure</li>
                            <li>• This wallet enables participation in the ZippyCoin mesh network</li>
                        </ul>
                    </div>
                </div>
            )}

            {/* Info Card */}
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-900">
                    <strong>Next Steps:</strong> With your wallet ready, you can now:
                </p>
                <ul className="text-sm text-blue-800 mt-2 ml-4 space-y-1 list-disc">
                    <li>Discover edge node providers</li>
                    <li>Submit inference requests through the mesh</li>
                    <li>Participate in governance voting</li>
                    <li>View your transaction history</li>
                </ul>
            </div>
        </div>
    );
}
