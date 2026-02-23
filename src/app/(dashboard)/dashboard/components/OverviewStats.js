"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardSkeleton, Badge, Button } from "@/shared/components";
import BarChart from "@/shared/components/BarChart";

export default function OverviewStats() {
    const [stats, setStats] = useState(null);
    const [sidecarStatus, setSidecarStatus] = useState("checking");
    const [loading, setLoading] = useState(true);

    // Poll for updates every 10s
    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 10000);
        return () => clearInterval(interval);
    }, []);

    const fetchStats = async () => {
        try {
            // Fetch usage stats
            const res = await fetch("/api/usage/history");
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }

            // Fetch sidecar health
            const sidecarRes = await fetch("/api/sidecar/health");
            if (sidecarRes.ok) {
                const data = await sidecarRes.json();
                setSidecarStatus(data.status);
            } else {
                setSidecarStatus("disconnected");
            }
        } catch (error) {
            console.error("Failed to fetch overview stats:", error);
            setSidecarStatus("disconnected");
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <CardSkeleton />
                    <CardSkeleton />
                    <CardSkeleton />
                    <CardSkeleton />
                </div>
                <CardSkeleton />
            </div>
        );
    }

    if (!stats) return <div className="text-text-muted">Failed to load overview.</div>;

    // Process Stats (Last 24 Hours)
    const last24h = stats.last24Hours || [];
    const total24hRequests = last24h.reduce((acc, curr) => acc + curr.requests, 0);
    const total24hErrors = last24h.reduce((acc, curr) => acc + (curr.errors || 0), 0);
    const total24hCost = last24h.reduce((acc, curr) => acc + curr.cost, 0);

    // Calculate Error Rate
    const errorRate = total24hRequests > 0 ? (total24hErrors / total24hRequests) * 100 : 0;

    // Determine System Status
    let statusColor = "bg-green-500";
    let statusText = "Operational";
    if (errorRate > 5) {
        statusColor = "bg-red-500";
        statusText = "Critical Issues";
    } else if (errorRate > 1) {
        statusColor = "bg-yellow-500";
        statusText = "Degraded Performance";
    }

    // Active Providers (approximate from active requests or recent history - simplified to active connections count from state if available, but here we only have usage stats. 
    // We'll use "Active Requests" count as a proxy for engagement)
    const activeRequestCount = (stats.activeRequests || []).length;

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold">System Overview</h1>
                    <div className="flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-surface border border-border">
                        <div className={`w-2 h-2 rounded-full ${statusColor} animate-pulse`} />
                        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">{statusText}</span>
                    </div>
                    {stats.isDemo && (
                        <Badge variant="warning" className="font-black animate-bounce px-2">DEMO DATA ACTIVE</Badge>
                    )}
                </div>
                <div className="text-sm text-text-muted">Last 24 Hours</div>

            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4 flex flex-col justify-between gap-4">
                    <div>
                        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">Requests (24h)</p>
                        <h3 className="text-2xl font-bold mt-1">{total24hRequests.toLocaleString()}</h3>
                    </div>
                    <div className="h-8">
                        <BarChart
                            data={last24h.map(h => h.requests)}
                            colorClass="bg-blue-500/50"
                            showTooltip={false}
                        />
                    </div>
                </Card>

                <Card className="p-4 flex flex-col justify-between gap-4">
                    <div>
                        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">Error Rate</p>
                        <div className="flex items-end gap-2 mt-1">
                            <h3 className={`text-2xl font-bold ${errorRate > 1 ? "text-red-500" : "text-text-main"}`}>
                                {errorRate.toFixed(2)}%
                            </h3>
                            <span className="text-xs text-text-muted mb-1">{total24hErrors} failures</span>
                        </div>
                    </div>
                    <div className="h-8">
                        <BarChart
                            data={last24h.map(h => h.errors || 0)}
                            colorClass="bg-red-500/50"
                            showTooltip={false}
                        />
                    </div>
                </Card>

                <Card className="p-4 flex flex-col justify-between gap-4">
                    <div>
                        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">Est. Cost (24h)</p>
                        <h3 className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">
                            ${total24hCost.toFixed(4)}
                        </h3>
                    </div>
                    <div className="h-8">
                        <BarChart
                            data={last24h.map(h => h.cost)}
                            colorClass="bg-green-500/50"
                            showTooltip={false}
                        />
                    </div>
                </Card>

                <Card className="p-4 flex flex-col justify-between gap-4">
                    <div>
                        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">Pending Requests</p>
                        <h3 className="text-2xl font-bold mt-1">{activeRequestCount}</h3>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                        <span className="material-symbols-outlined text-[16px]">sync</span>
                        Real-time
                    </div>
                </Card>
            </div>

            {/* Main Charts Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Throughput Chart */}
                <Card className="lg:col-span-2 p-6 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Throughput</h3>
                        <span className="text-xs text-text-muted">Requests / Hour</span>
                    </div>
                    <div className="h-48 w-full flex items-end">
                        <BarChart
                            data={last24h.map(h => h.requests)}
                            colorClass="bg-primary/80 hover:bg-primary transition-colors"
                            height="h-full"
                        />
                    </div>
                    {/* X-Axis Labels (Simplified) */}
                    <div className="flex justify-between text-xs text-text-muted px-1">
                        <span>24h ago</span>
                        <span>12h ago</span>
                        <span>Now</span>
                    </div>
                </Card>

                {/* Cost Chart */}
                <Card className="p-6 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Cost Efficiency</h3>
                        <span className="text-xs text-text-muted">USD / Hour</span>
                    </div>
                    <div className="h-48 w-full flex items-end">
                        <BarChart
                            data={last24h.map(h => h.cost)}
                            colorClass="bg-green-500/60 hover:bg-green-500 transition-colors"
                            height="h-full"
                        />
                    </div>
                    <div className="flex justify-between text-xs text-text-muted px-1">
                        <span>24h ago</span>
                        <span>Now</span>
                    </div>
                </Card>
            </div>

            {/* Quick Actions / Recent */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-0 overflow-hidden">
                    <div className="p-4 border-b border-border bg-bg-subtle/30 flex justify-between items-center">
                        <h3 className="font-semibold">Quick Actions</h3>
                    </div>
                    <div className="p-4 grid grid-cols-2 gap-3">
                        <Link href="/dashboard/providers" className="block">
                            <div className="p-3 rounded-lg border border-border hover:bg-bg-subtle transition-colors flex items-center gap-3">
                                <div className="size-8 rounded bg-blue-500/10 flex items-center justify-center text-blue-500">
                                    <span className="material-symbols-outlined">dns</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium text-sm">Manage Providers</span>
                                    <span className="text-xs text-text-muted">Add or edit connections</span>
                                </div>
                            </div>
                        </Link>
                        <Link href="/dashboard/pools" className="block">
                            <div className="p-3 rounded-lg border border-border hover:bg-bg-subtle transition-colors flex items-center gap-3">
                                <div className="size-8 rounded bg-purple-500/10 flex items-center justify-center text-purple-500">
                                    <span className="material-symbols-outlined">groups</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium text-sm">View Account Pools</span>
                                    <span className="text-xs text-text-muted">Check health & failover</span>
                                </div>
                            </div>
                        </Link>
                        <Link href="/dashboard/usage" className="block">
                            <div className="p-3 rounded-lg border border-border hover:bg-bg-subtle transition-colors flex items-center gap-3">
                                <div className="size-8 rounded bg-green-500/10 flex items-center justify-center text-green-500">
                                    <span className="material-symbols-outlined">bar_chart</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium text-sm">Usage Logs</span>
                                    <span className="text-xs text-text-muted">Debug recent requests</span>
                                </div>
                            </div>
                        </Link>
                        <Link href="/dashboard/combos" className="block">
                            <div className="p-3 rounded-lg border border-border hover:bg-bg-subtle transition-colors flex items-center gap-3">
                                <div className="size-8 rounded bg-orange-500/10 flex items-center justify-center text-orange-500">
                                    <span className="material-symbols-outlined">layers</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium text-sm">Route Combos</span>
                                    <span className="text-xs text-text-muted">Configure fallback chains</span>
                                </div>
                            </div>
                        </Link>
                    </div>
                </Card>

                <Card className="p-0 overflow-hidden">
                    <div className="p-4 border-b border-border bg-bg-subtle/30 flex justify-between items-center">
                        <h3 className="font-semibold">System Info</h3>
                    </div>
                    <div className="p-4 space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-text-muted">Version</span>
                            <span className="font-mono">v1.1.0-mesh</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-text-muted">Router Status</span>
                            <Badge variant={errorRate > 1 ? "warning" : "success"}>{statusText}</Badge>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-text-muted">Zippy Mesh</span>
                            <Badge variant={sidecarStatus === "connected" ? "success" : "destructive"}>
                                {sidecarStatus === "connected" ? "Online" : "Offline"}
                            </Badge>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-text-muted">Environment</span>
                            <span className="font-mono text-xs bg-bg-subtle px-2 py-0.5 rounded">Docker</span>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
