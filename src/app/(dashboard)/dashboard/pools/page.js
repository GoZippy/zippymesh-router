"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Card, CardSkeleton, Badge, Button } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { INITIAL_SETTINGS } from "@/shared/constants/defaults";
import { useSettings } from "@/shared/hooks";
import { getRelativeTime, safeFetchJson } from "@/shared/utils";

const DEFAULT_ORDER = INITIAL_SETTINGS?.poolTableColumns?.order ?? [
    "provider", "account", "group", "priority", "status", "actions"
];

const ALL_COLUMNS = [
    { id: "provider", label: "Provider", optional: false },
    { id: "account", label: "Account", optional: false },
    { id: "group", label: "Group", optional: false },
    { id: "priority", label: "Priority", optional: false },
    { id: "status", label: "Status", optional: false },
    { id: "lastModel", label: "Last model used", optional: true },
    { id: "calls24h", label: "Calls (24h)", optional: true },
    { id: "tokensIn24h", label: "Tokens in (24h)", optional: true },
    { id: "tokensOut24h", label: "Tokens out (24h)", optional: true },
    { id: "errors24h", label: "Errors (24h)", optional: true },
    { id: "uptimePct", label: "Uptime %", optional: true },
    { id: "avgLatencyMs", label: "Avg latency (24h)", optional: true },
    { id: "actions", label: "Actions", optional: false },
];

function formatTokens(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
}

