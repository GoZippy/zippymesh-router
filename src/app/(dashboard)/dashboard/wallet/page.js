"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
        return <div className="p-8 text-center text-zinc-500">Loading Wallet...</div>;
    }

    return (
        <div className="p-6 space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-yellow-500 text-3xl">account_balance_wallet</span>
                        Zippy Wallet
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Manage your ZippyCoin (ZIP) earnings and payments.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing}>
                    <span className={`material-symbols-outlined text-sm mr-2 ${refreshing ? "animate-spin" : ""}`}>sync</span>
                    Refresh
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Balance Card */}
                <Card className="bg-gradient-to-br from-zinc-900 to-zinc-950 text-white border-zinc-800">
                    <CardHeader>
                        <CardTitle className="text-zinc-400 font-medium text-sm uppercase tracking-wider">Total Balance</CardTitle>
                    </CardHeader>
                    <CardContent>
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
                                size="icon"
                                className="h-6 w-6 hover:bg-white/10 text-zinc-400"
                                onClick={() => navigator.clipboard.writeText(balance?.address)}
                            >
                                <span className="material-symbols-outlined text-xs">content_copy</span>
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Send Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-purple-500">send</span>
                            Send ZIP
                        </CardTitle>
                        <CardDescription>Transfer tokens to another ZippyMesh node.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSend} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="recipient">Recipient Address</Label>
                                <Input
                                    id="recipient"
                                    placeholder="ZIP-..."
                                    value={recipient}
                                    onChange={(e) => setRecipient(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="amount">Amount (ZIP)</Label>
                                <Input
                                    id="amount"
                                    type="number"
                                    step="0.0001"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    required
                                />
                            </div>
                            <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700" disabled={isSending}>
                                {isSending ? (
                                    <>
                                        <span className="material-symbols-outlined animate-spin mr-2 text-sm">sync</span>
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <span className="material-symbols-outlined mr-2 text-sm">send</span>
                                        Send Transaction
                                    </>
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>

            {/* Pricing Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-green-500">sell</span>
                        Spot Pricing Configuration
                    </CardTitle>
                    <CardDescription>
                        Set the price you charge for serving LLM requests.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <Label>Base Price (ZIP/Token)</Label>
                            <Input
                                type="number" step="0.00001"
                                value={pricing.base_price_per_token}
                                onChange={(e) => setPricing({ ...pricing, base_price_per_token: parseFloat(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Min Price (ZIP/Token)</Label>
                            <Input
                                type="number" step="0.00001"
                                value={pricing.min_price_per_token}
                                onChange={(e) => setPricing({ ...pricing, min_price_per_token: parseFloat(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Congestion Multiplier</Label>
                            <Input
                                type="number" step="0.1"
                                value={pricing.congestion_multiplier}
                                onChange={(e) => setPricing({ ...pricing, congestion_multiplier: parseFloat(e.target.value) })}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end mt-4">
                        <Button onClick={handleSavePricing} disabled={savingPricing} variant="secondary">
                            {savingPricing ? "Saving..." : "Update Prices"}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Transaction History */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-zinc-500">history</span>
                        Recent Transactions
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {transactions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                            <span className="material-symbols-outlined text-4xl mb-2 opacity-20 block">receipt_long</span>
                            No recent transactions found.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left text-zinc-400">
                                <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/50">
                                    <tr>
                                        <th className="px-4 py-3 rounded-l-lg">Time</th>
                                        <th className="px-4 py-3">Type</th>
                                        <th className="px-4 py-3">Description</th>
                                        <th className="px-4 py-3 text-right rounded-r-lg">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.sort((a, b) => b.timestamp - a.timestamp).map((tx) => (
                                        <tr key={tx.id} className="border-b border-zinc-800 last:border-0 hover:bg-zinc-800/10 transition">
                                            <td className="px-4 py-3">
                                                {new Date(tx.timestamp * 1000).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant={tx.type === 'credit' ? 'default' : 'secondary'} className={tx.type === 'credit' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}>
                                                    {tx.type}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 font-medium text-zinc-300">
                                                {tx.description}
                                            </td>
                                            <td className={`px-4 py-3 text-right font-mono font-bold ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(4)} ZIP
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
