"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";

export default function AnalyticsPage() {
    const [stats, setStats] = useState({
        performance: [
            { name: "Peer Mesh", latency: 45, cost: 0.05, color: "#10b981" },
            { name: "Cloud (OpenAI)", latency: 120, cost: 2.50, color: "#3b82f6" },
            { name: "Cloud (Groq)", latency: 85, cost: 0.80, color: "#8b5cf6" }
        ],
        requests: 1250,
        savings: 85.00
    });

    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setTimeout(() => setLoading(false), 800);
    }, []);

    if (loading) {
        return <div className="p-8 text-center text-text-muted animate-pulse">Analyzing Mesh Data...</div>;
    }

    return (
        <div className="p-6 space-y-6 max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-text-main flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary text-4xl">analytics</span>
                        Mesh Intelligence
                    </h1>
                    <p className="text-text-muted mt-1">
                        Deep performance insights and economic routing efficiency.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" icon="download">Export Data</Button>
                    <Badge variant="primary">LIVE ANALYSIS</Badge>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="Avg Latency" icon="timer">
                    <div className="text-3xl font-bold text-text-main">45ms</div>
                    <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">keyboard_double_arrow_down</span>
                        62% lower than benchmark
                    </p>
                </Card>
                <Card title="ZIPc Savings" icon="savings">
                    <div className="text-3xl font-bold text-text-main">124.50</div>
                    <p className="text-xs text-text-muted mt-1">Last 30 days total</p>
                </Card>
                <Card title="Routing Score" icon="bolt">
                    <div className="text-3xl font-bold text-text-main">98.2%</div>
                    <p className="text-xs text-text-muted mt-1">Efficiency rating</p>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card title="Latency Comparison (ms)" subtitle="Lower is better" icon="speed">
                    <div className="h-64 mt-4 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.performance} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} axisLine={false} tickLine={false} />
                                <YAxis stroke="var(--text-muted)" fontSize={12} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: '12px' }}
                                    itemStyle={{ fontSize: '12px' }}
                                />
                                <Bar dataKey="latency" radius={[8, 8, 0, 0]} maxBarSize={60}>
                                    {stats.performance.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                <Card title="Cost Index (ZIPc/1M)" subtitle="Economic efficiency" icon="payments">
                    <div className="h-64 mt-4 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.performance} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} axisLine={false} tickLine={false} />
                                <YAxis stroke="var(--text-muted)" fontSize={12} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: '12px' }}
                                    itemStyle={{ fontSize: '12px' }}
                                />
                                <Bar dataKey="cost" radius={[8, 8, 0, 0]} maxBarSize={60}>
                                    {stats.performance.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            </div>

            <Card className="border-primary/20 bg-primary/5">
                <div className="flex items-start gap-5">
                    <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-primary text-3xl">psychology</span>
                    </div>
                    <div>
                        <h4 className="text-lg font-bold text-text-main">AI Orchestrator Recommendation</h4>
                        <p className="text-text-muted mt-1 leading-relaxed">
                            We've detected that your "Project Alpha" requests are spending 2.50 ZIPc on GPT-4o.
                            **Billing-Test-Node** is offering Llama-3-70b with similar benchmark scores for only **0.05 ZIPc**.
                        </p>
                        <div className="mt-4 flex gap-3">
                            <Button size="sm">Update Routing Rule</Button>
                            <Button variant="outline" size="sm">Dismiss</Button>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
