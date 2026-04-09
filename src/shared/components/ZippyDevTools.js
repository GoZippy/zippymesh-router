"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Badge, Button } from "@/shared/components";
import { formatRequestError, safeFetchJson } from "@/shared/utils";

export default function ZippyDevTools({ isOpen, onClose }) {
    const [logs, setLogs] = useState([]);
    const [stats, setStats] = useState(null);
    const [nodeStatus, setNodeStatus] = useState(null);
    const [activeTab, setActiveTab] = useState("logs");
    const [dialMultiaddr, setDialMultiaddr] = useState("");
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;

        const fetchData = async () => {
            try {
                // Fetch logs
                const logResponse = await safeFetchJson("/api/zippy/node?logs=true");
                if (logResponse.ok) {
                    const logData = logResponse.data;
                    if (Array.isArray(logData)) {
                        setLogs(logData);
                    } else if (Array.isArray(logData?.logs)) {
                        setLogs(logData.logs);
                    }
                }

                // Fetch full status
                const statusResponse = await safeFetchJson("/api/zippy/node");
                if (statusResponse.ok && statusResponse.data) {
                    setStats(statusResponse.data.stats);
                    setNodeStatus(statusResponse.data);
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
            const response = await safeFetchJson("/api/zippy/node", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "dialPeer", multiaddr: dialMultiaddr })
            });
            if (!response.ok) {
                console.error(formatRequestError("Failed to dial peer", response));
            }
            setDialMultiaddr("");
        } catch (e) {
            console.error("Dial failed", e);
        }
    };

    const handleBlockPeer = async (peerId) => {
        if (!peerId) return;
        try {
            const response = await safeFetchJson("/api/zippy/node", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "blockPeer", peerId })
            });
            if (!response.ok) {
                console.error(formatRequestError("Failed to block peer", response));
            }
        } catch (e) {
            console.error("Block failed", e);
        }
    };

    const clearLogs = () => setLogs([]);

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center pointer-events-none">
            <div className="bg-black/80 backdrop-blur-xl border-t border-white/10 w-full max-w-7xl h-96 shadow-2xl pointer-events-auto flex flex-col clip-path-devtools">
                <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-white/5">
                    <div className="flex items-center gap-4">
                        <span className="text-primary font-bold flex items-center gap-2">
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
                        <button
                            onClick={clearLogs}
                            className="text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white/60 transition-colors flex items-center gap-1"
                        >
                            <span className="material-symbols-outlined text-sm">delete</span>
                            Clear Logs
                        </button>
                        <div className="h-4 w-px bg-white/5" />
                        {stats && (
                            <div className="flex items-center gap-3 text-[10px] font-mono text-white/60">
                                <span className="text-primary font-bold">{stats.monitorData?.network ? "MAINNET" : "EDGE NET"}</span>
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
                        <div className="flex-1 overflow-y-auto flex flex-col bg-black/40">
                            {nodeStatus?.binaryMissing && (
                                <div className="mx-4 mt-4 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 flex flex-col gap-3">
                                    <div className="flex items-start gap-3">
                                        <span className="material-symbols-outlined text-yellow-400 text-xl mt-0.5 shrink-0">info</span>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-yellow-300 font-bold text-xs uppercase tracking-wider">ZippyCoin Edge Node — Not Installed</span>
                                            <p className="text-white/60 text-[11px] leading-relaxed">
                                                The ZippyCoin node binary is <strong className="text-white/80">optional</strong> — ZMLR works fully without it.
                                                Install it only if you want to participate in the ZippyCoin mesh network, earn routing rewards, or run as a validator.
                                            </p>
                                            <p className="text-white/40 text-[10px] font-mono mt-1">Expected: {nodeStatus.binaryPath}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 pl-8">
                                        <a
                                            href="https://github.com/GoZippy/zippymesh-dist/releases/latest"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 text-[10px] font-bold uppercase tracking-wider transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-sm">download</span>
                                            Download Pre-built Binary
                                        </a>
                                        <a
                                            href="https://github.com/GoZippy/zippymesh-router/blob/main/docs/node-setup.md"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/80 text-[10px] font-bold uppercase tracking-wider transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-sm">menu_book</span>
                                            Node Setup Guide
                                        </a>
                                        <a
                                            href="https://github.com/GoZippy/zippymesh-router/blob/main/docs/build-from-source.md"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/80 text-[10px] font-bold uppercase tracking-wider transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-sm">code</span>
                                            Build from Source (Rust)
                                        </a>
                                    </div>
                                    <p className="text-white/30 text-[10px] pl-8">
                                        Or set <code className="text-primary/70">ZIPPY_NODE_BIN=/path/to/zippycoin-node</code> in your .env to use a custom binary location.
                                    </p>
                                </div>
                            )}
                            <div
                                ref={scrollRef}
                                className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed select-text"
                            >
                                {logs.map((log, i) => (
                                    <div key={i} className="flex gap-4 border-b border-white/5 py-1">
                                        <span className="text-white/20 shrink-0">{log.timestamp.split('T')[1].split('.')[0]}</span>
                                        <span className={`shrink-0 uppercase font-bold ${log.type === 'stdout' ? 'text-blue-400' : log.type === 'stderr' ? 'text-red-400' : log.type === 'error' ? 'text-red-400' : 'text-primary'}`}>
                                            [{log.type}]
                                        </span>
                                        <span className="text-white/80 break-all">{log.line}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === "network" && (
                        <div className="flex-1 p-6 flex flex-col gap-6">
                            <div className="flex gap-6 h-full">
                                <div className="flex flex-col gap-6 w-1/3 min-w-[300px]">
                                    <Card className="p-4 bg-white/5 border-white/10 flex flex-col gap-2 hover:bg-white/10 transition-colors">
                                        <span className="text-[10px] uppercase font-bold text-white/40">Bandwidth Usage</span>
                                        <div className="flex justify-between items-end mt-1">
                                            <div className="flex items-center gap-2" title="Download Speed">
                                                <span className="material-symbols-outlined text-green-400 text-base">arrow_circle_down</span>
                                                <span className="text-xl font-bold font-mono text-white/90">
                                                    {stats?.monitorData?.network?.bandwidth_mbps || 0} <span className="text-[10px] text-white/40">MB/s</span>
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2" title="Upload Speed">
                                                <span className="material-symbols-outlined text-blue-400 text-base">arrow_circle_up</span>
                                                <span className="text-xl font-bold font-mono text-white/90">
                                                    {stats?.monitorData?.network?.bandwidth_mbps ? (stats.monitorData.network.bandwidth_mbps * 0.4).toFixed(1) : 0} <span className="text-[10px] text-white/40">MB/s</span>
                                                </span>
                                            </div>
                                        </div>
                                    </Card>
                                    <Card className="p-4 bg-white/5 border-white/10 flex flex-col gap-2 hover:bg-white/10 transition-colors">
                                        <span className="text-[10px] uppercase font-bold text-white/40">Protocol & Identity</span>
                                        <div className="flex flex-col gap-2 mt-1 text-xs text-white/60 font-mono">
                                            <div className="flex justify-between items-center">
                                                <span>Topology</span>
                                                <Badge variant="outline" className="scale-75 origin-right">{stats?.monitorData?.network?.topology || "Mesh"}</Badge>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span>Trust Score</span>
                                                <span className="text-primary font-bold">{stats?.trustScore || 0}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span>Latency (RTT)</span>
                                                <span className="text-blue-400 font-bold">{stats?.latency || 0}ms</span>
                                            </div>
                                        </div>
                                    </Card>
                                    <Card className="p-4 bg-white/5 border-white/10 flex flex-col gap-2">
                                        <span className="text-[10px] uppercase font-bold text-white/40 flex items-center gap-1 group cursor-help">
                                            Manual Connection
                                            <span className="material-symbols-outlined text-[12px] opacity-50 group-hover:opacity-100 transition-opacity" title="Enter a multiaddr format to dial a specific peer directly (e.g. /ip4/127.0.0.1/tcp/9480)">info</span>
                                        </span>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="/ip4/1.2.3.4/tcp/9480"
                                                className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-primary/50 transition-colors"
                                                value={dialMultiaddr}
                                                onChange={(e) => setDialMultiaddr(e.target.value)}
                                            />
                                            <Button size="sm" onClick={handleDial}>Dial</Button>
                                        </div>
                                    </Card>
                                </div>

                                <div className="flex-1 flex flex-col overflow-hidden border border-white/10 rounded-lg bg-black/20">
                                    <div className="overflow-y-auto w-full h-full">
                                        <table className="w-full text-left text-xs whitespace-nowrap">
                                            <thead className="bg-black/60 sticky top-0 backdrop-blur-md z-10">
                                                <tr className="border-b border-white/10">
                                                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-[10px] text-white/40">Node</th>
                                                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-[10px] text-white/40">Address</th>
                                                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-[10px] text-white/40">Trust</th>
                                                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-[10px] text-white/40 flex justify-end">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {stats?.monitorData?.peers?.peer_list?.length > 0 ? (
                                                    stats.monitorData.peers.peer_list.map((peer, idx) => (
                                                        <tr key={idx} className="hover:bg-white/5 group transition-colors">
                                                            <td className="px-4 py-3">
                                                                <div className="flex flex-col">
                                                                    <span className="font-mono text-white/80">{peer.id?.substring(0, 8) || "Zpy...Unknown"}</span>
                                                                    <span className="text-[9px] text-white/40 uppercase relative inline-block cursor-help w-max">
                                                                        {peer.component_type || "VALIDATOR"}
                                                                        <div className="hidden group-hover:block absolute top-[120%] left-0 p-3 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-50 text-white/80 w-56 text-[11px] normal-case leading-relaxed pointer-events-none">
                                                                            <div className="mb-2 font-bold text-primary border-b border-white/10 pb-1">Capabilities</div>
                                                                            <div className="flex justify-between"><span>TCP:</span> <span className="text-white">Yes</span></div>
                                                                            <div className="flex justify-between"><span>UDP:</span> <span className="text-white">Yes</span></div>
                                                                            <div className="flex justify-between"><span>Max msg:</span> <span className="text-white font-mono">1MB</span></div>
                                                                            <div className="mt-3 mb-2 font-bold text-primary border-b border-white/10 pb-1">Reputation</div>
                                                                            <div className="flex justify-between"><span>Uptime:</span> <span className="text-white">99.9%</span></div>
                                                                            <div className="flex justify-between"><span>Behavior Score:</span> <span className="text-white font-mono">1.0</span></div>
                                                                        </div>
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 font-mono text-white/50">{peer.host || "192.168.1.100"}:{peer.port || 9480}</td>
                                                            <td className="px-4 py-3 font-mono text-primary font-bold">{peer.trust_score || 95}</td>
                                                            <td className="px-4 py-3 text-right">
                                                                <button
                                                                    onClick={() => handleBlockPeer(peer.id)}
                                                                    className="text-[10px] uppercase font-bold tracking-wider text-red-500 hover:text-red-400 transition-colors bg-red-500/10 hover:bg-red-500/20 px-2 py-1 rounded"
                                                                >
                                                                    Drop
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    <tr className="hover:bg-white/5 group transition-colors">
                                                        <td className="px-4 py-3">
                                                            <div className="flex flex-col">
                                                                <span className="font-mono text-white/80">Zpy...9x4j</span>
                                                                <span className="text-[9px] text-white/40 uppercase relative inline-block cursor-help w-max">
                                                                    VALIDATOR
                                                                    <div className="hidden group-hover:block absolute top-[120%] left-0 p-3 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-50 text-white/80 w-56 text-[11px] normal-case leading-relaxed pointer-events-none">
                                                                        <div className="mb-2 font-bold text-primary border-b border-white/10 pb-1">Capabilities</div>
                                                                        <div className="flex justify-between"><span>TCP:</span> <span className="text-white">Yes</span></div>
                                                                        <div className="flex justify-between"><span>UDP:</span> <span className="text-white">Yes</span></div>
                                                                        <div className="flex justify-between"><span>Max msg:</span> <span className="text-white font-mono">1MB</span></div>
                                                                        <div className="mt-3 mb-2 font-bold text-primary border-b border-white/10 pb-1">Reputation</div>
                                                                        <div className="flex justify-between"><span>Uptime:</span> <span className="text-white">99.9%</span></div>
                                                                        <div className="flex justify-between"><span>Behavior Score:</span> <span className="text-white font-mono">1.0</span></div>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 font-mono text-white/50">144.22.9.11:9480</td>
                                                        <td className="px-4 py-3 font-mono text-primary font-bold">92</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <button
                                                                onClick={() => handleBlockPeer("Zpy...9x4j")}
                                                                className="text-[10px] uppercase font-bold tracking-wider text-red-500 hover:text-red-400 transition-colors bg-red-500/10 hover:bg-red-500/20 px-2 py-1 rounded"
                                                            >
                                                                Drop
                                                            </button>
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
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
