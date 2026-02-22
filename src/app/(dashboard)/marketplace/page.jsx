"use client";

import { useState, useEffect } from "react";
import { Card, Button, Badge, Toggle, Input } from "@/shared/components";
import { getSidecarInfo, getWalletBalance } from "@/lib/sidecar";

export default function ZippyMeshMarketplace() {
    const [isProvider, setIsProvider] = useState(false);
    const [pricing, setPricing] = useState("0.05");
    const [stats, setStats] = useState({ requests: 0, earned: 0, balance: 1000 });
    const [transactions, setTransactions] = useState([]);
    const [nodeInfo, setNodeInfo] = useState(null);
    const [offers, setOffers] = useState([]);
    const [subscriptions, setSubscriptions] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const [info, marketplaceRes] = await Promise.all([
                getSidecarInfo(),
                fetch("/api/marketplace").then(res => res.json())
            ]);
            setNodeInfo(info);
            if (marketplaceRes.success) {
                setOffers(marketplaceRes.offers);
                setSubscriptions(marketplaceRes.subscriptions);
                setStats(prev => ({
                    ...prev,
                    earned: marketplaceRes.earnings || 0,
                    balance: marketplaceRes.balance || 0
                }));
                setTransactions(marketplaceRes.transactions || []);
            }
        } catch (error) {
            console.error("Failed to fetch marketplace data:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000); // Polling every 30s
        return () => clearInterval(interval);
    }, []);

    const handleToggleProvider = (val) => {
        setIsProvider(val);
        // Implement logic to update node broadcast status or mesh listing
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
        <div className="flex flex-col gap-6">
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
                            <span className="text-sm font-bold text-text-main leading-tight">{stats.balance.toFixed(2)} ZIPc</span>
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
                        <Toggle enabled={isProvider} onChange={handleToggleProvider} />
                    </div>

                    <p className="text-sm text-text-muted">
                        Enable this to allow discovery of your AI models by other ZippyMesh nodes.
                        You will receive micropayments in real-time as your services are consumed.
                    </p>

                    <div className="mt-4 flex flex-col gap-3">
                        <label className="text-sm font-medium text-text-muted">Pricing per 1k Tokens (ZIPc)</label>
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                value={pricing}
                                onChange={(e) => setPricing(e.target.value)}
                                className="flex-1"
                                placeholder="0.05"
                            />
                            <Button variant="secondary">Update</Button>
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
                                {transactions.slice().reverse().map(tx => (
                                    <div key={tx.id} className="flex items-center justify-between p-2 rounded bg-black/5 dark:bg-white/5 text-[10px]">
                                        <div className="flex flex-col">
                                            <span className="text-text-main font-medium">{tx.type === 'earn' ? 'Earned from' : 'Paid to'} {tx.offerId?.slice(0, 8) || 'Unknown'}</span>
                                            <span className="text-text-muted">{new Date(tx.timestamp).toLocaleTimeString()}</span>
                                        </div>
                                        <span className={`font-bold ${tx.type === 'earn' ? 'text-green-500' : 'text-primary'}`}>
                                            {tx.type === 'earn' ? '+' : '-'}{tx.amount.toFixed(2)} ZIPc
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </Card>
            </div>

            <Card className="p-6">
                <h2 className="text-xl font-semibold text-text-main mb-4">Discover Peer Nodes</h2>
                {loading && offers.length === 0 ? (
                    <div className="text-center py-12 animate-pulse text-text-muted">
                        Scanning network for ZippyMesh nodes...
                    </div>
                ) : offers.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-black/10 dark:border-white/10 rounded-xl">
                        <span className="material-symbols-outlined text-4xl text-text-muted mb-3">router</span>
                        <p className="text-text-muted">No peer nodes discovered in your local network yet.</p>
                        <p className="text-xs text-text-muted mt-1 italic">Make sure other nodes have P2P Beaconing enabled.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {offers.map(offer => (
                            <div key={offer.id} className="p-4 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex flex-col gap-3">
                                <div className="flex justify-between items-start">
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-text-main leading-tight">{offer.name}</span>
                                        <span className="text-[10px] text-text-muted font-mono uppercase tracking-tighter mt-1">{offer.id.slice(0, 8)}</span>
                                    </div>
                                    <Badge variant={isSubscribed(offer.id) ? "success" : "secondary"}>
                                        {isSubscribed(offer.id) ? "Subscribed" : "Available"}
                                    </Badge>
                                </div>
                                <div className="flex gap-4 text-xs text-text-muted">
                                    <span className="flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">timer</span>
                                        {offer.latency}ms
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">speed</span>
                                        {offer.tps} t/s
                                    </span>
                                </div>
                                <div className="mt-auto pt-2 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                                    <span className="text-sm font-bold text-primary">0.05 ZIPc <span className="text-[10px] text-text-muted font-normal">/ 1k</span></span>
                                    {!isSubscribed(offer.id) ? (
                                        <Button
                                            size="sm"
                                            className="px-3 py-1 text-xs"
                                            onClick={() => handleBuyAccess(offer)}
                                        >
                                            Buy Access
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
                <h2 className="text-xl font-semibold text-text-main mb-4">Discovery Status</h2>
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between p-3 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
                        <div className="flex items-center gap-3">
                            <span className={`w-3 h-3 rounded-full ${isProvider ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                            <span className="text-sm font-medium">Broadcast to ZippyMesh DHT</span>
                        </div>
                        <Badge variant={isProvider ? "success" : "secondary"}>
                            {isProvider ? "Public" : "Private"}
                        </Badge>
                    </div>

                    <p className="text-xs text-text-muted px-2">
                        {isProvider
                            ? "Your node is currently broadcasting its availability to the global Kademlia DHT. Other nodes can discover and route requests to you."
                            : "Your node is currently in private mode. No external service requests can reach you."}
                    </p>
                </div>
            </Card>
        </div>
    );
}
