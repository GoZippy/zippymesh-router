"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, Button, Badge, Toggle, Input } from "@/shared/components";

export default function ZippyMeshMarketplace() {
    const [isProvider, setIsProvider] = useState(false);
    const [pricing, setPricing] = useState("0.0001");
    const [stats, setStats] = useState({ requests: 0, earned: 0, balance: 0 });
    const [transactions, setTransactions] = useState([]);
    const [offers, setOffers] = useState([]);
    const [subscriptions, setSubscriptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [togglingProvider, setTogglingProvider] = useState(false);
    const [updatingPricing, setUpdatingPricing] = useState(false);

    const fetchData = async () => {
        try {
            const [marketplaceRes, pricingRes, nodeRes] = await Promise.all([
                fetch("/api/marketplace").then(res => res.json()),
                fetch("/api/v1/node/pricing").then(res => res.ok ? res.json() : null).catch(() => null),
                fetch("/api/zippy/node").then(res => res.ok ? res.json() : null).catch(() => null)
            ]);
            if (marketplaceRes.success) {
                setOffers(marketplaceRes.offers || []);
                setSubscriptions(marketplaceRes.subscriptions || []);
                setStats(prev => ({
                    ...prev,
                    earned: marketplaceRes.earnings ?? prev.earned,
                    balance: typeof marketplaceRes.balance === 'number' ? marketplaceRes.balance : prev.balance
                }));
                setTransactions(marketplaceRes.transactions || []);
            }
            if (pricingRes?.base_price_per_token != null) {
                setPricing(String(pricingRes.base_price_per_token));
            }
            if (nodeRes?.config?.broadcast != null) {
                setIsProvider(!!nodeRes.config.broadcast);
            }
        } catch (error) {
            console.error("Failed to fetch marketplace data:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 15000);
        return () => clearInterval(interval);
    }, []);

    const handleToggleProvider = async (val) => {
        setTogglingProvider(true);
        try {
            const res = await fetch("/api/zippy/node", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: val ? "start" : "stop", broadcast: val })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed");
            setIsProvider(val);
        } catch (e) {
            console.error("Provider toggle failed:", e);
        } finally {
            setTogglingProvider(false);
        }
    };

    const handleUpdatePricing = async () => {
        setUpdatingPricing(true);
        try {
            const res = await fetch("/api/v1/node/pricing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ base_price_per_token: parseFloat(pricing) || 0.0001 })
            });
            if (res.ok) fetchData();
        } catch (e) {
            console.error("Pricing update failed:", e);
        } finally {
            setUpdatingPricing(false);
        }
    };

    const handleBuyAccess = async (offer) => {
        try {
            const res = await fetch("/api/marketplace", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ offerId: offer.id, name: offer.name })
            });
            const data = await res.json();
            if (data.success) {
                fetchData(); // Refresh lists
            }
        } catch (error) {
            console.error("Subscription failed:", error);
        }
    };

    const isSubscribed = (offerId) => {
        return subscriptions.some(s => s.offerId === offerId);
    };

    return (
        <div className="p-6 max-w-6xl mx-auto flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-text-main flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary text-3xl">hub</span>
                        ZippyMesh Marketplace
                    </h1>
                    <p className="text-text-muted mt-2">
                        Offer your LLM services to the ZippyMesh network and earn ZippyCoin tokens.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <Card className="py-1 px-4 border-primary/30 flex items-center gap-2 bg-primary/5">
                        <span className="material-symbols-outlined text-primary text-sm">payments</span>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-text-muted uppercase font-bold leading-none">Wallet Balance</span>
                            <span className="text-sm font-bold text-text-main leading-tight">{(typeof stats.balance === 'number' ? stats.balance : 0).toFixed(2)} ZIPc</span>
                        </div>
                    </Card>
                    <Badge variant={isProvider ? "success" : "secondary"} className="py-1 px-3">
                        {isProvider ? "Active Provider" : "Consumer Only"}
                    </Badge>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6 flex flex-col gap-4 border-primary/20">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold text-text-main">Provider Settings</h2>
                        <Toggle enabled={isProvider} onChange={handleToggleProvider} disabled={togglingProvider} />
                    </div>

                    <p className="text-sm text-text-muted">
                        Enable to broadcast your models to the mesh. Others can discover and route to you.
                        Configure which models to offer in{" "}
                        <Link href="/dashboard/monetization" className="text-primary underline">Monetization</Link>.
                    </p>

                    <div className="mt-4 flex flex-col gap-3">
                        <label className="text-sm font-medium text-text-muted">Base price per token (ZIP)</label>
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                step="0.00001"
                                value={pricing}
                                onChange={(e) => setPricing(e.target.value)}
                                className="flex-1"
                                placeholder="0.0001"
                            />
                            <Button variant="secondary" onClick={handleUpdatePricing} disabled={updatingPricing}>
                                {updatingPricing ? "..." : "Update"}
                            </Button>
                        </div>
                    </div>
                </Card>

                <Card className="p-6 flex flex-col gap-4">
                    <h2 className="text-xl font-semibold text-text-main">Provider Performance</h2>
                    <div className="grid grid-cols-2 gap-4 mt-2">
                        <div className="bg-black/5 dark:bg-white/5 rounded-xl p-4 flex flex-col">
                            <span className="text-text-muted text-xs uppercase font-bold tracking-widest">Total Requests</span>
                            <span className="text-2xl font-bold text-text-main">{stats.requests}</span>
                        </div>
                        <div className="bg-black/5 dark:bg-white/5 rounded-xl p-4 flex flex-col">
                            <span className="text-text-muted text-xs uppercase font-bold tracking-widest">Total Earned</span>
                            <span className="text-2xl font-bold text-primary">{stats.earned} ZIPc</span>
                        </div>
                    </div>

                    <div className="mt-4">
                        <h3 className="text-sm font-semibold text-text-main mb-2">Recent Mesh Transactions</h3>
                        {transactions.length === 0 ? (
                            <div className="text-xs text-text-muted text-center py-8 border border-dashed border-black/10 dark:border-white/10 rounded-lg">
                                No peer transactions recorded yet.
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 max-h-[150px] overflow-y-auto pr-1 custom-scrollbar">
                                {transactions.slice().reverse().map((tx, i) => (
                                    <div key={tx.id || i} className="flex items-center justify-between p-2 rounded bg-black/5 dark:bg-white/5 text-[10px]">
                                        <div className="flex flex-col">
                                            <span className="text-text-main font-medium">{tx.type === 'earn' ? 'Earned from' : 'Paid to'} {tx.offerId?.slice(0, 8) || 'Unknown'}</span>
                                            <span className="text-text-muted">{new Date(tx.timestamp).toLocaleTimeString()}</span>
                                        </div>
                                        <span className={`font-bold ${tx.type === 'earn' ? 'text-green-500' : 'text-primary'}`}>
                                            {tx.type === 'earn' ? '+' : '-'}{Number(tx.amount || 0).toFixed(2)} ZIPc
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </Card>
            </div>

            <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-text-main">Mesh Peers</h2>
                    <Link href="/dashboard/network">
                        <Button variant="outline" size="sm">Network →</Button>
                    </Link>
                </div>
                <p className="text-sm text-text-muted mb-4">
                    Peers discovered on the P2P mesh. Connect to more peers in{" "}
                    <Link href="/dashboard/network" className="text-primary underline">Network</Link>.
                </p>
                {loading && offers.length === 0 ? (
                    <div className="text-center py-12 animate-pulse text-text-muted">
                        Loading mesh peers...
                    </div>
                ) : offers.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-black/10 dark:border-white/10 rounded-xl">
                        <span className="material-symbols-outlined text-4xl text-text-muted mb-3">hub</span>
                        <p className="text-text-muted">No mesh peers discovered yet.</p>
                        <p className="text-sm text-text-muted mt-2">
                            Connect to peers in <Link href="/dashboard/network" className="text-primary underline">Network</Link> or ensure the sidecar is running.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {offers.map((offer, idx) => (
                            <div key={offer.id || `peer-${idx}`} className="p-4 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex flex-col gap-3">
                                <div className="flex justify-between items-start">
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-text-main leading-tight">{offer.name}</span>
                                        <span className="text-[10px] text-text-muted font-mono mt-1">{String(offer.id || "").slice(0, 12)}...</span>
                                    </div>
                                    <Badge variant={isSubscribed(offer.id) ? "success" : "default"}>
                                        {isSubscribed(offer.id) ? "Subscribed" : "Available"}
                                    </Badge>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs">
                                    {(offer.models || []).slice(0, 4).map((m) => (
                                        <span key={m.name || m} className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 text-text-muted">
                                            {typeof m === "object" ? m.name : m}
                                        </span>
                                    ))}
                                    {(offer.models || []).length > 4 && (
                                        <span className="text-text-muted">+{(offer.models || []).length - 4}</span>
                                    )}
                                </div>
                                <div className="flex gap-4 text-xs text-text-muted">
                                    <span className="flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">timer</span>
                                        {offer.latency || 0}ms
                                    </span>
                                </div>
                                <div className="mt-auto pt-2 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                                    <span className="text-sm font-bold text-primary">
                                        {offer.price_config?.base_price_per_token ?? "—"} ZIP <span className="text-[10px] text-text-muted font-normal">/ token</span>
                                    </span>
                                    {!isSubscribed(offer.id) ? (
                                        <Button size="sm" className="px-3 py-1 text-xs" onClick={() => handleBuyAccess(offer)}>
                                            Subscribe
                                        </Button>
                                    ) : (
                                        <Badge variant="success" className="bg-green-500/10 text-green-500 border-none px-2 py-0.5 text-[10px]">Active</Badge>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <Card className="p-6">
                <h2 className="text-xl font-semibold text-text-main mb-4">Quick Links</h2>
                <div className="flex flex-wrap gap-2">
                    <Link href="/dashboard/network">
                        <Button variant="outline" size="sm">Connect Peers</Button>
                    </Link>
                    <Link href="/dashboard/monetization">
                        <Button variant="outline" size="sm">Offer Models</Button>
                    </Link>
                    <Link href="/dashboard/wallet">
                        <Button variant="outline" size="sm">Wallet</Button>
                    </Link>
                </div>
                <p className="text-xs text-text-muted mt-3">
                    {isProvider ? "Broadcasting to mesh." : "Enable Provider above to broadcast your models."}
                </p>
            </Card>
        </div>
    );
}
