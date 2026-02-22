"use client";

import { useState, useEffect } from "react";
import { Card, Button, Badge, Toggle, Input } from "@/shared/components";
import { getSidecarInfo, getWalletBalance } from "@/lib/sidecar";

export default function ZippyMeshMarketplace() {
    const [isProvider, setIsProvider] = useState(false);
    const [pricing, setPricing] = useState("0.05");
    const [stats, setStats] = useState({ requests: 0, earned: 0 });
    const [nodeInfo, setNodeInfo] = useState(null);

    useEffect(() => {
        const fetchInfo = async () => {
            const info = await getSidecarInfo();
            setNodeInfo(info);
        };
        fetchInfo();
    }, []);

    const handleToggleProvider = (val) => {
        setIsProvider(val);
        // Implement logic to update node broadcast status or mesh listing
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
                <Badge variant={isProvider ? "success" : "secondary"} className="py-1 px-3">
                    {isProvider ? "Active Provider" : "Consumer Only"}
                </Badge>
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
                        <div className="text-xs text-text-muted text-center py-8 border border-dashed border-black/10 dark:border-white/10 rounded-lg">
                            No peer transactions recorded yet.
                        </div>
                    </div>
                </Card>
            </div>

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
