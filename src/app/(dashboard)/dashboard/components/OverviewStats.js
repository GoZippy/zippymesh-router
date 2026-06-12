"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { Card, CardSkeleton, Badge } from "@/shared/components";
import BarChart from "@/shared/components/BarChart";
import { formatRequestError, safeFetchJson } from "@/shared/utils";
import SetupChecklist from "./SetupChecklist";

export default function OverviewStats() {
    const [stats, setStats] = useState(null);
    const [routingStats, setRoutingStats] = useState(null);
    const [sidecarStatus, setSidecarStatus] = useState("checking");
    const [sidecarError, setSidecarError] = useState("");
    const [loading, setLoading] = useState(true);
    const [sidecarPollInterval, setSidecarPollInterval] = useState(10000);
    const [providerSummary, setProviderSummary] = useState(null); // { total, active, broken }

    const fetchStats = useCallback(async () => {
        try {
            // Fetch usage stats
            const usageResponse = await safeFetchJson("/api/usage/history");
            if (usageResponse.ok) {
                const data = usageResponse.data;
                setStats(data);
            }

            // Fetch provider connections for status banner
            const providersResponse = await safeFetchJson("/api/providers");
            if (providersResponse.ok) {
                const conns = providersResponse.data?.connections || [];
                const active = conns.filter(
                    (c) => c.testStatus === "active" || c.testStatus === "success" || c.testStatus === "unavailable"
                ).length;
                const broken = conns.filter(
                    (c) => c.testStatus === "error" || c.testStatus === "expired"
                ).length;
                setProviderSummary({ total: conns.length, active, broken });
            }

            // Fetch routing stats (1 hour window)
            const routingRes = await safeFetchJson("/api/routing/metrics?hours=1");
            if (routingRes.ok) setRoutingStats(routingRes.data);

            // Fetch sidecar health
            const sidecarResponse = await safeFetchJson("/api/sidecar/health");
            if (sidecarResponse.ok) {
                const data = sidecarResponse.data;
                setSidecarStatus(data.status);
                setSidecarError("");
                setSidecarPollInterval(10000);
            } else {
                setSidecarStatus("disconnected");
                setSidecarError(formatRequestError("Sidecar health check failed", sidecarResponse, "Sidecar service unavailable"));
                setSidecarPollInterval((current) => Math.min((current || 10000) * 2, 60000));
            }
        } catch (error) {
            console.error("Failed to fetch overview stats:", error);
            setSidecarStatus("disconnected");
            setSidecarError(formatRequestError("Failed to fetch overview stats", error));
            setSidecarPollInterval((current) => Math.min((current || 10000) * 2, 60000));
        } finally {
            setLoading(false);
        }
    }, []);

    const isSidecarConnected = sidecarStatus === "connected";
    const sidecarLabel = isSidecarConnected
        ? "Sidecar: Online"
        : sidecarStatus === "checking"
            ? "Sidecar: Checking"
            : "Sidecar: Offline";
    const sidecarNeedsReconnect = sidecarStatus !== "connected";

    const handleSidecarReconnect = () => {
        setSidecarStatus("checking");
        setSidecarError("");
        setSidecarPollInterval(10000);
        fetchStats();
    };

    // Poll for updates with adaptive sidecar error backoff
    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, sidecarPollInterval);
        return () => clearInterval(interval);
    }, [fetchStats, sidecarPollInterval]);

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
            <SetupChecklist />
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

            {!isSidecarConnected && (
                <Card className="p-4 border-amber-500/30 bg-amber-500/5 flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-amber-500 text-xl">cloud_off</span>
                        <div className="text-sm">
                            <p className="font-semibold text-text-primary">{sidecarLabel}</p>
                            {sidecarError && <p className="text-text-muted mt-0.5">{sidecarError}</p>}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => fetchStats()}
                        title={sidecarError || "Retry sidecar health check"}
                        className="text-xs px-3 py-1.5 rounded-md border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                    >
                        Retry check
                    </button>
                </Card>
            )}

            {/* Provider status banners */}
            {providerSummary !== null && providerSummary.total === 0 && (
                <Card className="p-4 border-primary/30 bg-primary/5 flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <span className="material-symbols-outlined text-primary text-xl shrink-0">rocket_launch</span>
                        <div className="text-sm">
                            <p className="font-semibold">Get started — no providers connected yet</p>
                            <p className="text-text-muted mt-0.5">
                                Add your first provider to start routing LLM requests. Takes under 5 minutes.
                            </p>
                        </div>
                    </div>
                    <Link
                        href="/dashboard/providers"
                        className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-primary/40 text-primary hover:bg-primary/10 font-medium transition-colors"
                    >
                        Add a provider
                    </Link>
                </Card>
            )}

            {providerSummary !== null && providerSummary.total > 0 && providerSummary.active === 0 && providerSummary.broken > 0 && (
                <Card className="p-4 border-red-500/30 bg-red-500/5 flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <span className="material-symbols-outlined text-red-500 text-xl shrink-0">warning</span>
                        <div className="text-sm">
                            <p className="font-semibold text-red-600 dark:text-red-400">
                                Your connections need attention
                            </p>
                            <p className="text-text-muted mt-0.5">
                                {providerSummary.broken} provider connection{providerSummary.broken !== 1 ? "s are" : " is"} reporting errors. No requests can be routed until at least one is fixed.
                            </p>
                        </div>
                    </div>
                    <Link
                        href="/dashboard/providers"
                        className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10 font-medium transition-colors"
                    >
                        Fix connections
                    </Link>
                </Card>
            )}

            {providerSummary !== null && providerSummary.total > 0 && (
                <div className="flex items-center gap-2 text-sm text-text-muted">
                    <span className="material-symbols-outlined text-[16px] text-green-500">hub</span>
                    <span>
                        <strong className="text-text-main">{providerSummary.active}</strong> provider{providerSummary.active !== 1 ? "s" : ""} active
                        {providerSummary.broken > 0 && (
                            <>, <strong className="text-red-500">{providerSummary.broken}</strong> with errors</>
                        )}
                    </span>
                </div>
            )}

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
                            showTooltip={true}
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
                            showTooltip={true}
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
                            showTooltip={true}
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

            {/* Routing Intelligence Widget */}
            {routingStats?.totalRequests > 0 && (
                <Card className="p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Routing Intelligence (1h)</h3>
                        <Badge variant="secondary" size="sm">Live</Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                        <div>
                            <p className="text-text-muted text-xs">Routed</p>
                            <p className="font-bold text-lg">{routingStats.totalRequests}</p>
                        </div>
                        <div>
                            <p className="text-text-muted text-xs">Success</p>
                            <p className="font-bold text-lg">{routingStats.successRate?.toFixed(0)}%</p>
                        </div>
                        <div>
                            <p className="text-text-muted text-xs">Top Intent</p>
                            <p className="font-bold text-lg text-primary">{Object.entries(routingStats.byIntent||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—'}</p>
                        </div>
                        <div>
                            <p className="text-text-muted text-xs">Top Model</p>
                            <p className="font-bold text-sm truncate">{routingStats.topModels?.[0]?.model?.split('/').pop()||'—'}</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Main Charts Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Throughput Chart */}
                <Card className="lg:col-span-2 p-6 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Throughput</h3>
                        <span className="text-xs text-text-muted">Requests / Hour</span>
                    </div>
                    <div className="h-48 w-full">
                        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 192 }}>
                            <RechartsBarChart data={last24h} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorThroughput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                                <XAxis
                                    dataKey="timestamp"
                                    tickFormatter={(t) => new Date(t).getHours() + "h"}
                                    stroke="var(--color-text-muted)"
                                    tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                                    tickLine={false}
                                    axisLine={false}
                                    minTickGap={40}
                                />
                                <YAxis
                                    stroke="var(--color-text-muted)"
                                    tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                                    tickLine={false}
                                    axisLine={false}
                                    allowDecimals={false}
                                />
                                <Tooltip
                                    content={({ active, payload, label }) =>
                                        active && payload?.[0] ? (
                                            <div className="bg-surface border border-border p-3 rounded-lg shadow-lg text-xs text-text-main">
                                                <p className="font-semibold mb-1">{new Date(label).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                                                <p className="text-primary">Requests: {payload[0].value}</p>
                                                {payload[0].payload?.errors > 0 && (
                                                    <p className="text-red-500">Errors: {payload[0].payload.errors}</p>
                                                )}
                                            </div>
                                        ) : null
                                    }
                                    cursor={{ fill: "var(--color-bg-alt)", opacity: 0.5 }}
                                />
                                <Bar dataKey="requests" fill="url(#colorThroughput)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                            </RechartsBarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* Cost Chart */}
                <Card className="p-6 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Cost Efficiency</h3>
                        <span className="text-xs text-text-muted">USD / Hour</span>
                    </div>
                    <div className="h-48 w-full">
                        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 192 }}>
                            <AreaChart data={last24h} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                                <XAxis
                                    dataKey="timestamp"
                                    tickFormatter={(t) => new Date(t).getHours() + "h"}
                                    stroke="var(--color-text-muted)"
                                    tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                                    tickLine={false}
                                    axisLine={false}
                                    minTickGap={30}
                                />
                                <YAxis
                                    stroke="var(--color-text-muted)"
                                    tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(v) => (v >= 0.01 ? `$${v.toFixed(2)}` : v > 0 ? `$${v.toFixed(4)}` : "$0")}
                                />
                                <Tooltip
                                    content={({ active, payload, label }) =>
                                        active && payload?.[0] ? (
                                            <div className="bg-surface border border-border p-3 rounded-lg shadow-lg text-xs text-text-main">
                                                <p className="font-semibold mb-1">{new Date(label).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                                                <p className="text-green-500 dark:text-green-400 font-medium">Cost: ${payload[0].value.toFixed(4)}</p>
                                                {payload[0].payload?.requests > 0 && (
                                                    <p className="text-text-muted mt-1">Requests: {payload[0].payload.requests}</p>
                                                )}
                                            </div>
                                        ) : null
                                    }
                                    cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
                                />
                                <Area type="monotone" dataKey="cost" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorCost)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* Token Usage Chart */}
                <Card className="lg:col-span-3 p-6 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Token Usage</h3>
                        <span className="text-xs text-text-muted">Input / Output per Hour</span>
                    </div>
                    <div className="h-48 w-full">
                        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 192 }}>
                            <RechartsBarChart data={last24h} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                                <XAxis
                                    dataKey="timestamp"
                                    tickFormatter={(t) => new Date(t).getHours() + "h"}
                                    stroke="var(--color-text-muted)"
                                    tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                                    tickLine={false}
                                    axisLine={false}
                                    minTickGap={30}
                                />
                                <YAxis
                                    stroke="var(--color-text-muted)"
                                    tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
                                />
                                <Tooltip
                                    content={({ active, payload, label }) => {
                                        if (!active || !payload?.length || !payload[0]?.payload) return null;
                                        const p = payload[0].payload;
                                        const input = p.promptTokens || 0;
                                        const output = p.completionTokens || 0;
                                        return (
                                            <div className="bg-surface border border-border p-3 rounded-lg shadow-lg text-xs text-text-main">
                                                <p className="font-semibold mb-1">{new Date(label).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                                                <p className="text-blue-500">Input: {input.toLocaleString()}</p>
                                                <p className="text-green-500">Output: {output.toLocaleString()}</p>
                                                <p className="text-text-muted mt-1 pt-1 border-t border-border/50">Total: {(input + output).toLocaleString()}</p>
                                            </div>
                                        );
                                    }}
                                    cursor={{ fill: "var(--color-bg-alt)", opacity: 0.5 }}
                                />
                                <Bar dataKey="promptTokens" stackId="a" fill="#3b82f6" radius={[0, 0, 4, 4]} maxBarSize={40} name="Input" />
                                <Bar dataKey="completionTokens" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} name="Output" />
                            </RechartsBarChart>
                        </ResponsiveContainer>
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
                                <div className="size-8 rounded bg-primary/10 flex items-center justify-center text-primary">
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
                            <div className="flex items-center gap-2">
                                <Badge variant={sidecarStatus === "connected" ? "success" : "destructive"}>
                                    {sidecarStatus === "connected" ? "Online" : "Offline"}
                                </Badge>
                                {sidecarNeedsReconnect && (
                                    <button
                                        type="button"
                                        onClick={handleSidecarReconnect}
                                        title={sidecarError || "Retry sidecar health check"}
                                        className="text-[11px] px-2 py-1 rounded-md border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                    >
                                        Retry check
                                    </button>
                                )}
                            </div>
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
