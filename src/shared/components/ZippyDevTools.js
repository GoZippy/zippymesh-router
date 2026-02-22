"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Badge, Button } from "@/shared/components";

export default function ZippyDevTools({ isOpen, onClose }) {
    const [logs, setLogs] = useState([]);
    const [stats, setStats] = useState(null);
    const [activeTab, setActiveTab] = useState("logs");
    const [dialMultiaddr, setDialMultiaddr] = useState("");
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;

        const fetchData = async () => {
            try {
                // Fetch logs
                const logRes = await fetch("/api/zippy/node?logs=true");
                if (logRes.ok) {
                    const contentType = logRes.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        const logData = await logRes.json();
                        setLogs(logData);
                    }
                }

                // Fetch full status
                const statusRes = await fetch("/api/zippy/node");
                if (statusRes.ok) {
                    const contentType = statusRes.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        const statusData = await statusRes.json();
                        setStats(statusData.stats);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch dev data:", error);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, [isOpen]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    if (!isOpen) return null;

    const handleDial = async () => {
        if (!dialMultiaddr) return;
        try {
            await fetch("/api/zippy/node", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "dialPeer", multiaddr: dialMultiaddr })
            });
            setDialMultiaddr("");
        } catch (e) {
            console.error("Dial failed", e);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center pointer-events-none">
            <div className="bg-black/80 backdrop-blur-xl border-t border-white/10 w-full max-w-7xl h-96 shadow-2xl pointer-events-auto flex flex-col clip-path-devtools">
                <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-white/5">
                    <div className="flex items-center gap-4">
                        <span className="text-orange-500 font-bold flex items-center gap-2">
                            <span className="material-symbols-outlined text-lg">terminal</span>
                            Zippy Console
                        </span>
                        <div className="flex gap-1">
                            {["logs", "network", "security"].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-3 py-1 text-[10px] uppercase font-bold tracking-widest rounded-md transition-all ${activeTab === tab ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        {stats && (
                            <div className="flex items-center gap-3 text-[10px] font-mono text-white/60">
                                <span>BLOCK: {stats.blockHeight}</span>
                                <span>PEERS: {stats.peerCount}</span>
                                <Badge variant={stats.health > 80 ? "success" : "warning"} className="scale-75">
                                    HEALTH: {stats.health}%
                                </Badge>
                            </div>
                        )}
                        <button onClick={onClose} className="text-white/40 hover:text-white">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </header>

                <main className="flex-1 overflow-hidden flex">
                    {activeTab === "logs" && (
                        <div
                            ref={scrollRef}
                            className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed select-text bg-black/40"
                        >
                            {logs.map((log, i) => (
                                <div key={i} className="flex gap-4 border-b border-white/5 py-1">
                                    <span className="text-white/20 shrink-0">{log.timestamp.split('T')[1].split('.')[0]}</span>
                                    <span className={`shrink-0 uppercase font-bold ${log.type === 'stdout' ? 'text-blue-400' : log.type === 'stderr' ? 'text-red-400' : 'text-orange-500'}`}>
                                        [{log.type}]
                                    </span>
                                    <span className="text-white/80 break-all">{log.line}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === "network" && (
                        <div className="flex-1 p-6 flex flex-col gap-6">
                            <div className="grid grid-cols-3 gap-6">
                                <Card className="p-4 bg-white/5 border-white/10 flex flex-col gap-2">
                                    <span className="text-[10px] uppercase font-bold text-white/40">Manual Connection</span>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="/ip4/1.2.3.4/tcp/9480/p2p/..."
                                            className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white placeholder:text-white/20"
                                            value={dialMultiaddr}
                                            onChange={(e) => setDialMultiaddr(e.target.value)}
                                        />
                                        <Button size="sm" onClick={handleDial}>Connect</Button>
                                    </div>
                                </Card>
                                <Card className="p-4 bg-white/5 border-white/10 flex flex-col gap-2">
                                    <span className="text-[10px] uppercase font-bold text-white/40">Trust Metrics</span>
                                    <div className="flex justify-between items-end">
                                        <span className="text-2xl font-bold font-mono text-orange-500">{stats?.trustScore || 0}</span>
                                        <span className="text-[10px] text-white/40 mb-1">SCORE INDEX</span>
                                    </div>
                                </Card>
                                <Card className="p-4 bg-white/5 border-white/10 flex flex-col gap-2">
                                    <span className="text-[10px] uppercase font-bold text-white/40">Network Latency</span>
                                    <div className="flex justify-between items-end">
                                        <span className="text-2xl font-bold font-mono text-blue-400">{stats?.latency || 0}ms</span>
                                        <span className="text-[10px] text-white/40 mb-1">AVG RTT</span>
                                    </div>
                                </Card>
                            </div>

                            <div className="flex-1 overflow-y-auto border border-white/10 rounded-lg bg-black/20">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-white/5 sticky top-0">
                                        <tr className="border-b border-white/10">
                                            <th className="px-4 py-2 font-bold uppercase tracking-widest text-[10px] text-white/40">Peer ID</th>
                                            <th className="px-4 py-2 font-bold uppercase tracking-widest text-[10px] text-white/40">Type</th>
                                            <th className="px-4 py-2 font-bold uppercase tracking-widest text-[10px] text-white/40">Status</th>
                                            <th className="px-4 py-2 font-bold uppercase tracking-widest text-[10px] text-white/40">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        <tr className="hover:bg-white/5">
                                            <td className="px-4 py-3 font-mono text-white/60">Zpy...9x4j</td>
                                            <td className="px-4 py-3"><Badge variant="outline" className="scale-75 origin-left">VALIDATOR</Badge></td>
                                            <td className="px-4 py-3 text-green-400">Stable</td>
                                            <td className="px-4 py-3"><button className="text-red-400 hover:text-red-300">Block</button></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === "security" && (
                        <div className="flex-1 p-8 text-center text-white/20">
                            <span className="material-symbols-outlined text-6xl mb-4">shield</span>
                            <h3 className="text-xl font-bold text-white/40">Firewall Rules</h3>
                            <p className="text-sm mt-2">IP and Wallet ID blocking features coming in next sprint.</p>
                        </div>
                    )}
                </main>
            </div>

            <style jsx>{`
                .clip-path-devtools {
                    clip-path: polygon(0% 10%, 2% 0%, 98% 0%, 100% 10%, 100% 100%, 0% 100%);
                }
            `}</style>
        </div>
    );
}
