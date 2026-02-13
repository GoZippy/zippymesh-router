"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Card, CardSkeleton, Badge, Button, Input, Select } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { getRelativeTime } from "@/shared/utils";

export default function PoolsPage() {
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterGroup, setFilterGroup] = useState("all");
    const [resetting, setResetting] = useState({});

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const res = await fetch("/api/providers");
            const data = await res.json();
            if (res.ok) {
                setConnections(data.connections || []);
            }
        } catch (error) {
            console.log("Error fetching connections:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleActive = async (connection) => {
        try {
            const updatedStatus = !(connection.isActive ?? true);
            const res = await fetch(`/api/providers/${connection.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: updatedStatus }),
            });

            if (res.ok) {
                setConnections(prev => prev.map(c =>
                    c.id === connection.id ? { ...c, isActive: updatedStatus } : c
                ));
            }
        } catch (error) {
            console.log("Error toggling connection:", error);
        }
    };

    const handleResetRateLimit = async (connectionId) => {
        if (resetting[connectionId]) return;
        setResetting(prev => ({ ...prev, [connectionId]: true }));

        try {
            const res = await fetch(`/api/providers/${connectionId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rateLimitedUntil: null,
                    lastError: null,
                    testStatus: "active"
                }),
            });

            if (res.ok) {
                setConnections(prev => prev.map(c =>
                    c.id === connectionId ? { ...c, rateLimitedUntil: null, lastError: null, testStatus: "active" } : c
                ));
            }
        } catch (error) {
            console.log("Error resetting rate limit:", error);
        } finally {
            setResetting(prev => ({ ...prev, [connectionId]: false }));
        }
    };

    // Group and sort connections
    const filteredConnections = connections.filter(c =>
        filterGroup === "all" || (c.group || "default") === filterGroup
    );

    const sortedConnections = [...filteredConnections].sort((a, b) => {
        // 1. Sort by Rate Limit Status (Active > Rate Limited)
        const aLimited = a.rateLimitedUntil && new Date(a.rateLimitedUntil) > new Date();
        const bLimited = b.rateLimitedUntil && new Date(b.rateLimitedUntil) > new Date();
        if (aLimited !== bLimited) return aLimited ? 1 : -1;

        // 2. Sort by Group
        const groupOrder = { personal: 1, work: 2, team: 3, default: 4 };
        const aGroup = groupOrder[a.group || "default"] || 99;
        const bGroup = groupOrder[b.group || "default"] || 99;
        if (aGroup !== bGroup) return aGroup - bGroup;

        // 3. Sort by Priority
        return (a.priority || 999) - (b.priority || 999);
    });

    const getProviderInfo = (providerId) => {
        return OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || { name: providerId, color: "#888" };
    };

    if (loading) {
        return (
            <div className="flex flex-col gap-4">
                <CardSkeleton />
                <CardSkeleton />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Global Account Pool</h1>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-muted">Filter by Group:</span>
                    <select
                        className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                        value={filterGroup}
                        onChange={(e) => setFilterGroup(e.target.value)}
                    >
                        <option value="all">All Groups</option>
                        <option value="personal">Personal</option>
                        <option value="work">Work</option>
                        <option value="team">Team</option>
                        <option value="default">Default</option>
                    </select>
                </div>
            </div>

            <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-sidebar border-b border-border">
                            <tr>
                                <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">Provider</th>
                                <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">Account</th>
                                <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">Group</th>
                                <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">Priority</th>
                                <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">Status</th>
                                <th className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {sortedConnections.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-4 py-8 text-center text-text-muted">
                                        No accounts found in this pool.
                                    </td>
                                </tr>
                            ) : (
                                sortedConnections.map((conn) => {
                                    const provider = getProviderInfo(conn.provider);
                                    const isRateLimited = conn.rateLimitedUntil && new Date(conn.rateLimitedUntil) > new Date();
                                    const isError = conn.testStatus === "error" || conn.testStatus === "expired" || conn.testStatus === "unavailable";

                                    return (
                                        <tr key={conn.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        className="size-8 rounded-lg flex items-center justify-center shrink-0"
                                                        style={{ backgroundColor: `${provider.color}15` }}
                                                    >
                                                        <Image
                                                            src={`/providers/${conn.provider}.png`}
                                                            alt={provider.name}
                                                            width={20}
                                                            height={20}
                                                            className="object-contain max-h-[20px] max-w-[20px]"
                                                            onError={(e) => {
                                                                e.currentTarget.style.display = 'none';
                                                                e.currentTarget.parentElement.innerText = (provider.textIcon || conn.provider.substring(0, 2)).toUpperCase();
                                                                e.currentTarget.parentElement.style.color = provider.color;
                                                                e.currentTarget.parentElement.style.fontSize = '12px';
                                                                e.currentTarget.parentElement.style.fontWeight = 'bold';
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="font-medium text-sm">{provider.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{conn.name || conn.email}</span>
                                                    <span className="text-xs text-text-muted font-mono">{conn.id.substring(0, 8)}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant="secondary" size="sm" className={`
                          ${conn.group === "work" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" : ""}
                          ${conn.group === "team" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : ""}
                          ${conn.group === "personal" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : ""}
                        `}>
                                                    {(conn.group || "default").charAt(0).toUpperCase() + (conn.group || "default").slice(1)}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-text-muted">
                                                #{conn.priority}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    {conn.isActive === false ? (
                                                        <Badge variant="default" size="sm" dot>Disabled</Badge>
                                                    ) : isRateLimited ? (
                                                        <div className="flex flex-col gap-1">
                                                            <Badge variant="warning" size="sm" dot>Rate Limited</Badge>
                                                            <span className="text-xs text-orange-500">
                                                                Until {new Date(conn.rateLimitedUntil).toLocaleTimeString()}
                                                            </span>
                                                        </div>
                                                    ) : isError ? (
                                                        <Badge variant="error" size="sm" dot>Error</Badge>
                                                    ) : (
                                                        <Badge variant="success" size="sm" dot>Active</Badge>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="input" // Using input variant as neutral toggle
                                                        className={conn.isActive === false ? "opacity-50" : "text-green-600"}
                                                        onClick={() => handleToggleActive(conn)}
                                                    >
                                                        {conn.isActive === false ? "Enable" : "Disable"}
                                                    </Button>

                                                    {isRateLimited && (
                                                        <Button
                                                            size="sm"
                                                            variant="secondary"
                                                            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                                            onClick={() => handleResetRateLimit(conn.id)}
                                                            disabled={resetting[conn.id]}
                                                        >
                                                            {resetting[conn.id] ? "Resetting..." : "Reset Limit"}
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
