"use client";

import { useState, useEffect } from "react";
import { Badge, Toggle } from "@/shared/components";
import { useDevMode } from "./DevModeContext";
import { useSettings } from "@/shared/hooks";
import { formatRequestError, safeFetchJsonAll } from "@/shared/utils";

export default function ZippyStatusBar() {
    const { isDevOpen, toggleDevMode } = useDevMode();
    const { settings, updateSettings } = useSettings();
    const isDemoMode = settings?.isDemoMode || false;

    const [isConnected, setIsConnected] = useState(false);
    const [nodeInfo, setNodeInfo] = useState(null);
    const [walletInfo, setWalletInfo] = useState({ balance: 0, currency: 'ZIP' });
    const [isLoading, setIsLoading] = useState(true);
    const [isBroadcast, setIsBroadcast] = useState(false);
    const [nodeError, setNodeError] = useState("");
    const [walletError, setWalletError] = useState("");

    const [networkStats, setNetworkStats] = useState(nodeInfo?.stats || null);

    useEffect(() => {
        const checkStatus = async () => {
            try {
                // If in demo mode, override status and avoid blocking on API failures.
                if (isDemoMode) {
                    setIsConnected(true);
                    setNodeInfo({ node_id: "demo-node", status: "running" });
                    setWalletInfo({ balance: 10240, currency: "ZIP", address: "ZIP-DEMO" });
                    setNetworkStats({ peerCount: 42, health: 98 });
                    setNodeError("");
                    setWalletError("");
                    return;
                }

                const [nodeRes, walletRes] = await safeFetchJsonAll([
                    { key: "node", url: "/api/zippy/node" },
                    { key: "wallet", url: "/api/v1/wallet/balance" }
                ]);

                if (!nodeRes.ok) {
                    console.error("Node status check failed:", nodeRes.error);
                    setNodeError(formatRequestError("Node status unavailable", nodeRes, "Request failed"));
                    setIsConnected(false);
                    setNodeInfo(null);
                    setNetworkStats(null);
                } else {
                    const data = nodeRes.data || {};
                    const running = data.status === "running";
                    setIsConnected(running);
                    setNodeInfo(data);
                    setNetworkStats(data.stats || null);
                    setNodeError("");
                }

                if (!walletRes.ok) {
                    console.error("Wallet balance check failed:", walletRes.error);
                    setWalletError(formatRequestError("Wallet balance unavailable", walletRes, "Request failed"));
                } else {
                    const balData = walletRes.data || {};
                    setWalletInfo({
                        balance: balData.balance,
                        currency: balData.currency || "ZIP",
                        address: balData.address,
                        name: balData.name
                    });
                    setWalletError("");
                }
            } finally {
                setIsLoading(false);
            }

        };

        checkStatus();
        const interval = setInterval(checkStatus, 5000);
        return () => clearInterval(interval);
    }, [isDemoMode]);

    const handleToggle = async (enabled) => {
        if (isDemoMode) return; // Disable node control in demo mode
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
                setNodeError("");
            } else {
                const text = await res.text();
                let message = "Toggle failed";
                try {
                    const data = JSON.parse(text);
                    message = data?.error?.message || data?.error || message;
                } catch {
                    if (text) message = text.slice(0, 120);
                }
                setNodeError(formatRequestError("Node", { ok: false, status: res.status, error: message }, message));
            }
        } catch (error) {
            setNodeError(formatRequestError("Node", { ok: false, error: error?.message || "Network error" }, "Toggle failed"));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDemoToggle = async () => {
        try {
            await updateSettings({ isDemoMode: !isDemoMode });
        } catch (error) {
            console.error("Failed to toggle demo mode:", error);
        }
    };

    const protocolVersion = "1.0";
    const displayError = nodeError || walletError;
    const displayAddress = walletInfo.address
        ? `${walletInfo.address.substring(0, 10)}...${walletInfo.address.substring(walletInfo.address.length - 4)}`
        : nodeInfo?.node_id
            ? `${nodeInfo.node_id.substring(0, 6)}...${nodeInfo.node_id.substring(nodeInfo.node_id.length - 4)}`
            : "Not connected";

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
                {displayError && (
                    <Badge variant="warning" className="scale-90 px-1 py-0 text-[11px]">
                        {displayError}
                    </Badge>
                )}
                {isDemoMode && (
                    <Badge variant="warning" className="scale-75 font-black px-1 py-0! opacity-80">DEMO</Badge>
                )}
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
                <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-0.5 rounded-lg border border-border/50">
                    <button
                        onClick={toggleDevMode}
                        title="Toggle Developer Tools"
                        className={`flex flex-col items-center gap-0 group px-2 py-0.5 rounded transition-all ${isDevOpen ? 'bg-primary/20 text-primary' : 'hover:bg-white/5 text-text-muted'}`}
                    >
                        <span className="material-symbols-outlined text-[14px]">terminal</span>
                        <span className={`text-[7px] uppercase font-black ${isDevOpen ? 'text-primary' : 'text-text-muted group-hover:text-primary'}`}>Dev</span>
                    </button>
                    <button
                        onClick={handleDemoToggle}
                        title="Toggle Demo Mode (Simulated Data)"
                        className={`flex flex-col items-center gap-0 group px-2 py-0.5 rounded transition-all ${isDemoMode ? 'bg-primary/20 text-primary' : 'hover:bg-white/5 text-text-muted'}`}
                    >
                        <span className="material-symbols-outlined text-[14px]">visibility</span>
                        <span className={`text-[7px] uppercase font-black ${isDemoMode ? 'text-primary' : 'text-text-muted group-hover:text-primary'}`}>Demo</span>
                    </button>
                </div>

                <div className="flex flex-col items-center gap-0.5">
                    <span className="opacity-50 scale-75 uppercase font-bold tracking-widest leading-none">Node</span>
                    <Toggle
                        checked={isConnected}
                        onChange={handleToggle}
                        size="sm"
                        disabled={isDemoMode}
                    />
                </div>

                {isConnected && (
                    <div className="flex items-center gap-3 border-l border-white/10 pl-4">
                        <div className="flex flex-col">
                            <span className="opacity-50 scale-75 origin-left uppercase font-bold tracking-widest">
                                {walletInfo.name || "Wallet"}
                            </span>
                            <span className="font-mono text-[10px]">{displayAddress}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="opacity-50 scale-75 origin-right uppercase font-bold tracking-widest">Balance</span>
                            <span className="font-bold text-primary">{isDemoMode ? "10,240.0" : walletInfo.balance} {walletInfo.currency}</span>
                        </div>
                    </div>
                )}
            </div>


        </div>
    );
}
