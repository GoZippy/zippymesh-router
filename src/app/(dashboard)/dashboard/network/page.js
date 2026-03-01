"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import Modal from "@/shared/components/Modal";
import Input from "@/shared/components/Input";

export default function NetworkPage() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [showConnectModal, setShowConnectModal] = useState(false);
    const [connectAddress, setConnectAddress] = useState("");
    const [isConnecting, setIsConnecting] = useState(false);

    const [providerNodes, setProviderNodes] = useState([]);
    const [localRuntimes, setLocalRuntimes] = useState([]);
    const [exposedProviders, setExposedProviders] = useState([]);
    const [savingMesh, setSavingMesh] = useState(false);
    const [connections, setConnections] = useState([]);
    const [wallets, setWallets] = useState([]);
    const [serviceRegistry, setServiceRegistry] = useState({ enabled: false, node_id: "", region: "", rpc_url: "" });

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

    async function fetchMeshConfig() {
        try {
            const [exposedRes, nodesRes, runtimesRes, connRes, regRes] = await Promise.all([
                fetch("/api/mesh/exposed-providers"),
                fetch("/api/provider-nodes"),
                fetch("/api/local-runtimes"),
                fetch("/api/mesh/connections"),
                fetch("/api/mesh/service-registry").catch(() => ({ ok: false })),
            ]);
            if (exposedRes.ok) {
                const d = await exposedRes.json();
                setExposedProviders(d.exposed || []);
            }
            if (nodesRes.ok) {
                const d = await nodesRes.json();
                setProviderNodes(d.nodes || []);
            }
            if (runtimesRes.ok) {
                const d = await runtimesRes.json();
                setLocalRuntimes(d.runtimes || []);
            }
            if (connRes.ok) {
                const d = await connRes.json();
                setConnections(d.connections || []);
                setWallets(d.wallets || []);
            }
        } catch (e) {
            console.error("Failed to fetch mesh config", e);
        }
    }

    async function handleUpdateConnection(peerId, walletIds, contractTerms) {
        try {
            const res = await fetch("/api/mesh/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "update",
                    peer_id: peerId,
                    wallet_ids: walletIds,
                    contract_terms: contractTerms,
                }),
            });
            if (res.ok) {
                const d = await res.json();
                setConnections(d.connections || []);
            }
        } catch (e) {
            console.error("Failed to update connection", e);
        }
    }

    async function handleSaveMeshProviders() {
        setSavingMesh(true);
        try {
            const [exposedRes, regRes] = await Promise.all([
                fetch("/api/mesh/exposed-providers", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ exposed: exposedProviders }),
                }),
                serviceRegistry.enabled
                    ? fetch("/api/mesh/service-registry", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(serviceRegistry),
                      })
                    : Promise.resolve({ ok: true }),
            ]);
            if (exposedRes.ok) {
                const d = await exposedRes.json();
                setExposedProviders(d.exposed || []);
                alert("Mesh provider config saved and published.");
            } else {
                alert("Failed to save.");
            }
            if (regRes?.ok && serviceRegistry.enabled) {
                await regRes.json();
            }
        } catch (e) {
            alert(`Error: ${e.message}`);
        } finally {
            setSavingMesh(false);
        }
    }

    function toggleExposed(id) {
        setExposedProviders((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    }

    useEffect(() => {
        fetchStatus();
        fetchMeshConfig();
        const interval = setInterval(fetchStatus, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!status?.peers?.length) return;
        const peers = status.peers;
        const peerIds = peers.map((p) => p.id || p.peer_id).filter(Boolean);
        setConnections((prev) => {
            const existing = new Set(prev.map((c) => c.peer_id));
            const added = peerIds.filter((id) => !existing.has(id));
            if (added.length === 0) return prev;
            return [...prev, ...added.map((peer_id) => ({ peer_id, wallet_ids: [], contract_terms: null }))];
        });
    }, [status?.peers]);

    if (loading && !status) {
        return <div className="p-8 text-center text-text-muted">Loading Network Status...</div>;
    }

    const nodeInfo = status?.info;
    const peers = status?.peers || [];

    return (
        <div className="p-6 space-y-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-text-main">
                        <span className="material-symbols-outlined text-primary text-2xl">hub</span>
                        ZippyMesh Network
                    </h1>
                    <p className="text-text-muted mt-1">
                        Decentralized AI Grid Status
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={() => setShowConnectModal(true)}
                        icon="add_link"
                    >
                        Connect Peer
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchStatus} disabled={refreshing} icon={refreshing ? "sync" : "refresh"} className={refreshing ? "animate-spin-icon" : ""}>
                        Refresh
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Node Identity Card */}
                <Card
                    title="Your Identity"
                    icon="dns"
                    className="md:col-span-2"
                >
                    <div className="space-y-4">
                        <div className="p-4 bg-muted/5 rounded-lg border border-black/5 dark:border-white/5">
                            <div className="text-sm font-medium text-text-muted mb-1">
                                Peer ID (Public Key)
                            </div>
                            <div className="flex items-center gap-2 font-mono text-sm break-all text-text-main">
                                {nodeInfo?.peer_id || "Offline / Not Connected"}
                                {nodeInfo?.peer_id && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={() => navigator.clipboard.writeText(nodeInfo.peer_id)}
                                        icon="content_copy"
                                    />
                                )}
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${nodeInfo ? "bg-green-500" : "bg-red-500"}`} />
                                <span className="text-sm font-medium text-text-main">
                                    {nodeInfo ? "Sidecar Online" : "Sidecar Offline"}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-sm text-text-muted">activity_zone</span>
                                <span className="text-sm text-text-main">Service: {nodeInfo?.service_type || "N/A"}</span>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Stats Card */}
                <Card title="Network Stats">
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-text-muted">Connected Peers</span>
                            <span className="text-2xl font-bold text-text-main">{peers.length}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-text-muted">Known Models</span>
                            <span className="text-2xl font-bold text-text-main">
                                {new Set(peers.flatMap(p => p.models.map(m => m.name))).size}
                            </span>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Mesh Provider Setup */}
            <Card
                title="Mesh Provider Setup"
                subtitle={
                    <>
                        Select providers to expose, or use{" "}
                        <Link href="/dashboard/monetization" className="text-primary underline">Monetization</Link>{" "}
                        to expose models by name only (provider stays private).
                    </>
                }
                icon="share"
            >
                <div className="space-y-4">
                    <div>
                        <div className="text-sm font-medium text-text-muted mb-2">Provider Nodes</div>
                        <div className="flex flex-wrap gap-2">
                            {providerNodes.length === 0 ? (
                                <span className="text-sm text-text-muted">No provider nodes. Add them in Providers.</span>
                            ) : (
                                providerNodes.map((n) => (
                                    <label
                                        key={n.id}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition ${
                                            exposedProviders.includes(n.id)
                                                ? "border-primary bg-primary/10"
                                                : "border-border hover:border-primary/50"
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={exposedProviders.includes(n.id)}
                                            onChange={() => toggleExposed(n.id)}
                                            className="rounded"
                                        />
                                        <span className="text-sm font-medium">{n.name || n.prefix}</span>
                                    </label>
                                ))
                            )}
                        </div>
                    </div>
                    <div>
                        <div className="text-sm font-medium text-text-muted mb-2">Local Runtimes</div>
                        <div className="flex flex-wrap gap-2">
                            {localRuntimes.map((r) => (
                                <label
                                    key={r.id}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition ${
                                        exposedProviders.includes(r.id)
                                            ? "border-primary bg-primary/10"
                                            : "border-border hover:border-primary/50"
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={exposedProviders.includes(r.id)}
                                        onChange={() => toggleExposed(r.id)}
                                        className="rounded"
                                    />
                                    <span className="text-sm font-medium">{r.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="mt-4 p-3 bg-sidebar/30 rounded-lg border border-border">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={serviceRegistry.enabled || false}
                                onChange={(e) => setServiceRegistry({ ...serviceRegistry, enabled: e.target.checked })}
                            />
                            <span className="text-sm">Register with ZippyCoin ServiceRegistry (when L2 is ready)</span>
                        </label>
                        {serviceRegistry.enabled && (
                            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                                <Input
                                    placeholder="Node ID"
                                    value={serviceRegistry.node_id || ""}
                                    onChange={(e) => setServiceRegistry({ ...serviceRegistry, node_id: e.target.value })}
                                />
                                <Input
                                    placeholder="Region"
                                    value={serviceRegistry.region || ""}
                                    onChange={(e) => setServiceRegistry({ ...serviceRegistry, region: e.target.value })}
                                />
                                <Input
                                    placeholder="RPC URL"
                                    value={serviceRegistry.rpc_url || ""}
                                    onChange={(e) => setServiceRegistry({ ...serviceRegistry, rpc_url: e.target.value })}
                                />
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end">
                        <Button onClick={handleSaveMeshProviders} disabled={savingMesh} loading={savingMesh}>
                            Publish to Mesh
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Node Connections - Wallet & Contract Config */}
            {peers.length > 0 && (
                <Card
                    title="Node Connections"
                    subtitle="Configure wallets and contract terms per peer connection."
                    icon="link"
                >
                    <div className="space-y-4">
                        {peers.map((peer) => {
                            const conn = connections.find((c) => c.peer_id === (peer.id || peer.peer_id));
                            const peerId = peer.id || peer.peer_id;
                            return (
                                <div key={peerId} className="p-4 border border-border rounded-lg">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="font-mono text-sm text-text-muted truncate max-w-xs">
                                            {String(peerId).substring(0, 24)}...
                                        </span>
                                        <Badge variant="secondary" size="sm">
                                            {peer.models?.length || 0} models
                                        </Badge>
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {wallets.map((w) => (
                                            <label
                                                key={w.id}
                                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer ${
                                                    (conn?.wallet_ids || []).includes(w.id)
                                                        ? "bg-primary/20 border border-primary"
                                                        : "border border-border"
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={(conn?.wallet_ids || []).includes(w.id)}
                                                    onChange={() => {
                                                        const current = conn?.wallet_ids || [];
                                                        const next = current.includes(w.id)
                                                            ? current.filter((x) => x !== w.id)
                                                            : [...current, w.id];
                                                        handleUpdateConnection(peerId, next, conn?.contract_terms);
                                                    }}
                                                />
                                                {w.name}
                                            </label>
                                        ))}
                                    </div>
                                    <div className="mt-2 text-xs text-text-muted">
                                        <button
                                            type="button"
                                            className="underline hover:text-primary"
                                            onClick={() => {
                                                const terms = conn?.contract_terms || { slaMs: 5000, minBalance: 10, autoRenew: false };
                                                if (confirm("Propose contract? (Stub - not implemented)")) {
                                                    handleUpdateConnection(peerId, conn?.wallet_ids || [], terms);
                                                }
                                            }}
                                        >
                                            Propose contract
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* Peers Table */}
            <Card title="Discovered Peers" padding="none">
                {peers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                        <span className="material-symbols-outlined text-4xl mb-4 opacity-50">wifi_find</span>
                        <p>No peers discovered yet.</p>
                        <p className="text-sm mt-1">Scanning local network... (DHT Bootstrapping)</p>
                        <Button
                            variant="ghost" // Changed to ghost to act like a link
                            onClick={() => setShowConnectModal(true)}
                            className="mt-2 text-purple-600 hover:text-purple-500 hover:bg-purple-500/10"
                        >
                            Manually Connect to Peer
                        </Button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-text-muted">
                            <thead className="text-xs text-text-muted uppercase bg-black/5 dark:bg-white/5">
                                <tr>
                                    <th className="px-6 py-3">Peer ID</th>
                                    <th className="px-6 py-3">Service</th>
                                    <th className="px-6 py-3">Pricing (ZIP/Token)</th>
                                    <th className="px-6 py-3">Models Offered</th>
                                    <th className="px-6 py-3">Latency</th>
                                </tr>
                            </thead>
                            <tbody>
                                {peers.map((peer) => (
                                    <TableRow key={peer.id || peer.peer_id} peer={peer} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Connect Peer Modal */}
            <Modal
                isOpen={showConnectModal}
                onClose={() => setShowConnectModal(false)}
                title="Connect to Peer"
                size="md"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setShowConnectModal(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConnect}
                            disabled={isConnecting || !connectAddress}
                            loading={isConnecting}
                        >
                            Connect
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <p className="text-sm text-text-muted">
                        Enter the Multiaddr of the peer you want to connect to.
                        <br />Example: <code className="bg-muted px-1 rounded text-xs">/ip4/192.168.1.5/tcp/4001/p2p/12D3...</code>
                    </p>
                    <Input
                        placeholder="/ip4/..."
                        value={connectAddress}
                        onChange={(e) => setConnectAddress(e.target.value)}
                        className="w-full"
                    />
                </div>
            </Modal>
        </div>
    );
}

function TableRow({ peer }) {
    return (
        <tr className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/5 dark:hover:bg-white/5 transition">
            <td className="px-6 py-4 font-mono text-xs text-text-muted">
                {(peer.id || peer.peer_id || "").substring(0, 16)}...
            </td>
            <td className="px-6 py-4">
                <Badge variant="outline">{peer.service_type || "Compute"}</Badge>
            </td>
            <td className="px-6 py-4">
                <div className="flex flex-col text-xs">
                    <span className="font-semibold text-green-500">
                        {peer.price_config ? peer.price_config.base_price_per_token : "Unknown"}
                    </span>
                    <span className="text-text-muted scale-90 origin-left">
                        Mult: x{peer.price_config ? peer.price_config.congestion_multiplier : "1.0"}
                    </span>
                </div>
            </td>
            <td className="px-6 py-4">
                <div className="flex flex-wrap gap-1">
                    {peer.models.map((m) => (
                        <Badge key={m.name} variant="secondary" size="sm">
                            {m.name}
                        </Badge>
                    ))}
                </div>
            </td>
            <td className="px-6 py-4 text-xs text-text-muted">
                {peer.latency_ms}ms
            </td>
        </tr>
    );
}
