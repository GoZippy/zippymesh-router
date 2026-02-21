"use client";

import { useEffect, useState } from "react";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Input from "@/shared/components/Input";
import Badge from "@/shared/components/Badge";

export default function WalletPage() {
    const [balance, setBalance] = useState(null);
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

    const [transactions, setTransactions] = useState([]);

    async function fetchData() {
        try {
            setRefreshing(true);
            const [balRes, priceRes, txRes] = await Promise.all([
                fetch("/api/v1/wallet/balance"),
                fetch("/api/v1/node/pricing"),
                fetch("/api/v1/wallet/transactions")
            ]);

            if (balRes.ok) {
                setBalance(await balRes.json());
            }
            if (priceRes.ok) {
                const p = await priceRes.json();
                if (p) setPricing(p);
            }
            if (txRes.ok) {
                setTransactions(await txRes.json());
            }
        } catch (error) {
            console.error("Failed to fetch data", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    async function handleSend(e) {
        e.preventDefault();
        if (!recipient || !amount) return;

        setIsSending(true);
        try {
            const res = await fetch("/api/v1/wallet/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: recipient, amount }),
            });

            if (res.ok) {
                alert(`Successfully sent ${amount} ZIP to ${recipient}`);
                setRecipient("");
                setAmount("");
                fetchData();
            } else {
                const err = await res.json();
                alert(`Transaction failed: ${err.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            setIsSending(false);
        }
    }

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

    useEffect(() => {
        fetchData();
    }, []);

    if (loading && !balance) {
        return <div className="p-8 text-center text-text-muted">Loading Wallet...</div>;
    }

    return (
        <div className="p-6 space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2 text-text-main">
                        <span className="material-symbols-outlined text-yellow-500 text-3xl">account_balance_wallet</span>
                        Zippy Wallet
                    </h1>
                    <p className="text-text-muted mt-1">
                        Manage your ZippyCoin (ZIP) earnings and payments.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing} icon={refreshing ? "sync" : "refresh"} className={refreshing ? "animate-spin-icon" : ""}>
                    Refresh
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Balance Card */}
                <Card
                    title="Total Balance"
                    className="bg-gradient-to-br from-zinc-900 to-zinc-950 text-white border-zinc-800"
                >
                    <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-bold tracking-tight">{balance?.balance?.toFixed(4) || "0.0000"}</span>
                        <span className="text-xl font-medium text-yellow-500">ZIP</span>
                    </div>
                    <div className="mt-4 p-3 bg-white/5 rounded-lg border border-white/10 flex items-center justify-between">
                        <div className="font-mono text-xs text-zinc-400 break-all mr-2">
                            {balance?.address || "Loading address..."}
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 hover:bg-white/10 text-zinc-400 p-0"
                            onClick={() => navigator.clipboard.writeText(balance?.address)}
                            icon="content_copy"
                        />
                    </div>
                </Card>

                {/* Send Card */}
                <Card
                    title="Send ZIP"
                    subtitle="Transfer tokens to another ZippyMesh node."
                    icon="send"
                >
                    <form onSubmit={handleSend} className="space-y-4">
                        <Input
                            label="Recipient Address"
                            placeholder="ZIP-..."
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            required
                        />
                        <Input
                            label="Amount (ZIP)"
                            type="number"
                            step="0.0001"
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
                            Send Transaction
                        </Button>
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
                title="Recent Transactions"
                icon="history"
                padding="none" // Use custom padding for table
            >
                {transactions.length === 0 ? (
                    <div className="text-center py-8 text-text-muted text-sm">
                        <span className="material-symbols-outlined text-4xl mb-2 opacity-20 block">receipt_long</span>
                        No recent transactions found.
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
                                {transactions.sort((a, b) => b.timestamp - a.timestamp).map((tx) => (
                                    <tr key={tx.id} className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/5 dark:hover:bg-white/5 transition">
                                        <td className="px-6 py-4">
                                            {new Date(tx.timestamp * 1000).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <Badge variant={tx.type === 'credit' ? 'success' : 'error'}>
                                                {tx.type}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 font-medium text-text-main">
                                            {tx.description}
                                        </td>
                                        <td className={`px-6 py-4 text-right font-mono font-bold ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                            {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(4)} ZIP
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
