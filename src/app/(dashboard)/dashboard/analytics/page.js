"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import { safeFetchJson } from "@/shared/utils";

export default function AnalyticsPage() {
    const [routingData, setRoutingData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState("overview");
    const [traces, setTraces] = useState([]);
    const [tracesTotal, setTracesTotal] = useState(0);
    const [tracesLoading, setTracesLoading] = useState(false);
    const [intelligence, setIntelligence] = useState(null);
    const [totalSamples, setTotalSamples] = useState(0);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await safeFetchJson("/api/routing/metrics?hours=24");
                if (res.ok) {
                    setRoutingData(res.data);
                } else {
                    setError(res.error);
                }
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        const fetchIntelligence = async () => {
            try {
                const res = await safeFetchJson("/api/routing/intelligence");
                if (res.ok) {
                    setIntelligence(res.data?.summary || null);
                    setTotalSamples(res.data?.totalSamples || 0);
                }
            } catch {}
        };

        fetchData();
        fetchIntelligence();
    }, []);

    useEffect(() => {
        if (activeTab !== "history") return;
        const fetchTraces = async () => {
            setTracesLoading(true);
            try {
                const res = await safeFetchJson("/api/routing/traces?hours=24&limit=50&offset=0");
                if (res.ok) {
                    setTraces(res.data.traces || []);
                    setTracesTotal(res.data.total || 0);
                }
            } catch (e) {
                // silently fail, show empty state
            } finally {
                setTracesLoading(false);
            }
        };
        fetchTraces();
    }, [activeTab]);

    if (loading) {
        return <div className="p-8 text-center text-text-muted animate-pulse">Loading analytics...</div>;
    }

    if (error) {
        return (
            <div className="p-8 text-center">
                <p className="text-text-muted mb-4">Failed to load analytics: {error}</p>
                <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
        );
    }

    // Build chart data from routing data
    const intentData = Object.entries(routingData?.byIntent || {})
        .slice(0, 6)
        .map(([intent, count]) => ({
            name: intent || 'default',
            value: count,
            color: ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4'][Object.entries(routingData?.byIntent || {}).indexOf([intent, count])]
        }));

    const modelData = (routingData?.topModels || []).map(m => ({
        name: m.model?.split('/').pop() || 'unknown',
        usage: m.count,
        success: m.successRate || 0,
        color: '#10b981'
    }));

    const fallbackData = Object.entries(routingData?.byFallbackDepth || {})
        .map(([depth, count]) => ({
            name: `Attempt ${depth}`,
            count: count
        }));

    const hasData = routingData?.totalRequests > 0;

    return (
        <div className="p-6 space-y-6 max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-text-main flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary text-4xl">analytics</span>
                        Smart Routing Analytics
                    </h1>
                    <p className="text-text-muted mt-1">
                        Real-time routing decisions and model performance metrics.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" icon="refresh" onClick={() => window.location.reload()}>Refresh</Button>
                    <Badge variant="primary">LIVE</Badge>
                </div>
            </div>

            <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit mb-6">
                <button onClick={() => setActiveTab("overview")} className={activeTab === "overview" ? "bg-white dark:bg-gray-700 shadow-sm px-4 py-1.5 rounded-md text-sm font-medium" : "text-gray-500 px-4 py-1.5 rounded-md text-sm font-medium"}>Overview</button>
                <button onClick={() => setActiveTab("history")} className={activeTab === "history" ? "bg-white dark:bg-gray-700 shadow-sm px-4 py-1.5 rounded-md text-sm font-medium" : "text-gray-500 px-4 py-1.5 rounded-md text-sm font-medium"}>Request History</button>
            </div>

            {activeTab === "overview" && (
                <>
                    {!hasData ? (
                        <Card className="text-center py-12">
                            <p className="text-text-muted mb-4">No routing data yet. Make requests to see analytics.</p>
                            <p className="text-sm text-text-muted">Send requests to /v1/chat/completions to populate this dashboard.</p>
                        </Card>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                <Card title="Total Requests" icon="analytics">
                                    <div className="text-3xl font-bold text-text-main">{routingData.totalRequests}</div>
                                    <p className="text-xs text-text-muted mt-1">Last 24 hours</p>
                                </Card>
                                <Card title="Success Rate" icon="check_circle">
                                    <div className="text-3xl font-bold text-text-main">{routingData.successRate?.toFixed(1)}%</div>
                                    <p className="text-xs text-text-muted mt-1">Successful routing</p>
                                </Card>
                                <Card title="Avg Latency" icon="timer">
                                    <div className="text-3xl font-bold text-text-main">{routingData.avgLatency}ms</div>
                                    <p className="text-xs text-text-muted mt-1">Average response time</p>
                                </Card>
                                <Card title="Unique Intents" icon="category">
                                    <div className="text-3xl font-bold text-text-main">{Object.keys(routingData.byIntent || {}).length}</div>
                                    <p className="text-xs text-text-muted mt-1">Different request types</p>
                                </Card>
                            </div>

                            {/* Routing Intelligence Banner */}
                            {totalSamples > 0 && (
                                <div className={`rounded-xl border p-4 flex items-start gap-3 ${
                                    intelligence
                                        ? "bg-emerald-500/5 border-emerald-500/30"
                                        : "bg-surface-secondary border-border"
                                }`}>
                                    <span className="material-symbols-outlined text-emerald-500 text-xl flex-shrink-0 mt-0.5">psychology</span>
                                    <div className="flex-1">
                                        {intelligence ? (
                                            <>
                                                <p className="text-sm font-medium text-text-main">
                                                    Learning from your usage
                                                    <Badge variant="success" size="sm" className="ml-2">ACTIVE</Badge>
                                                </p>
                                                <p className="text-xs text-text-muted mt-0.5">
                                                    Routing intelligence is boosting/penalising models based on {totalSamples} historical requests across {intelligence.topModels?.length ?? 0} intent(s).
                                                </p>
                                                {intelligence.topModels?.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {intelligence.topModels.map(row => (
                                                            <span key={row.intent} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                                                <Badge variant="secondary" size="sm">{row.intent}</Badge>
                                                                → {row.model?.split('/').pop()} ({row.successRate}%)
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-sm font-medium text-text-main">
                                                    Routing intelligence warming up
                                                    <Badge variant="secondary" size="sm" className="ml-2">{totalSamples}/100</Badge>
                                                </p>
                                                <div className="mt-2 bg-border rounded-full h-1 w-48 overflow-hidden">
                                                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (totalSamples / 100) * 100)}%` }} />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    <a href="/dashboard/profile" className="text-xs text-text-muted hover:underline whitespace-nowrap flex-shrink-0 mt-0.5">
                                        Configure →
                                    </a>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <Card title="Requests by Intent" subtitle="Distribution of routing intents" icon="distribution">
                                    {intentData.length > 0 ? (
                                        <div className="h-64 mt-4 w-full">
                                            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 256 }}>
                                                <BarChart data={intentData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                                                    <XAxis dataKey="name" stroke="var(--color-text-muted)" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                                    <YAxis stroke="var(--color-text-muted)" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', borderRadius: '12px', color: 'var(--color-text-main)' }}
                                                        itemStyle={{ fontSize: '12px' }}
                                                    />
                                                    <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={60}>
                                                        {intentData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-text-muted py-8">No intent data available</p>
                                    )}
                                </Card>

                                <Card title="Top Models by Usage" subtitle="Most frequently selected" icon="storage">
                                    {modelData.length > 0 ? (
                                        <div className="h-64 mt-4 w-full">
                                            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 256 }}>
                                                <BarChart data={modelData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                                                    <XAxis dataKey="name" stroke="var(--color-text-muted)" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                                    <YAxis stroke="var(--color-text-muted)" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', borderRadius: '12px', color: 'var(--color-text-main)' }}
                                                        itemStyle={{ fontSize: '12px' }}
                                                    />
                                                    <Bar dataKey="usage" fill="#10b981" radius={[8, 8, 0, 0]} maxBarSize={60} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-text-muted py-8">No model data available</p>
                                    )}
                                </Card>
                            </div>

                            <Card title="Fallback Depth Distribution" subtitle="How often we used fallback models" icon="swap_calls">
                                {fallbackData.length > 0 ? (
                                    <div className="h-64 mt-4 w-full">
                                        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 256 }}>
                                            <BarChart data={fallbackData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                                                <XAxis dataKey="name" stroke="var(--color-text-muted)" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                                <YAxis stroke="var(--color-text-muted)" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', borderRadius: '12px', color: 'var(--color-text-main)' }}
                                                    itemStyle={{ fontSize: '12px' }}
                                                />
                                                <Bar dataKey="count" fill="#3b82f6" radius={[8, 8, 0, 0]} maxBarSize={60} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <p className="text-sm text-text-muted py-8">All requests succeeded on first attempt</p>
                                )}
                            </Card>
                        </>
                    )}
                </>
            )}

            {activeTab === "history" && (
                <Card title="Request History" subtitle="Per-request trace log (last 24 hours)" icon="history">
                    {tracesLoading ? (
                        <div className="py-8 text-center text-text-muted animate-pulse">Loading traces...</div>
                    ) : traces.length === 0 ? (
                        <div className="py-12 text-center text-text-muted">No request traces yet</div>
                    ) : (
                        <>
                            <div className="overflow-x-auto mt-4">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border text-left text-text-muted">
                                            <th className="pb-2 pr-4 font-medium">Time</th>
                                            <th className="pb-2 pr-4 font-medium">Intent</th>
                                            <th className="pb-2 pr-4 font-medium">Model Used</th>
                                            <th className="pb-2 pr-4 font-medium">Latency</th>
                                            <th className="pb-2 pr-4 font-medium">Cache</th>
                                            <th className="pb-2 font-medium">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {traces.map((trace, i) => {
                                            const ts = new Date(trace.timestamp);
                                            const now = Date.now();
                                            const diffMs = now - ts.getTime();
                                            const diffMin = Math.floor(diffMs / 60000);
                                            const diffHr = Math.floor(diffMin / 60);
                                            const relTime = diffHr > 0
                                                ? `${diffHr}h ${diffMin % 60}m ago`
                                                : diffMin > 0
                                                    ? `${diffMin}m ago`
                                                    : "just now";
                                            return (
                                                <tr key={trace.id ?? i} className="border-b border-border last:border-0 hover:bg-surface-secondary transition-colors">
                                                    <td className="py-2.5 pr-4 text-text-muted whitespace-nowrap">{relTime}</td>
                                                    <td className="py-2.5 pr-4">
                                                        <Badge variant="secondary">{trace.intent || 'default'}</Badge>
                                                    </td>
                                                    <td className="py-2.5 pr-4 font-mono text-xs text-text-main">{trace.used_model || trace.selected_model || '—'}</td>
                                                    <td className="py-2.5 pr-4 text-text-muted">{trace.latency_ms != null ? `${trace.latency_ms}ms` : '—'}</td>
                                                    <td className="py-2.5 pr-4">
                                                        {trace.cache_hit ? (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">HIT</span>
                                                        ) : null}
                                                    </td>
                                                    <td className="py-2.5">
                                                        {trace.success ? (
                                                            <span className="material-symbols-outlined text-green-500 text-base align-middle">check_circle</span>
                                                        ) : (
                                                            <span className="material-symbols-outlined text-red-500 text-base align-middle">cancel</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {tracesTotal > traces.length && (
                                <div className="mt-4 text-center">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                            setTracesLoading(true);
                                            try {
                                                const res = await safeFetchJson(`/api/routing/traces?hours=24&limit=50&offset=${traces.length}`);
                                                if (res.ok) {
                                                    setTraces(prev => [...prev, ...(res.data.traces || [])]);
                                                    setTracesTotal(res.data.total || 0);
                                                }
                                            } catch (e) {
                                                // silently fail
                                            } finally {
                                                setTracesLoading(false);
                                            }
                                        }}
                                    >
                                        Load More
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </Card>
            )}
        </div>
    );
}
