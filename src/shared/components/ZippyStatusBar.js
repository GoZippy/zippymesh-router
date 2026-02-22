"use client";

import { useState, useEffect } from "react";
import { Badge, Toggle } from "@/shared/components";
import { getSidecarHealth, getSidecarInfo, getWalletBalance } from "@/lib/sidecar";
import { useDevMode } from "./DevModeContext";

export default function ZippyStatusBar() {
    const { isDevOpen, toggleDevMode } = useDevMode();
    const [isConnected, setIsConnected] = useState(false);
    const [nodeInfo, setNodeInfo] = useState(null);
    const [walletInfo, setWalletInfo] = useState({ balance: 0, currency: 'ZIP' });
    const [isLoading, setIsLoading] = useState(true);
    const [mode, setMode] = useState("Edge"); // Edge, Relay, Full Node, Validator
    const [isBroadcast, setIsBroadcast] = useState(false);

    const [networkStats, setNetworkStats] = useState(nodeInfo?.stats || null);

    useEffect(() => {
        const checkStatus = async () => {
            const healthy = await getSidecarHealth();
            setIsConnected(healthy);

            if (healthy) {
                const info = await getSidecarInfo();
                setNodeInfo(info);
                if (info.stats) setNetworkStats(info.stats);

                const balance = await getWalletBalance();
                setWalletInfo(balance);
            } else {
                setNodeInfo(null);
            }
            setIsLoading(false);
        };

        checkStatus();
        const interval = setInterval(checkStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleToggle = async (enabled) => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/zippy/node", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: enabled ? "start" : "stop",
                    mode: "edge",
                    broadcast: isBroadcast
                })
            });

            if (res.ok) {
                setIsConnected(enabled);
            } else {
                console.error("Failed to toggle node:", await res.text());
            }
        } catch (error) {
            console.error("Error toggling node:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const protocolVersion = "1.0";
    const walletAddress = nodeInfo?.node_id ? `${nodeInfo.node_id.substring(0, 6)}...${nodeInfo.node_id.substring(nodeInfo.node_id.length - 4)}` : "Not connected";

    return (
        <div className="flex items-center gap-4 bg-black/5 dark:bg-white/5 rounded-full px-4 py-1.5 border border-black/10 dark:border-white/10 text-xs backdrop-blur-md">
            <div className="flex items-center gap-2">
                <span className="font-bold text-primary flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">bolt</span>
                    ZippyCoin
                </span>
                <Badge variant={isConnected ? "success" : "secondary"} className="scale-90">
                    {isConnected ? "Connected" : "Offline"}
                </Badge>
            </div>

            <div className="h-4 w-px bg-black/10 dark:bg-white/10" />

            <div className="hidden md:flex items-center gap-3 text-text-muted">
                {isConnected && networkStats ? (
                    <>
                        <div className="flex flex-col">
                            <span className="opacity-50 scale-75 origin-left uppercase font-bold tracking-widest leading-none mb-0.5">Peers</span>
                            <span className="font-mono text-primary font-bold">{networkStats.peerCount}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="opacity-50 scale-75 origin-left uppercase font-bold tracking-widest leading-none mb-0.5">Health</span>
                            <div className="flex items-center gap-1">
                                <div className="h-1.5 w-8 bg-white/10 rounded-full overflow-hidden">
                                    <div className="h-full bg-green-500" style={{ width: `${networkStats.health}%` }} />
                                </div>
                                <span className="font-mono text-[10px]">{networkStats.health}%</span>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex flex-col">
                            <span className="opacity-50 scale-75 origin-left uppercase font-bold tracking-widest">Version</span>
                            <span className="font-mono">v1.0.0</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="opacity-50 scale-75 origin-left uppercase font-bold tracking-widest">Protocol</span>
                            <span className="font-mono">{protocolVersion}</span>
                        </div>
                    </>
                )}
            </div>

            <div className="h-4 w-px bg-black/10 dark:bg-white/10" />

            <div className="flex items-center gap-4 ml-2">
                <button
                    onClick={toggleDevMode}
                    className={`flex flex-col items-center gap-0.5 group px-2 py-0.5 rounded-md transition-all ${isDevOpen ? 'bg-orange-500/20 text-orange-500' : 'hover:bg-white/5 text-text-muted'}`}
                >
                    <span className="material-symbols-outlined text-sm">terminal</span>
                    <span className={`text-[8px] uppercase font-black ${isDevOpen ? 'text-orange-500' : 'text-text-muted group-hover:text-primary'}`}>Dev Mode</span>
                </button>

                <div className="flex flex-col items-center gap-0.5">
                    <span className="opacity-50 scale-75 uppercase font-bold tracking-widest leading-none">Node</span>
                    <Toggle
                        enabled={isConnected}
                        onChange={handleToggle}
                        size="sm"
                    />
                </div>

                {isConnected && (
                    <div className="flex items-center gap-3 border-l border-white/10 pl-4">
                        <div className="flex flex-col">
                            <span className="opacity-50 scale-75 origin-left uppercase font-bold tracking-widest">Wallet</span>
                            <span className="font-mono text-[10px]">{walletAddress}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="opacity-50 scale-75 origin-right uppercase font-bold tracking-widest">Balance</span>
                            <span className="font-bold text-primary">{walletInfo.balance} {walletInfo.currency}</span>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