export default function PoolsPage() {
    const { settings, updateSettings } = useSettings();
    const [connections, setConnections] = useState([]);
    const [poolStats, setPoolStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [filterGroup, setFilterGroup] = useState("all");
    const [resetting, setResetting] = useState({});
    const [columnsOpen, setColumnsOpen] = useState(false);

    const columnOrder = settings?.poolTableColumns?.order ?? DEFAULT_ORDER;
    const visibleOrder = columnOrder.filter((id) => ALL_COLUMNS.some((c) => c.id === id));
    const setColumnOrder = useCallback(
        (nextOrder) => {
            updateSettings({ poolTableColumns: { order: nextOrder } }).catch(() => {});
        },
        [updateSettings]
    );

    useEffect(() => {
        const load = async () => {
            try {
                const [providersRes, statsRes] = await Promise.all([
                    safeFetchJson("/api/providers"),
                    safeFetchJson("/api/usage/pool-stats"),
                ]);
                if (providersRes.ok) setConnections(providersRes.data?.connections ?? []);
                if (statsRes.ok && !statsRes.data?.isDemo) setPoolStats(statsRes.data?.stats ?? {});
            } catch (e) {
                console.log("Error fetching pool data:", e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const handleToggleActive = async (connection) => {
        try {
            const updatedStatus = !(connection.isActive ?? true);
            const res = await safeFetchJson(`/api/providers/${connection.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: updatedStatus }),
            });
            if (res.ok) {
                setConnections((prev) =>
                    prev.map((c) => (c.id === connection.id ? { ...c, isActive: updatedStatus } : c))
                );
            }
        } catch (e) {
            console.log("Error toggling connection:", e);
        }
    };

    const handleResetRateLimit = async (connectionId) => {
        if (resetting[connectionId]) return;
        setResetting((prev) => ({ ...prev, [connectionId]: true }));
        try {
            const res = await safeFetchJson(`/api/providers/${connectionId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rateLimitedUntil: null,
                    lastError: null,
                    testStatus: "active",
                }),
            });
            if (res.ok) {
                setConnections((prev) =>
                    prev.map((c) =>
                        c.id === connectionId
                            ? { ...c, rateLimitedUntil: null, lastError: null, testStatus: "active" }
                            : c
                    )
                );
            }
        } catch (e) {
            console.log("Error resetting rate limit:", e);
        } finally {
            setResetting((prev) => ({ ...prev, [connectionId]: false }));
        }
    };

    const toggleColumn = (id) => {
        if (visibleOrder.includes(id)) {
            setColumnOrder(visibleOrder.filter((c) => c !== id));
        } else {
            setColumnOrder([...visibleOrder, id]);
        }
    };

    const moveColumn = (index, dir) => {
        const next = [...visibleOrder];
        const ni = index + dir;
        if (ni < 0 || ni >= next.length) return;
        [next[index], next[ni]] = [next[ni], next[index]];
        setColumnOrder(next);
    };

    const filteredConnections = connections.filter(
        (c) => filterGroup === "all" || (c.group || "default") === filterGroup
    );
    const sortedConnections = [...filteredConnections].sort((a, b) => {
        const aLimited = a.rateLimitedUntil && new Date(a.rateLimitedUntil) > new Date();
        const bLimited = b.rateLimitedUntil && new Date(b.rateLimitedUntil) > new Date();
        if (aLimited !== bLimited) return aLimited ? 1 : -1;
        const groupOrder = { personal: 1, work: 2, team: 3, default: 4 };
        const aGroup = groupOrder[a.group || "default"] || 99;
        const bGroup = groupOrder[b.group || "default"] || 99;
        if (aGroup !== bGroup) return aGroup - bGroup;
        return (a.priority || 999) - (b.priority || 999);
    });

    const getProviderInfo = (providerId) =>
        OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || { name: providerId, color: "#888" };

    if (loading) {
        return (
            <div className="flex flex-col gap-4">
                <CardSkeleton />
                <CardSkeleton />
            </div>
        );
    }

    const gridCols = visibleOrder.length;
    const gridStyle = {
        display: "grid",
        gridTemplateColumns: `repeat(${gridCols}, minmax(min-content, 1fr))`,
        gap: "0 0.5rem",
    };

    return (
        <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-[1600px] mx-auto w-full">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <h1 className="text-2xl font-bold">Global Account Pool</h1>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setColumnsOpen((o) => !o)}
                            className="inline-flex items-center gap-1"
                        >
                            <span className="material-symbols-outlined text-base">view_column</span>
                            Columns
                        </Button>
                        {columnsOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    aria-hidden
                                    onClick={() => setColumnsOpen(false)}
                                />
                                <div className="absolute right-0 top-full z-20 mt-1 min-w-[220px] rounded-lg border border-border bg-background shadow-lg py-2">
                                    <div className="px-3 py-1.5 text-xs font-semibold text-text-muted uppercase">
                                        Show / reorder
                                    </div>
                                    {ALL_COLUMNS.map((col) => {
                                        const isVisible = visibleOrder.includes(col.id);
                                        const visIdx = visibleOrder.indexOf(col.id);
                                        return (
                                            <div
                                                key={col.id}
                                                className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                                            >
                                                {isVisible ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className="p-0.5 rounded hover:bg-black/10 disabled:opacity-40"
                                                            onClick={() => moveColumn(visIdx, -1)}
                                                            disabled={visIdx <= 0}
                                                            aria-label={`Move ${col.label} left`}
                                                        >
                                                            <span className="material-symbols-outlined text-sm">chevron_left</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="p-0.5 rounded hover:bg-black/10 disabled:opacity-40"
                                                            onClick={() => moveColumn(visIdx, 1)}
                                                            disabled={visIdx >= visibleOrder.length - 1}
                                                            aria-label={`Move ${col.label} right`}
                                                        >
                                                            <span className="material-symbols-outlined text-sm">chevron_right</span>
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span className="w-10" />
                                                )}
                                                <label className="flex-1 flex items-center gap-2 cursor-pointer text-sm min-w-0">
                                                    <input
                                                        type="checkbox"
                                                        checked={isVisible}
                                                        onChange={() => toggleColumn(col.id)}
                                                        className="rounded border-border shrink-0"
                                                    />
                                                    <span className="truncate">{col.label}</span>
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                    <span className="text-sm font-medium text-text-muted">Filter:</span>
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
                <div className="overflow-x-auto overflow-y-visible -mx-1 px-1 sm:mx-0 sm:px-0" role="region" aria-label="Account pool table">
                    <div className="min-w-0 w-full" style={{ ...gridStyle, minWidth: "min(100%, 600px)" }}>
                        {/* Header row */}
                        <div
                            className="contents text-left"
                            role="row"
                        >
                            {visibleOrder.map((colId) => (
                                <div
                                    key={colId}
                                    className="px-2 sm:px-4 py-2 sm:py-3 bg-sidebar border-b border-border text-[10px] sm:text-xs font-semibold text-text-muted uppercase tracking-wider min-w-0"
                                    role="columnheader"
                                >
                                    {ALL_COLUMNS.find((c) => c.id === colId)?.label ?? colId}
                                </div>
                            ))}
                        </div>
                        {/* Body rows */}
                        {sortedConnections.length === 0 ? (
                            <div
                                className="px-4 py-8 text-center text-text-muted col-span-full"
                                style={{ gridColumn: `1 / -1` }}
                            >
                                No accounts found in this pool.
                            </div>
                        ) : (
                            sortedConnections.map((conn) => {
                                const provider = getProviderInfo(conn.provider);
                                const isRateLimited =
                                    conn.rateLimitedUntil && new Date(conn.rateLimitedUntil) > new Date();
                                const isError =
                                    conn.testStatus === "error" ||
                                    conn.testStatus === "expired" ||
                                    conn.testStatus === "unavailable";
                                const stats = poolStats[conn.id] || {};

                                return (
                                    <div
                                        key={conn.id}
                                        className="contents group"
                                        role="row"
                                    >
                                        {visibleOrder.map((colId) => {
                                            const cellCls =
                                                "px-2 sm:px-4 py-2 sm:py-3 border-b border-border/50 flex items-center text-xs sm:text-sm min-w-0 group-hover:bg-black/[0.02] dark:group-hover:bg-white/[0.02]";
                                            if (colId === "provider") {
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
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
                                                                        const el = e?.currentTarget;
                                                                        const parent = el?.parentElement;
                                                                        if (el) el.style.display = "none";
                                                                        if (parent) {
                                                                            parent.innerText = (
                                                                                provider.textIcon ||
                                                                                conn.provider.substring(0, 2)
                                                                            ).toUpperCase();
                                                                            parent.style.color = provider.color;
                                                                            parent.style.fontSize = "12px";
                                                                            parent.style.fontWeight = "bold";
                                                                        }
                                                                    }}
                                                                />
                                                            </div>
                                                            <span className="font-medium truncate">{provider.name}</span>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            if (colId === "account") {
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="font-medium truncate">
                                                                {conn.name || conn.email}
                                                            </span>
                                                            <span className="text-xs text-text-muted font-mono truncate">
                                                                {conn.id.substring(0, 8)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            if (colId === "group") {
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        <Badge
                                                            variant="secondary"
                                                            size="sm"
                                                            className={`
                                                                ${conn.group === "work" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" : ""}
                                                                ${conn.group === "team" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : ""}
                                                                ${conn.group === "personal" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : ""}
                                                            `}
                                                        >
                                                            {(conn.group || "default").charAt(0).toUpperCase() +
                                                                (conn.group || "default").slice(1)}
                                                        </Badge>
                                                    </div>
                                                );
                                            }
                                            if (colId === "priority") {
                                                return (
                                                    <div key={colId} className={`${cellCls} text-text-muted`}>
                                                        #{conn.priority}
                                                    </div>
                                                );
                                            }
                                            if (colId === "status") {
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        <div className="flex flex-col gap-0.5">
                                                            {conn.isActive === false ? (
                                                                <Badge variant="default" size="sm" dot>Disabled</Badge>
                                                            ) : isRateLimited ? (
                                                                <>
                                                                    <Badge variant="warning" size="sm" dot>
                                                                        Rate Limited
                                                                    </Badge>
                                                                    <span className="text-xs text-primary">
                                                                        Until{" "}
                                                                        {new Date(
                                                                            conn.rateLimitedUntil
                                                                        ).toLocaleTimeString()}
                                                                    </span>
                                                                </>
                                                            ) : isError ? (
                                                                <Badge variant="error" size="sm" dot>Error</Badge>
                                                            ) : (
                                                                <Badge variant="success" size="sm" dot>Active</Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            if (colId === "lastModel") {
                                                const last = stats.lastModel;
                                                const at = stats.lastUsedAt
                                                    ? getRelativeTime(stats.lastUsedAt)
                                                    : null;
                                                return (
                                                    <div key={colId} className={`${cellCls} text-text-muted`}>
                                                        {last ? (
                                                            <span className="truncate" title={at ? `Used ${at}` : last}>
                                                                {last}
                                                                {at && (
                                                                    <span className="block text-xs opacity-80">
                                                                        {at}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        ) : (
                                                            "—"
                                                        )}
                                                    </div>
                                                );
                                            }
                                            if (colId === "calls24h") {
                                                const n = stats.calls24h ?? 0;
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        {n > 0 ? n.toLocaleString() : "0"}
                                                    </div>
                                                );
                                            }
                                            if (colId === "tokensIn24h") {
                                                const n = stats.tokensIn24h ?? 0;
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        {n > 0 ? formatTokens(n) : "0"}
                                                    </div>
                                                );
                                            }
                                            if (colId === "tokensOut24h") {
                                                const n = stats.tokensOut24h ?? 0;
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        {n > 0 ? formatTokens(n) : "0"}
                                                    </div>
                                                );
                                            }
                                            if (colId === "errors24h") {
                                                const n = stats.errors24h ?? 0;
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        {n > 0 ? (
                                                            <span className="text-amber-600 dark:text-amber-400 font-medium">{n.toLocaleString()}</span>
                                                        ) : (
                                                            "0"
                                                        )}
                                                    </div>
                                                );
                                            }
                                            if (colId === "uptimePct") {
                                                const pct = stats.uptimePct;
                                                return (
                                                    <div
                                                        key={colId}
                                                        className={cellCls}
                                                        title={pct != null ? `Success rate (24h): ${pct}%` : "No requests in last 24h"}
                                                    >
                                                        {pct != null ? (
                                                            <span className={pct >= 95 ? "text-green-600 dark:text-green-400" : pct >= 80 ? "text-text-muted" : "text-amber-600 dark:text-amber-400"}>
                                                                {pct}%
                                                            </span>
                                                        ) : (
                                                            <span className="text-text-muted">—</span>
                                                        )}
                                                    </div>
                                                );
                                            }
                                            if (colId === "avgLatencyMs") {
                                                const ms = stats.avgLatencyMs24h;
                                                return (
                                                    <div key={colId} className={`${cellCls} text-text-muted`} title="Average response time (24h)">
                                                        {ms != null ? `${ms} ms` : "—"}
                                                    </div>
                                                );
                                            }
                                            if (colId === "actions") {
                                                return (
                                                    <div key={colId} className={cellCls}>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <Button
                                                                size="sm"
                                                                variant="input"
                                                                className={
                                                                    conn.isActive === false ? "opacity-50" : "text-green-600"
                                                                }
                                                                onClick={() => handleToggleActive(conn)}
                                                            >
                                                                {conn.isActive === false ? "Enable" : "Disable"}
                                                            </Button>
                                                            {isRateLimited && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    className="text-primary hover:text-primary-hover hover:bg-primary/10 dark:hover:bg-primary/20"
                                                                    onClick={() => handleResetRateLimit(conn.id)}
                                                                    disabled={resetting[conn.id]}
                                                                >
                                                                    {resetting[conn.id] ? "Resetting..." : "Reset Limit"}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return <div key={colId} className={cellCls} />;
                                        })}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}
