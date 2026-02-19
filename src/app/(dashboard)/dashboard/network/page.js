"use client";

import { useEffect, useState } from "react";
// import { Copy, RefreshCw, Network, Server, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

export default function NetworkPage() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [showConnectModal, setShowConnectModal] = useState(false);
    const [connectAddress, setConnectAddress] = useState("");
    const [isConnecting, setIsConnecting] = useState(false);

    async function fetchStatus() {
        try {
            setRefreshing(true);
            const res = await fetch("/api/v1/network/status");
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            }
        } catch (error) {
            console.error("Failed to fetch network status", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    const handleConnect = async () => {
        if (!connectAddress) return;
        setIsConnecting(true);
        try {
            const res = await fetch("/api/v1/network/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ multiaddr: connectAddress }),
            });
            if (res.ok) {
                alert("Connected to peer successfully!");
                setShowConnectModal(false);
                setConnectAddress("");
                fetchStatus();
            } else {
                const err = await res.json();
                alert(`Connection failed: ${err.error || "Unknown error"}`);
            }
        } catch (e) {
            alert(`Connection failed: ${e.message}`);
        } finally {
            setIsConnecting(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, []);

    if (loading && !status) {
        return <div className="p-8 text-center text-zinc-500">Loading Network Status...</div>;
    }

    const nodeInfo = status?.info;
    const peers = status?.peers || [];

    return (
        <div className="p-6 space-y-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-2xl">hub</span>
                        ZippyMesh Network
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Decentralized AI Grid Status
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={() => setShowConnectModal(true)}
                    >
                        <span className="material-symbols-outlined text-sm mr-2">add_link</span>
                        Connect Peer
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchStatus} disabled={refreshing}>
                        <span className={`material-symbols-outlined text-sm mr-2 ${refreshing ? "animate-spin" : ""}`}>sync</span>
                        Refresh
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Node Identity Card */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <span className="material-symbols-outlined text-lg">dns</span>
                            Your Identity
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 bg-muted/50 rounded-lg border border-border">
                            <div className="text-sm font-medium text-muted-foreground mb-1">
                                Peer ID (Public Key)
                            </div>
                            <div className="flex items-center gap-2 font-mono text-sm break-all">
                                {nodeInfo?.peer_id || "Offline / Not Connected"}
                                {nodeInfo?.peer_id && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => navigator.clipboard.writeText(nodeInfo.peer_id)}
                                    >
                                        <span className="material-symbols-outlined text-xs">content_copy</span>
                                    </Button>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${nodeInfo ? "bg-green-500" : "bg-red-500"}`} />
                                <span className="text-sm font-medium">
                                    {nodeInfo ? "Sidecar Online" : "Sidecar Offline"}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-sm text-muted-foreground">activity_zone</span>
                                <span className="text-sm">Service: {nodeInfo?.service_type || "N/A"}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Stats Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Network Stats</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Connected Peers</span>
                            <span className="text-2xl font-bold">{peers.length}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Known Models</span>
                            <span className="text-2xl font-bold">
                                {new Set(peers.flatMap(p => p.models.map(m => m.name))).size}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Peers Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Discovered Peers</CardTitle>
                </CardHeader>
                <CardContent>
                    {peers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <span className="material-symbols-outlined text-4xl mb-4 opacity-50">wifi_find</span>
                            <p>No peers discovered yet.</p>
                            <p className="text-sm mt-1">Scanning local network... (DHT Bootstrapping)</p>
                            <Button
                                variant="link"
                                onClick={() => setShowConnectModal(true)}
                                className="mt-2 text-purple-600"
                            >
                                Manually Connect to Peer
                            </Button>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Peer ID</TableHead>
                                    <TableHead>Service</TableHead>
                                    <TableHead>Pricing (ZIP/Token)</TableHead>
                                    <TableHead>Models Offered</TableHead>
                                    <TableHead>Last Seen</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {peers.map((peer) => (
                                    <TableRow key={peer.id || peer.peer_id}>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {(peer.id || peer.peer_id || "").substring(0, 16)}...
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{peer.service_type || "Compute"}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col text-xs">
                                                <span className="font-semibold text-green-500">
                                                    {peer.price_config ? peer.price_config.base_price_per_token : "Unknown"}
                                                </span>
                                                <span className="text-muted-foreground scale-90 origin-left">
                                                    Mult: x{peer.price_config ? peer.price_config.congestion_multiplier : "1.0"}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {peer.models.map((m) => (
                                                    <Badge key={m.name} variant="secondary" className="text-xs">
                                                        {m.name}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {peer.latency_ms}ms
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Connect Peer Modal */}
            {showConnectModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                        <h2 className="text-xl font-bold mb-4">Connect to Peer</h2>
                        <p className="text-sm text-muted-foreground mb-4">
                            Enter the Multiaddr of the peer you want to connect to.
                            <br />Example: <code className="bg-muted px-1 rounded text-xs">/ip4/192.168.1.5/tcp/4001/p2p/12D3...</code>
                        </p>
                        <input
                            type="text"
                            className="w-full bg-background border border-input rounded-md px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                            placeholder="/ip4/..."
                            value={connectAddress}
                            onChange={(e) => setConnectAddress(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="ghost"
                                onClick={() => setShowConnectModal(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleConnect}
                                disabled={isConnecting}
                                className="bg-purple-600 hover:bg-purple-700 text-white"
                            >
                                {isConnecting && <span className="animate-spin material-symbols-outlined text-sm mr-2">sync</span>}
                                Connect
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
