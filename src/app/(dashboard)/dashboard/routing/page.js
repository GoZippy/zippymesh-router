
"use client";

import { useState, useEffect } from "react";
import { Card, CardSkeleton, Badge, Button, Input, Modal, Select, Toggle } from "@/shared/components";
import { formatRequestError, getRelativeTime, safeFetchJson, safeFetchJsonAll } from "@/shared/utils";
import TemplateGallery from "./components/TemplateGallery";
import { applyMeshLimits, DEFAULT_MESH_LIMITS } from "@/lib/routing/meshLimits";

export default function RoutingPage() {
    const [activeTab, setActiveTab] = useState("limits"); // "limits" | "mesh" | "playbooks"

    const tabs = [
        { id: "limits", label: "Provider Limits" },
        { id: "mesh", label: "Mesh Routing Limits" },
        { id: "playbooks", label: "Routing Playbooks" },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-bold">Routing Intelligence</h1>
                <p className="text-sm text-text-muted mt-1">
                    Control how ZippyMesh selects providers, respects rate limits, and fails over between models
                </p>
            </div>
            <RoutingModePanel />
            <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab.id
                            ? "bg-white dark:bg-gray-700 shadow-sm"
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === "limits" && <ProviderLimitsTab />}
            {activeTab === "mesh" && <MeshLimitsTab />}
            {activeTab === "playbooks" && <PlaybooksTab />}
        </div>
    );
}

function RoutingModePanel() {
    const [mode, setMode] = useState("auto");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const response = await safeFetchJson("/api/settings", { cache: "no-store", credentials: "include" });
                const data = response.data || {};
                if (response.ok && data.routingMode) {
                    setMode(data.routingMode);
                }
            } catch (err) {
                console.error(formatRequestError("Failed to load routing settings", err));
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const updateMode = async (nextMode) => {
        setMode(nextMode);
        setSaving(true);
        try {
            const response = await safeFetchJson("/api/settings", {
                credentials: "include",
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ routingMode: nextMode }),
            });
            if (!response.ok) {
                console.error(formatRequestError("Failed to update routing mode", response, "Failed to update routing mode"));
            }
        } catch (err) {
            console.error(formatRequestError("Failed to update routing mode", err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-semibold">Routing Mode</h3>
                    <p className="text-sm text-text-muted">
                        <strong>AUTO</strong> infers generic/specific intent and maps to playbooks, groups, or pools with failover.
                    </p>
                </div>
                {saving && <Badge size="sm" variant="secondary">Saving...</Badge>}
            </div>
            <Select
                label="Operating Mode"
                value={mode}
                disabled={loading || saving}
                onChange={(e) => updateMode(e.target.value)}
                options={[
                    { value: "auto", label: "AUTO (intent inference + playbooks)" },
                    { value: "playbook", label: "Playbook-first (explicit rules)" },
                    { value: "default", label: "Default (cost/latency strategy only)" },
                ]}
                hint="AUTO: intent trigger -> group/pool trigger -> default playbook -> base strategy."
            />
        </Card>
    );
}

function ProviderLimitsTab() {
    const [configs, setConfigs] = useState({});
    const [loading, setLoading] = useState(true);
    const [editingProvider, setEditingProvider] = useState(null);

    useEffect(() => {
        fetchLimits();
    }, []);

    const fetchLimits = async () => {
        try {
            const response = await safeFetchJson("/api/routing/limits");
            const data = response.data || {};
            if (response.ok) setConfigs(data.configs || {});
        } catch (err) {
            console.error("Failed to fetch limits:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (providerId, newConfig) => {
        try {
            const response = await safeFetchJson("/api/routing/limits", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ providerId, config: newConfig }),
            });
            if (response.ok) {
                setConfigs({ ...configs, [providerId]: newConfig });
                setEditingProvider(null);
            } else {
                console.error(formatRequestError("Failed to save limit", response, "Failed to save limit"));
            }
        } catch (err) {
            console.error("Failed to save limit:", err);
        }
    };

    if (loading) return <CardSkeleton />;

    return (
        <div className="flex flex-col gap-4">
            {/* Explainer */}
            <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 p-4 flex gap-3">
                <span className="material-symbols-outlined text-blue-500 shrink-0 mt-0.5">info</span>
                <div className="text-sm">
                    <p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Provider Rate Limits</p>
                    <p className="text-text-muted">
                        These limits tell the routing engine how many requests each connected provider can handle per minute/day.
                        When a provider hits its limit, the router automatically skips it and tries the next eligible connection.
                        Free-tier limits (Groq, Cerebras, etc.) are pre-populated from our docs.
                        You can adjust them here if your account has higher limits (paid tiers, upgraded plans).
                    </p>
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {Object.entries(configs).map(([providerId, config]) => (
                    <LimitCard
                        key={providerId}
                        providerId={providerId}
                        config={config}
                        onEdit={() => setEditingProvider({ id: providerId, config })}
                    />
                ))}
                <EditLimitModal
                    isOpen={!!editingProvider}
                    provider={editingProvider}
                    onClose={() => setEditingProvider(null)}
                    onSave={handleSave}
                />
            </div>
        </div>
    );
}

