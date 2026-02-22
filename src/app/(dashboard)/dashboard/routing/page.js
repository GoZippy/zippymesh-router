
"use client";

import { useState, useEffect } from "react";
import { Card, CardSkeleton, Badge, Button, Input, Modal, Select } from "@/shared/components";
import { getRelativeTime } from "@/shared/utils";

export default function RoutingPage() {
    const [activeTab, setActiveTab] = useState("limits"); // "limits" or "playbooks"

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-bold">Routing Intelligence</h1>
                <p className="text-sm text-text-muted mt-1">
                    Control how ZippyMesh selects providers, respects rate limits, and fails over between models
                </p>
            </div>
            <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
                <button
                    onClick={() => setActiveTab("limits")}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "limits"
                        ? "bg-white dark:bg-gray-700 shadow-sm"
                        : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        }`}
                >
                    Provider Limits
                </button>
                <button
                    onClick={() => setActiveTab("playbooks")}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "playbooks"
                        ? "bg-white dark:bg-gray-700 shadow-sm"
                        : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        }`}
                >
                    Routing Playbooks
                </button>
            </div>

            {activeTab === "limits" ? <ProviderLimitsTab /> : <PlaybooksTab />}
        </div>
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
            const res = await fetch("/api/routing/limits");
            const data = await res.json();
            if (res.ok) setConfigs(data.configs || {});
        } catch (err) {
            console.error("Failed to fetch limits:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (providerId, newConfig) => {
        try {
            const res = await fetch("/api/routing/limits", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ providerId, config: newConfig }),
            });
            if (res.ok) {
                setConfigs({ ...configs, [providerId]: newConfig });
                setEditingProvider(null);
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
                    <div key={i} className="flex items-center justify-between text-sm p-2 bg-gray-50 dark:bg-white/[0.02] rounded">
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

function PlaybooksTab() {
    const [playbooks, setPlaybooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingPlaybook, setEditingPlaybook] = useState(null);

    useEffect(() => {
        fetchPlaybooks();
    }, []);

    const fetchPlaybooks = async () => {
        try {
            const res = await fetch("/api/routing/playbooks");
            const data = await res.json();
            if (res.ok) setPlaybooks(data.playbooks || []);
        } catch (err) {
            console.error("Failed to fetch playbooks:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (data) => {
        try {
            const res = await fetch("/api/routing/playbooks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            if (res.ok) {
                fetchPlaybooks();
                setShowAddModal(false);
            }
        } catch (err) {
            console.error("Failed to create playbook:", err);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Are you sure you want to delete this playbook?")) return;
        try {
            await fetch(`/api/routing/playbooks/${id}`, { method: "DELETE" });
            setPlaybooks(playbooks.filter(p => p.id !== id));
        } catch (err) {
            console.error("Failed to delete playbook", err);
        }
    }

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

            <div className="flex justify-end">
                <Button icon="add" onClick={() => setShowAddModal(true)}>Create Playbook</Button>
            </div>

            {playbooks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-dashed text-center">
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
            const [modelsRes, combosRes] = await Promise.all([
                fetch("/api/v1/models"),
                fetch("/api/combos")
            ]);
            const modelsData = await modelsRes.json();
            const combosData = await combosRes.json();

            setModels(modelsData.data || []);
            setCombos(combosData.combos || []);
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
            const res = await fetch(`/api/routing/playbooks/${playbook.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...playbook, rules }),
            });
            if (res.ok) {
                const data = await res.json();
                onUpdate(data.playbook);
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
                            label={newType === "stack" ? "Target Scope (e.g. 'all' or model prefix)" : "Value"}
                            placeholder={newType === "intent" ? "code" : (newType === "stack" ? "all" : "gpt-4")}
                            value={newValue}
                            onChange={e => setNewValue(e.target.value)}
                        />
                        <Select
                            label={newType === "stack" ? "Add to Stack" : "Target"}
                            options={targetOptions}
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
