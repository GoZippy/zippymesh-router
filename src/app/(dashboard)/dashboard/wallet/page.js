"use client";

import { useEffect, useState } from "react";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Input from "@/shared/components/Input";
import Badge from "@/shared/components/Badge";

export default function WalletPage() {
    const [wallets, setWallets] = useState([]);
    const [activeWallet, setActiveWallet] = useState(null);
    const [pricing, setPricing] = useState({
        base_price_per_token: 0.0001,
        min_price_per_token: 0.00005,
        congestion_multiplier: 1.0,
    });

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [savingPricing, setSavingPricing] = useState(false);

    // Send State
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    const [isSending, setIsSending] = useState(false);

    // Add Wallet State
    const [showAddWallet, setShowAddWallet] = useState(false);
    const [newWallet, setNewWallet] = useState({ name: "", address: "", privateKey: "" });
    const [isAdding, setIsAdding] = useState(false);

    const [transactions, setTransactions] = useState([]);

    async function fetchData() {
        try {
            setRefreshing(true);
            const [walletsRes, priceRes] = await Promise.all([
                fetch("/api/v1/wallet"),
                fetch("/api/v1/node/pricing")
            ]);

            if (walletsRes.ok) {
                const w = await walletsRes.json();
                setWallets(w);
                if (w.length > 0 && !activeWallet) {
                    const defaultWallet = w.find(x => x.isDefault) || w[0];
                    setActiveWallet(defaultWallet);
                }
            }
            if (priceRes.ok) {
                const p = await priceRes.json();
                if (p) setPricing(p);
            }
        } catch (error) {
            console.error("Failed to fetch data", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    async function fetchTransactions(walletId) {
        if (!walletId) return;
        try {
            const res = await fetch(`/api/v1/wallet/transactions?walletId=${walletId}`);
            if (res.ok) {
                setTransactions(await res.json());
            }
        } catch (error) {
            console.error("Failed to fetch transactions", error);
        }
    }

    useEffect(() => {
        if (activeWallet) {
            fetchTransactions(activeWallet.id);
        }
    }, [activeWallet?.id]);

    async function handleSavePricing() {
        setSavingPricing(true);
        try {
            const res = await fetch("/api/v1/node/pricing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(pricing),
            });
            if (res.ok) {
                alert("Pricing configuration updated!");
                const updated = await res.json();
                setPricing(updated);
            } else {
                alert("Failed to update pricing");
            }
        } catch (e) {
            alert("Error updating pricing");
        } finally {
            setSavingPricing(false);
        }
    }

    async function handleAddWallet(e) {
        e.preventDefault();
        if (!newWallet.name || !newWallet.address) return;

        setIsAdding(true);
        try {
            const res = await fetch("/api/v1/wallet", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newWallet),
            });

            if (res.ok) {
                const created = await res.json();
                setWallets([...wallets, created]);
                setShowAddWallet(false);
                setNewWallet({ name: "", address: "", privateKey: "" });
                if (!activeWallet) setActiveWallet(created);
            } else {
                const err = await res.json();
                alert(`Failed to add wallet: ${err.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            setIsAdding(false);
        }
    }

    useEffect(() => {
        fetchData();
    }, []);

    if (loading && wallets.length === 0) {
        return <div className="p-8 text-center text-text-muted">Loading Wallets...</div>;
    }

    return (
        <div className="p-6 space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2 text-text-main">
                        <span className="material-symbols-outlined text-indigo-500 text-3xl">account_balance_wallet</span>
                        Zippy Wallets
                    </h1>
                    <p className="text-text-muted mt-1">
                        Securely manage your ZPC/ZIPc assets and payment channels.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowAddWallet(true)} icon="add">
                        Add Wallet
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing} icon={refreshing ? "sync" : "refresh"} className={refreshing ? "animate-spin-icon" : ""}>
                        Refresh
                    </Button>
                </div>
            </div>

            {showAddWallet && (
                <Card title="Add / Import Wallet" icon="account_balance_wallet">
                    <form onSubmit={handleAddWallet} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="Wallet Name"
                                placeholder="My Savings"
                                value={newWallet.name}
                                onChange={(e) => setNewWallet({ ...newWallet, name: e.target.value })}
                                required
                            />
                            <Input
                                label="Public Address"
                                placeholder="0x..."
                                value={newWallet.address}
                                onChange={(e) => setNewWallet({ ...newWallet, address: e.target.value })}
                                required
                            />
                        </div>
                        <Input
                            label="Private Key (optional, will be encrypted)"
                            type="password"
                            placeholder="Your private key..."
                            value={newWallet.privateKey}
                            onChange={(e) => setNewWallet({ ...newWallet, privateKey: e.target.value })}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setShowAddWallet(false)}>Cancel</Button>
                            <Button type="submit" loading={isAdding}>Add Wallet</Button>
                        </div>
                    </form>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Wallet List */}
                <Card title="Your Wallets" padding="none" className="md:row-span-2">
                    <div className="divide-y divide-black/5 dark:divide-white/5">
                        {wallets.length === 0 ? (
                            <div className="p-8 text-center text-text-muted text-sm italic">
                                No wallets found.
                            </div>
                        ) : (
                            wallets.map(w => (
                                <div
                                    key={w.id}
                                    onClick={() => setActiveWallet(w)}
                                    className={`p-4 cursor-pointer transition flex items-center justify-between hover:bg-black/5 dark:hover:bg-white/5 ${activeWallet?.id === w.id ? 'bg-indigo-500/10 border-l-4 border-indigo-500' : ''}`}
                                >
                                    <div>
                                        <div className="font-bold text-text-main flex items-center gap-2 text-sm">
                                            {w.name}
                                            {w.isDefault && <Badge variant="info" className="text-[10px] px-1 py-0 h-4">Default</Badge>}
                                        </div>
                                        <div className="text-[10px] font-mono text-text-muted truncate w-32">
                                            {w.address}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-indigo-500 text-sm">{w.balance?.toFixed(2)}</div>
                                        <div className="text-[10px] text-text-muted uppercase">ZIPc</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </Card>

                {/* Active Wallet Detail Card */}
                <Card
                    title={activeWallet ? activeWallet.name : "Select a Wallet"}
                    className="bg-gradient-to-br from-indigo-900 to-indigo-950 text-white border-indigo-800 md:col-span-2"
                >
                    <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-bold tracking-tight">{activeWallet?.balance?.toFixed(4) || "0.0000"}</span>
                        <span className="text-xl font-medium text-indigo-300">ZIPc</span>
                    </div>
                    <div className="mt-4 p-3 bg-white/5 rounded-lg border border-white/10 flex items-center justify-between">
                        <div className="font-mono text-xs text-indigo-200 break-all mr-2">
                            {activeWallet?.address || "No address selected"}
                        </div>
                        {activeWallet && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 hover:bg-white/10 text-indigo-200 p-0"
                                onClick={() => navigator.clipboard.writeText(activeWallet.address)}
                                icon="content_copy"
                            />
                        )}
                    </div>
                </Card>

                {/* Send Card */}
                <Card
                    title="Send Assets"
                    subtitle="Secure Layer-2 peer-to-peer transfer."
                    icon="send"
                    className="md:col-span-2"
                >
                    <form onSubmit={handleSend} className="space-y-4">
                        {!activeWallet ? (
                            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-500 text-sm">
                                Please select a wallet from the sidebar to send ZIPc.
                            </div>
                        ) : (
                            <>
                                <Input
                                    label="Recipient Address"
                                    placeholder="0x..."
                                    value={recipient}
                                    onChange={(e) => setRecipient(e.target.value)}
                                    required
                                />
                                <Input
                                    label="Amount (ZIPc)"
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    required
                                />
                                <Button
                                    type="submit"
                                    fullWidth
                                    disabled={isSending}
                                    loading={isSending}
                                    icon="send"
                                >
                                    Confirm Transfer
                                </Button>
                            </>
                        )}
                    </form>
                </Card>
            </div>

            {/* Pricing Section */}
            <Card
                title="Spot Pricing Configuration"
                subtitle="Set the price you charge for serving LLM requests."
                icon="sell"
            >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Input
                        label="Base Price (ZIP/Token)"
                        type="number" step="0.00001"
                        value={pricing.base_price_per_token}
                        onChange={(e) => setPricing({ ...pricing, base_price_per_token: parseFloat(e.target.value) })}
                    />
                    <Input
                        label="Min Price (ZIP/Token)"
                        type="number" step="0.00001"
                        value={pricing.min_price_per_token}
                        onChange={(e) => setPricing({ ...pricing, min_price_per_token: parseFloat(e.target.value) })}
                    />
                    <Input
                        label="Congestion Multiplier"
                        type="number" step="0.1"
                        value={pricing.congestion_multiplier}
                        onChange={(e) => setPricing({ ...pricing, congestion_multiplier: parseFloat(e.target.value) })}
                    />
                </div>
                <div className="flex justify-end mt-4">
                    <Button onClick={handleSavePricing} disabled={savingPricing} variant="secondary" loading={savingPricing}>
                        Update Prices
                    </Button>
                </div>
            </Card>

            {/* Transaction History */}
            <Card
                title={`${activeWallet?.name || 'Wallet'} Transaction History`}
                icon="history"
                padding="none"
            >
                {transactions.length === 0 ? (
                    <div className="text-center py-8 text-text-muted text-sm">
                        <span className="material-symbols-outlined text-4xl mb-2 opacity-20 block">receipt_long</span>
                        No recent transactions found for this wallet.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-text-muted">
                            <thead className="text-xs text-text-muted uppercase bg-black/5 dark:bg-white/5">
                                <tr>
                                    <th className="px-6 py-3">Time</th>
                                    <th className="px-6 py-3">Type</th>
                                    <th className="px-6 py-3">Description</th>
                                    <th className="px-6 py-3 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.length > 0 && transactions.map((tx) => (
                                    <tr key={tx.id} className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/5 dark:hover:bg-white/5 transition">
                                        <td className="px-6 py-4">
                                            {tx.timestamp.includes('T') ? new Date(tx.timestamp).toLocaleString() : new Date(parseInt(tx.timestamp) * 1000).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <Badge variant={tx.type === 'receive' || tx.type === 'credit' ? 'success' : 'error'}>
                                                {tx.type}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 font-medium text-text-main max-w-xs truncate">
                                            {tx.description || tx.txHash || 'N/A'}
                                        </td>
                                        <td className={`px-6 py-4 text-right font-mono font-bold ${(tx.type === 'receive' || tx.type === 'credit') ? 'text-green-500' : 'text-red-500'}`}>
                                            {(tx.type === 'receive' || tx.type === 'credit') ? '+' : '-'}{tx.amount.toFixed(2)} {tx.symbol || 'ZIPc'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