function LimitCard({ providerId, config, onEdit }) {
    const buckets = config.buckets || [];

    return (
        <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <span className="text-xs font-bold uppercase text-blue-500">{providerId.slice(0, 2)}</span>
                    </div>
                    <div>
                        <h3 className="font-semibold capitalize">{providerId}</h3>
                        <p className="text-xs text-text-muted">{buckets.length} active rules</p>
                    </div>
                </div>
                <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
            </div>

            <div className="flex flex-col gap-2">
                {buckets.slice(0, 3).map((bucket, i) => (
                    <div key={i} className="flex items-center justify-between text-sm p-2 bg-gray-50 dark:bg-white/2 rounded">
                        <span className="font-medium">{bucket.name}</span>
                        <div className="flex items-center gap-2">
                            <Badge size="sm" variant="secondary">{bucket.value_hint || "?"}</Badge>
                            <span className="text-xs text-text-muted"> per {bucket.window_seconds}s</span>
                        </div>
                    </div>
                ))}
                {buckets.length > 3 && (
                    <div className="text-center text-xs text-text-muted pt-1">
                        + {buckets.length - 3} more rules
                    </div>
                )}
            </div>
        </Card>
    );
}

function EditLimitModal({ isOpen, provider, onClose, onSave }) {
    const [jsonConfig, setJsonConfig] = useState("");

    useEffect(() => {
        if (provider) {
            setJsonConfig(JSON.stringify(provider.config, null, 2));
        }
    }, [provider]);

    const handleSaveClick = () => {
        try {
            const parsed = JSON.parse(jsonConfig);
            onSave(provider.id, parsed);
        } catch (e) {
            alert("Invalid JSON: " + e.message);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit Limits: ${provider?.id}`}>
            <div className="flex flex-col gap-4">
                <div className="text-sm text-text-muted">
                    Edit the JSON configuration for this provider's rate limits.
                </div>
                <textarea
                    className="w-full h-64 p-3 font-mono text-xs bg-gray-50 dark:bg-black/20 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={jsonConfig}
                    onChange={(e) => setJsonConfig(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSaveClick}>Save Changes</Button>
                </div>
            </div>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Mesh Routing Limits tab — consumer-side rate limits per FEE_MODEL.md.
// Persists to /api/settings (PATCH) under top-level keys:
//   meshMaxRatePer1kTokensZat, meshMaxRoutingFeeTotalZat,
//   meshPreferredTrustFloor, meshAllowLocalFallback.
// ---------------------------------------------------------------------------

// Settings-DB key names for mesh limits. Keep these consistent with any
// future server-side consumer of /api/settings.
const MESH_SETTING_KEYS = {
    max_rate_per_1k_tokens_zat: "meshMaxRatePer1kTokensZat",
    max_routing_fee_total_zat: "meshMaxRoutingFeeTotalZat",
    preferred_trust_floor: "meshPreferredTrustFloor",
    allow_local_fallback: "meshAllowLocalFallback",
};

// 1 ZIP = 1e9 ZAT (per FEE_MODEL.md "Units"); $1 per ZIP is the alpha-testnet
// reference rate used for the cost-preview display only — the actual rate
// floats on market once mainnet activity stabilizes.
const ZAT_PER_ZIP = 1_000_000_000;
const PREVIEW_ZIP_USD = 1.0;

function zatPer1kToUsdPer1k(zat) {
    if (!Number.isFinite(zat) || zat <= 0) return 0;
    return (zat / ZAT_PER_ZIP) * PREVIEW_ZIP_USD;
}

function formatUsd(n) {
    if (n === 0) return "$0";
    if (n < 0.0001) return `$${n.toExponential(2)}`;
    return `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function MeshLimitsTab() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState(null);
    const [error, setError] = useState(null);

    // Form state mirrors normalized MeshLimits shape (null = no limit).
    const [maxRate, setMaxRate] = useState("");           // "" or numeric string
    const [maxFee, setMaxFee] = useState("");             // "" or numeric string
    const [trustFloor, setTrustFloor] = useState(DEFAULT_MESH_LIMITS.preferred_trust_floor);
    const [allowFallback, setAllowFallback] = useState(DEFAULT_MESH_LIMITS.allow_local_fallback);

    useEffect(() => {
        (async () => {
            try {
                const res = await safeFetchJson("/api/settings", {
                    cache: "no-store",
                    credentials: "include",
                });
                if (!res.ok) {
                    setError("Failed to load mesh limits.");
                    return;
                }
                const data = res.data || {};
                if (data[MESH_SETTING_KEYS.max_rate_per_1k_tokens_zat] != null) {
                    setMaxRate(String(data[MESH_SETTING_KEYS.max_rate_per_1k_tokens_zat]));
                }
                if (data[MESH_SETTING_KEYS.max_routing_fee_total_zat] != null) {
                    setMaxFee(String(data[MESH_SETTING_KEYS.max_routing_fee_total_zat]));
                }
                if (data[MESH_SETTING_KEYS.preferred_trust_floor] != null) {
                    setTrustFloor(Number(data[MESH_SETTING_KEYS.preferred_trust_floor]));
                }
                if (typeof data[MESH_SETTING_KEYS.allow_local_fallback] === "boolean") {
                    setAllowFallback(data[MESH_SETTING_KEYS.allow_local_fallback]);
                }
            } catch (err) {
                console.error(formatRequestError("Failed to load mesh limits", err));
                setError("Failed to load mesh limits.");
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const parsedMaxRate = maxRate.trim() === "" ? null : Number(maxRate);
    const parsedMaxFee = maxFee.trim() === "" ? null : Number(maxFee);
    const trustFloorNum = Number(trustFloor);

    const handleSave = async () => {
        setError(null);
        setSaving(true);
        setSavedAt(null);

        // Validation: numeric, finite, non-negative (when not null).
        if (parsedMaxRate !== null && (!Number.isFinite(parsedMaxRate) || parsedMaxRate < 0)) {
            setError("Max rate per 1k tokens must be a non-negative number (or empty for no limit).");
            setSaving(false);
            return;
        }
        if (parsedMaxFee !== null && (!Number.isFinite(parsedMaxFee) || parsedMaxFee < 0)) {
            setError("Max routing fee must be a non-negative number (or empty for no limit).");
            setSaving(false);
            return;
        }
        if (!Number.isFinite(trustFloorNum) || trustFloorNum < 0 || trustFloorNum > 100) {
            setError("Trust floor must be between 0 and 100.");
            setSaving(false);
            return;
        }

        try {
            const body = {
                [MESH_SETTING_KEYS.max_rate_per_1k_tokens_zat]: parsedMaxRate,
                [MESH_SETTING_KEYS.max_routing_fee_total_zat]: parsedMaxFee,
                [MESH_SETTING_KEYS.preferred_trust_floor]: trustFloorNum,
                [MESH_SETTING_KEYS.allow_local_fallback]: !!allowFallback,
            };
            const res = await safeFetchJson("/api/settings", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                setError(res.data?.error || "Failed to save mesh limits.");
            } else {
                setSavedAt(Date.now());
            }
        } catch (err) {
            console.error(formatRequestError("Failed to save mesh limits", err));
            setError("Failed to save mesh limits.");
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => {
        setMaxRate("");
        setMaxFee("");
        setTrustFloor(DEFAULT_MESH_LIMITS.preferred_trust_floor);
        setAllowFallback(DEFAULT_MESH_LIMITS.allow_local_fallback);
    };

    // Live preview: simulate what would happen to a small, realistic candidate
    // route set under the current (unsaved) limits.
    const previewRoutes = [
        { provider: "p2p:cheap-direct", rate_per_1k_tokens_zat: 800,  total_routing_fee_zat: 0,        operational_trust: 82 },
        { provider: "p2p:typical-relay", rate_per_1k_tokens_zat: 1500, total_routing_fee_zat: 50_000,   operational_trust: 70 },
        { provider: "p2p:premium",       rate_per_1k_tokens_zat: 2500, total_routing_fee_zat: 200_000,  operational_trust: 92 },
        { provider: "p2p:long-route",    rate_per_1k_tokens_zat: 1200, total_routing_fee_zat: 5_000_000,operational_trust: 60 },
        { provider: "p2p:new-low-trust", rate_per_1k_tokens_zat: 600,  total_routing_fee_zat: 10_000,   operational_trust: 45 },
    ];
    const preview = applyMeshLimits(previewRoutes, {
        max_rate_per_1k_tokens_zat: parsedMaxRate,
        max_routing_fee_total_zat: parsedMaxFee,
        preferred_trust_floor: trustFloorNum,
        allow_local_fallback: !!allowFallback,
    });

    if (loading) return <CardSkeleton />;

    return (
        <div className="flex flex-col gap-4">
            {/* Explainer */}
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 flex gap-3">
                <span className="material-symbols-outlined text-emerald-500 shrink-0 mt-0.5">paid</span>
                <div className="text-sm">
                    <p className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1">Mesh Routing Limits</p>
                    <p className="text-text-muted">
                        When ZippyMesh routes your request through a third-party mesh provider, these limits decide
                        which providers and routes are acceptable. Routes that exceed any of your limits are excluded
                        before the router even scores them. All amounts are denominated in <strong>ZAT</strong> (1 ZIP =
                        1,000,000,000 ZAT, the smallest unit of ZippyCoin).
                    </p>
                    <p className="text-text-muted mt-1">
                        Spec: <code className="text-xs">FEE_MODEL.md § Consumer-side rate limits</code>.
                    </p>
                </div>
            </div>

            <Card className="flex flex-col gap-6">
                {/* Max rate per 1k tokens */}
                <div className="flex flex-col gap-1">
                    <Input
                        label="Max rate per 1,000 tokens (ZAT)"
                        type="number"
                        min="0"
                        step="any"
                        placeholder="e.g. 1500 (leave blank for no limit)"
                        value={maxRate}
                        onChange={(e) => setMaxRate(e.target.value)}
                        hint={
                            parsedMaxRate === null
                                ? "No limit. Any provider rate accepted."
                                : `Reject providers above ${parsedMaxRate} ZAT/1k tokens (~${formatUsd(zatPer1kToUsdPer1k(parsedMaxRate))} per 1k tokens at $1/ZIP).`
                        }
                    />
                    <p className="text-xs text-text-muted">
                        Reference: a typical 1k-token request at 1500 ZAT ≈ <strong>{formatUsd(zatPer1kToUsdPer1k(1500))}</strong> at $1/ZIP.
                        At 100 ZAT it would be ~{formatUsd(zatPer1kToUsdPer1k(100))}.
                    </p>
                </div>

                {/* Max routing fee total */}
                <div className="flex flex-col gap-1">
                    <Input
                        label="Max total routing fee per request (ZAT)"
                        type="number"
                        min="0"
                        step="any"
                        placeholder="e.g. 1000000 (leave blank for no limit)"
                        value={maxFee}
                        onChange={(e) => setMaxFee(e.target.value)}
                        hint={
                            parsedMaxFee === null
                                ? "No limit. Any total routing-fee accepted."
                                : `Reject routes whose summed hop-routing fees exceed ${parsedMaxFee} ZAT.`
                        }
                    />
                    <p className="text-xs text-text-muted">
                        Multi-hop routes pay each relay along the way. Long routes can stack up — this is your ceiling.
                    </p>
                </div>

                {/* Preferred trust floor */}
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-text-main">
                        Preferred trust floor (operational_trust): <span className="font-mono">{trustFloorNum}</span>
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={trustFloorNum}
                        onChange={(e) => setTrustFloor(Number(e.target.value))}
                        className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-xs text-text-muted">
                        <span>0 (anything goes)</span>
                        <span>60 (default)</span>
                        <span>100 (top-tier only)</span>
                    </div>
                    <p className="text-xs text-text-muted">
                        Reject providers and relays whose operational_trust is below this. Trust scores reflect
                        historical reliability, payment-honoring, and uptime. Default 60 matches the FEE_MODEL.md ZTI
                        examples.
                    </p>
                </div>

                {/* Allow local fallback */}
                <div className="flex flex-col gap-1">
                    <Toggle
                        checked={allowFallback}
                        onChange={setAllowFallback}
                        label="Allow local fallback when all mesh routes are rejected"
                        description="If every mesh route exceeds your limits, fall back to a local provider (Ollama, LM Studio, etc.) when one is configured. Disable to fail the request instead."
                    />
                </div>

                {error && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                        {error}
                    </div>
                )}

                <div className="flex items-center justify-between border-t pt-4 dark:border-white/10">
                    <div className="text-xs text-text-muted">
                        {savedAt ? `Saved ${getRelativeTime(new Date(savedAt).toISOString())}` : "Not saved yet"}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={handleReset} disabled={saving}>Reset to defaults</Button>
                        <Button onClick={handleSave} disabled={saving} loading={saving}>
                            Save Mesh Limits
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Live preview against a synthetic candidate set */}
            <Card className="flex flex-col gap-3">
                <div>
                    <h3 className="font-semibold">Preview</h3>
                    <p className="text-xs text-text-muted">
                        Sample of typical mesh candidates evaluated against your <em>current (unsaved)</em> settings.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                        <p className="text-xs uppercase font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
                            Acceptable ({preview.acceptable.length})
                        </p>
                        {preview.acceptable.length === 0 ? (
                            <p className="text-sm text-text-muted italic">
                                No sample routes pass.{" "}
                                {preview.allow_local_fallback
                                    ? "Local fallback would be used."
                                    : "Request would fail with no acceptable routes."}
                            </p>
                        ) : (
                            <ul className="text-sm flex flex-col gap-1">
                                {preview.acceptable.map((r) => (
                                    <li key={r.provider} className="p-2 bg-emerald-50/50 dark:bg-emerald-900/10 rounded flex items-center justify-between">
                                        <span className="font-mono text-xs">{r.provider}</span>
                                        <span className="text-xs text-text-muted">
                                            {r.rate_per_1k_tokens_zat} ZAT/1k · trust {r.operational_trust}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div>
                        <p className="text-xs uppercase font-semibold text-red-600 dark:text-red-400 mb-2">
                            Rejected ({preview.rejected.length})
                        </p>
                        {preview.rejected.length === 0 ? (
                            <p className="text-sm text-text-muted italic">No rejections.</p>
                        ) : (
                            <ul className="text-sm flex flex-col gap-2">
                                {preview.rejected.map(({ route: r, reasons }) => (
                                    <li key={r.provider} className="p-2 bg-red-50/50 dark:bg-red-900/10 rounded">
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-xs">{r.provider}</span>
                                            <span className="text-xs text-text-muted">
                                                {r.rate_per_1k_tokens_zat} ZAT/1k · trust {r.operational_trust}
                                            </span>
                                        </div>
                                        <ul className="mt-1 text-xs text-red-700 dark:text-red-400 list-disc list-inside">
                                            {reasons.map((reason, i) => (<li key={i}>{reason}</li>))}
                                        </ul>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}

function PlaybooksTab() {
    const [playbooks, setPlaybooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showTemplateGallery, setShowTemplateGallery] = useState(false);
    const [showSimulateModal, setShowSimulateModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingPlaybook, setEditingPlaybook] = useState(null);

    useEffect(() => {
        fetchPlaybooks();
    }, []);

    const fetchPlaybooks = async () => {
        try {
            const response = await safeFetchJson("/api/routing/playbooks");
            const data = response.data || {};
            if (response.ok) setPlaybooks(data.playbooks || []);
        } catch (err) {
            console.error("Failed to fetch playbooks:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (data) => {
        try {
            const response = await safeFetchJson("/api/routing/playbooks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            if (response.ok) {
                fetchPlaybooks();
                setShowAddModal(false);
            } else {
                console.error(formatRequestError("Failed to create playbook", response, "Failed to create playbook"));
            }
        } catch (err) {
            console.error("Failed to create playbook:", err);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Are you sure you want to delete this playbook?")) return;
        try {
            const response = await safeFetchJson(`/api/routing/playbooks/${id}`, { method: "DELETE" });
            if (response.ok) {
                setPlaybooks(playbooks.filter(p => p.id !== id));
            } else {
                console.error(formatRequestError("Failed to delete playbook", response, "Failed to delete playbook"));
            }
        } catch (err) {
            console.error("Failed to delete playbook", err);
        }
    }

    const handleExport = (playbook) => {
        const url = `/api/routing/playbooks/${playbook.id}/export`;
        const a = document.createElement('a');
        a.href = url;
        a.download = `playbook-${playbook.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
        a.click();
    };

    const handleDuplicate = async (playbook) => {
        try {
            const response = await safeFetchJson('/api/routing/playbooks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `${playbook.name} (Copy)`,
                    description: playbook.description,
                    rules: playbook.rules,
                    isActive: false,
                }),
            });
            if (response.ok) fetchPlaybooks();
        } catch (err) {
            console.error('Failed to duplicate playbook', err);
        }
    };

    if (loading) return <CardSkeleton />;

    return (
        <div className="flex flex-col gap-4">
            {/* Explainer */}
            <div className="rounded-xl border border-purple-200 dark:border-purple-900/50 bg-purple-50/50 dark:bg-purple-950/20 p-4 flex gap-3">
                <span className="material-symbols-outlined text-purple-500 shrink-0 mt-0.5">menu_book</span>
                <div className="text-sm">
                    <p className="font-semibold text-purple-700 dark:text-purple-300 mb-1">Routing Playbooks</p>
                    <p className="text-text-muted">
                        Playbooks are named rule-sets that override the default routing logic for specific scenarios.
                        For example, a <strong>"Coding"</strong> playbook can pin certain models (e.g. Claude or Qwen-Coder) as the top priority
                        for code-related requests, while a <strong>"Cheap"</strong> playbook always routes to the lowest-cost provider.
                        Playbooks are applied when you include their name in your request metadata.
                    </p>
                    <p className="text-text-muted mt-1">
                        <strong>Tip:</strong> Most users don't need playbooks right away. Start by creating Combos for
                        basic failover, then add playbooks once you need task-specific routing.
                    </p>
                </div>
            </div>

            <div className="flex justify-end gap-2">
                <Button variant="secondary" icon="science" onClick={() => setShowSimulateModal(true)}>Simulate</Button>
                <Button variant="secondary" icon="auto_awesome" onClick={() => setShowTemplateGallery(true)}>From Template</Button>
                <Button variant="secondary" icon="upload" onClick={() => setShowImportModal(true)}>Import</Button>
                <Button icon="add" onClick={() => setShowAddModal(true)}>Create Playbook</Button>
            </div>

            {playbooks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 bg-gray-50 dark:bg-white/2 rounded-xl border border-dashed text-center">
                    <h3 className="text-lg font-medium">No Playbooks Defined</h3>
                    <p className="text-text-muted mt-2 max-w-md">
                        Create a routing playbook to define custom fallback rules for specific scenarios (e.g., Coding, Data Analysis).
                    </p>
                    <Button className="mt-6" variant="secondary" onClick={() => setShowAddModal(true)}>Create First Playbook</Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {playbooks.map(playbook => (
                        <Card key={playbook.id} className="relative group">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="font-semibold">{playbook.name}</h3>
                                <Badge variant={playbook.isActive ? "success" : "default"}>
                                    {playbook.isActive ? "Active" : "Inactive"}
                                </Badge>
                            </div>
                            <p className="text-sm text-text-muted mb-4 line-clamp-2">{playbook.description || "No description provided."}</p>

                            <div className="flex items-center justify-between text-xs text-text-muted mt-auto">
                                <span>{playbook.rules?.length || 0} Rules</span>
                                <span>Updated {getRelativeTime(playbook.updatedAt)}</span>
                            </div>

                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                <button className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-green-500" title="Export JSON" onClick={(e) => { e.stopPropagation(); handleExport(playbook); }}>
                                    <span className="material-symbols-outlined text-sm">download</span>
                                </button>
                                <button className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-blue-500" title="Duplicate" onClick={(e) => { e.stopPropagation(); handleDuplicate(playbook); }}>
                                    <span className="material-symbols-outlined text-sm">content_copy</span>
                                </button>
                                <button className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-blue-500" title="Manage Rules" onClick={(e) => { e.stopPropagation(); setEditingPlaybook(playbook); }}>
                                    <span className="material-symbols-outlined text-sm">settings</span>
                                </button>
                                <button className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-red-500" title="Delete Playbook" onClick={(e) => { e.stopPropagation(); handleDelete(playbook.id); }}>
                                    <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <AddPlaybookModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onCreate={handleCreate}
            />

            <ManageRulesModal
                isOpen={!!editingPlaybook}
                playbook={editingPlaybook}
                onClose={() => setEditingPlaybook(null)}
                onUpdate={(updated) => {
                    setPlaybooks(playbooks.map(p => p.id === updated.id ? updated : p));
                    setEditingPlaybook(null);
                }}
            />

            <SimulateModal isOpen={showSimulateModal} onClose={() => setShowSimulateModal(false)} />

            <ImportModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} onImported={fetchPlaybooks} />

            <Modal isOpen={showTemplateGallery} onClose={() => setShowTemplateGallery(false)} title="Playbook Templates" size="xl">
                <TemplateGallery
                    onCreated={() => {
                        fetchPlaybooks();
                        setShowTemplateGallery(false);
                    }}
                    onClose={() => setShowTemplateGallery(false)}
                />
            </Modal>
        </div>
    );
}

function AddPlaybookModal({ isOpen, onClose, onCreate }) {
    const [name, setName] = useState("");
    const [desc, setDesc] = useState("");

    const handleSubmit = () => {
        onCreate({ name, description: desc, isActive: true, rules: [] });
        setName("");
        setDesc("");
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Routing Playbook">
            <div className="flex flex-col gap-4">
                <Input label="Name" placeholder="e.g. Coding Priorities" value={name} onChange={e => setName(e.target.value)} />
                <Input label="Description" placeholder="Optional description" value={desc} onChange={e => setDesc(e.target.value)} />
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button disabled={!name} onClick={handleSubmit}>Create</Button>
                </div>
            </div>
        </Modal>
    );
}

function ManageRulesModal({ isOpen, playbook, onClose, onUpdate }) {
    const [rules, setRules] = useState([]);
    const [models, setModels] = useState([]);
    const [combos, setCombos] = useState([]);
    const [loadingTargets, setLoadingTargets] = useState(false);
    const [saving, setSaving] = useState(false);

    // New rule state
    const [newType, setNewType] = useState("intent");
    const [newValue, setNewValue] = useState("");
    const [newTarget, setNewTarget] = useState("");

    useEffect(() => {
        if (isOpen && playbook) {
            setRules(playbook.rules || []);
            fetchTargets();
        }
    }, [isOpen, playbook]);

    const fetchTargets = async () => {
        setLoadingTargets(true);
        try {
            const [modelsResponse, combosResponse] = await safeFetchJsonAll([
                { key: "models", url: "/api/v1/models" },
                { key: "combos", url: "/api/combos" },
            ]);
            if (modelsResponse.ok) {
                const modelsData = modelsResponse.data || {};
                setModels(modelsData.data || []);
            } else {
                console.error(formatRequestError("Failed to fetch models", modelsResponse, "Failed to fetch models"));
            }
            if (combosResponse.ok) {
                const combosData = combosResponse.data || {};
                setCombos(combosData.combos || []);
            } else {
                console.error(formatRequestError("Failed to fetch combos", combosResponse, "Failed to fetch combos"));
            }
        } catch (err) {
            console.error("Failed to fetch targets:", err);
        } finally {
            setLoadingTargets(false);
        }
    };

    const handleAddRule = () => {
        if (!newValue || !newTarget) return;
        const newRule = { type: newType, value: newValue, target: newTarget };
        setRules([...rules, newRule]);
        setNewValue("");
        setNewTarget("");
    };

    const handleRemoveRule = (index) => {
        setRules(rules.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const response = await safeFetchJson(`/api/routing/playbooks/${playbook.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...playbook, rules }),
            });
            if (response.ok) {
                const data = response.data || {};
                onUpdate(data.playbook);
            } else {
                console.error(formatRequestError("Failed to update playbook", response, "Failed to update playbook"));
            }
        } catch (err) {
            console.error("Failed to update rules:", err);
        } finally {
            setSaving(false);
        }
    };

    const targetOptions = [
        ...combos.map(c => ({ label: `Combo: ${c.name}`, value: c.id })),
        ...models.map(m => ({ label: `Model: ${m.id}`, value: m.id }))
    ];

    const typeOptions = [
        { label: "Intent (e.g. code)", value: "intent" },
        { label: "Prefix (e.g. gpt-4)", value: "prefix" },
        { label: "Model ID Match", value: "model" },
        { label: "Sort: Cheapest", value: "sort-by-cheapest" },
        { label: "Sort: Fastest", value: "sort-by-fastest" },
        { label: "Stack Order (Failover)", value: "stack" }
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Manage Rules: ${playbook?.name}`} size="lg">
            <div className="flex flex-col gap-6">
                {/* Existing Rules */}
                <div>
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm">list</span>
                        Active Rules
                    </h4>
                    {rules.length === 0 ? (
                        <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-lg border border-dashed text-center text-sm text-text-muted">
                            No rules defined for this playbook yet.
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {rules.map((rule, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-white dark:bg-white/5 border rounded-lg group">
                                    <div className="flex items-center gap-3">
                                        <Badge variant="secondary" size="sm">{rule.type}</Badge>
                                        <span className="text-sm font-mono text-purple-600 dark:text-purple-400">"{Array.isArray(rule.value) ? rule.value.join(", ") : rule.value}"</span>
                                        <span className="material-symbols-outlined text-xs text-text-muted">arrow_forward</span>
                                        <span className="text-sm font-medium">{rule.target}</span>
                                    </div>
                                    <button
                                        onClick={() => handleRemoveRule(idx)}
                                        className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <span className="material-symbols-outlined text-sm">close</span>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Add Rule Form */}
                <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-xl border border-dashed">
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm">add_circle</span>
                        Add New Rule
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Select
                            label="Type"
                            options={typeOptions}
                            value={newType}
                            onChange={e => setNewType(e.target.value)}
                        />
                        <Input
                            label={newType === "stack" ? "Target Scope (e.g. 'all' or model prefix)" : (newType.startsWith("sort-") ? "Scope (e.g. '*')" : "Value")}
                            placeholder={newType === "intent" ? "code" : (newType === "stack" ? "all" : (newType.startsWith("sort-") ? "*" : "gpt-4"))}
                            value={newValue}
                            onChange={e => setNewValue(e.target.value)}
                        />
                        <Select
                            label={newType === "stack" ? "Add to Stack" : (newType.startsWith("sort-") ? "Target (Optional)" : "Target")}
                            options={[{ label: "Any (*)", value: "*" }, ...targetOptions]}
                            value={newType === "stack" ? "" : newTarget}
                            placeholder={loadingTargets ? "Loading..." : (newType === "stack" ? "Select models in order..." : "Select target")}
                            onChange={e => {
                                if (newType === "stack") {
                                    const val = e.target.value;
                                    if (!val) return;
                                    const currentValues = Array.isArray(newValue) ? newValue : (newValue ? newValue.split(",") : []);
                                    if (!currentValues.includes(val)) {
                                        setNewValue([...currentValues, val].join(","));
                                    }
                                } else {
                                    setNewTarget(e.target.value);
                                }
                            }}
                            disabled={loadingTargets}
                        />
                    </div>
                    <div className="mt-4 flex justify-end">
                        <Button
                            size="sm"
                            variant="secondary"
                            disabled={!newValue || !newTarget}
                            onClick={handleAddRule}
                            icon="add"
                        >
                            Add Rule
                        </Button>
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t dark:border-white/10">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving} loading={saving}>
                        Save Playbook
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function ImportModal({ isOpen, onClose, onImported }) {
    const [jsonText, setJsonText] = useState("");
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleImport = async () => {
        setError(null);
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch (e) {
            setError("Invalid JSON: " + e.message);
            return;
        }
        if (!parsed.name || !Array.isArray(parsed.rules)) {
            setError("JSON must contain 'name' and 'rules' fields.");
            return;
        }
        setLoading(true);
        try {
            const res = await safeFetchJson('/api/routing/playbooks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: parsed.name,
                    description: parsed.description || '',
                    rules: parsed.rules,
                    isActive: parsed.isActive ?? true,
                }),
            });
            if (res.ok) {
                onImported();
                setJsonText("");
                onClose();
            } else {
                setError(res.data?.error || "Import failed");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => setJsonText(ev.target?.result || "");
        reader.readAsText(file);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Import Playbook">
            <div className="flex flex-col gap-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Upload JSON file</label>
                    <input type="file" accept=".json,application/json" onChange={handleFileChange}
                        className="text-sm text-text-muted file:mr-4 file:py-1 file:px-3 file:rounded file:border file:border-border file:text-sm file:bg-surface" />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Or paste JSON</label>
                    <textarea
                        value={jsonText}
                        onChange={e => setJsonText(e.target.value)}
                        rows={8}
                        className="w-full font-mono text-xs p-3 bg-black/5 dark:bg-white/5 border border-border rounded-lg resize-none"
                        placeholder='{"name": "My Playbook", "rules": [...]}'
                    />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex gap-2">
                    <Button onClick={handleImport} disabled={!jsonText.trim() || loading} fullWidth>
                        {loading ? "Importing..." : "Import"}
                    </Button>
                    <Button variant="ghost" onClick={onClose} fullWidth>Cancel</Button>
                </div>
            </div>
        </Modal>
    );
}

function SimulateModal({ isOpen, onClose }) {
    const [prompt, setPrompt] = useState("");
    const [intent, setIntent] = useState("");
    const [preferFree, setPreferFree] = useState(false);
    const [preferLocal, setPreferLocal] = useState(false);
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSimulate = async () => {
        if (!prompt.trim()) return;
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const body = {
                messages: [{ role: "user", content: prompt }],
                model: "auto",
                ...(intent && { intent }),
                ...(preferFree || preferLocal ? { constraints: { preferFree, preferLocal } } : {}),
            };
            const response = await safeFetchJson("/api/routing/playbooks/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (response.ok) {
                setResult(response.data);
            } else {
                setError(response.data?.error || "Simulation failed");
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Simulate Routing" size="xl">
            <div className="flex flex-col gap-4">
                <p className="text-sm text-text-muted">
                    Enter a sample prompt to see which model the smart router would select, without sending any real request.
                </p>
                <Input
                    label="Sample Prompt"
                    placeholder="e.g. Write a Python function to sort a list"
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label="Override Intent (optional)"
                        value={intent}
                        onChange={e => setIntent(e.target.value)}
                        options={[
                            { value: "", label: "Auto-detect" },
                            { value: "code", label: "Code" },
                            { value: "reasoning", label: "Reasoning" },
                            { value: "vision", label: "Vision" },
                            { value: "embedding", label: "Embedding" },
                            { value: "fast", label: "Fast" },
                            { value: "default", label: "Default" },
                        ]}
                    />
                </div>
                <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={preferFree} onChange={e => setPreferFree(e.target.checked)} />
                        Prefer Free Models
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={preferLocal} onChange={e => setPreferLocal(e.target.checked)} />
                        Prefer Local Models
                    </label>
                </div>
                <Button onClick={handleSimulate} disabled={!prompt.trim() || loading} icon={loading ? "hourglass_empty" : "science"}>
                    {loading ? "Simulating..." : "Run Simulation"}
                </Button>

                {error && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                        {error}
                    </div>
                )}

                {result && (
                    <div className="flex flex-col gap-3 border-t pt-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                                <p className="text-xs text-text-muted mb-1">Selected Model</p>
                                <p className="font-semibold text-sm truncate">{result.selected}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                                <p className="text-xs text-text-muted mb-1">Detected Intent</p>
                                <p className="font-semibold text-sm">{result.intent || "default"}</p>
                            </div>
                        </div>

                        {result.reason && (
                            <div className="p-3 rounded-lg bg-gray-50 dark:bg-white/5">
                                <p className="text-xs text-text-muted mb-1">Selection Reason</p>
                                <p className="text-sm">{result.reason}</p>
                            </div>
                        )}

                        {result.fallbackChain?.length > 1 && (
                            <div>
                                <p className="text-xs text-text-muted mb-2">Fallback Chain</p>
                                <div className="flex flex-wrap gap-1">
                                    {result.fallbackChain.map((m, i) => (
                                        <span key={i} className={`text-xs px-2 py-1 rounded-full ${i === 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-white/10 text-text-muted'}`}>
                                            {i + 1}. {m.split('/').pop()}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {result.breakdown?.length > 0 && (
                            <div>
                                <p className="text-xs text-text-muted mb-2">Score Breakdown (top {result.breakdown.length})</p>
                                <div className="flex flex-col gap-1">
                                    {result.breakdown.map((item, i) => (
                                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-gray-50 dark:bg-white/5">
                                            <span className="font-mono truncate flex-1">{item.model?.split('/').pop()}</span>
                                            <span className="text-text-muted ml-2 shrink-0">score: {item.score?.toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
