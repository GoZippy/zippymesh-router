"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import Select from "./Select";
import { safeFetchJson } from "@/shared/utils";

const INTENT_OPTIONS = [
    { value: "code", label: "Code" },
    { value: "reasoning", label: "Reasoning" },
    { value: "vision", label: "Vision" },
    { value: "embedding", label: "Embedding" },
    { value: "fast", label: "Fast" },
    { value: "default", label: "Default (any)" },
];

/**
 * Reusable modal for adding a model/provider to a routing playbook.
 * @param {string} modelId - The model or provider ID to add
 * @param {string} modelName - Display name
 * @param {boolean} isOpen
 * @param {function} onClose
 */
export default function AddToPlaybookModal({ modelId, modelName, isOpen, onClose }) {
    const [mode, setMode] = useState("existing"); // "existing" | "new"
    const [playbooks, setPlaybooks] = useState([]);
    const [selectedPlaybook, setSelectedPlaybook] = useState("");
    const [ruleType, setRuleType] = useState("boost");
    const [newName, setNewName] = useState("");
    const [newIntent, setNewIntent] = useState("default");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setSuccess(null);
            setError(null);
            safeFetchJson("/api/routing/playbooks").then(res => {
                if (res.ok) setPlaybooks(res.data?.playbooks || []);
            });
        }
    }, [isOpen]);

    const handleSubmit = async () => {
        setLoading(true);
        setError(null);
        try {
            if (mode === "existing") {
                if (!selectedPlaybook) { setError("Select a playbook"); setLoading(false); return; }
                const pb = playbooks.find(p => p.id === selectedPlaybook);
                if (!pb) { setError("Playbook not found"); setLoading(false); return; }
                const updatedRules = [...(pb.rules || []), { type: ruleType, target: modelId, value: ruleType === "boost" ? 50000 : undefined }];
                const res = await safeFetchJson(`/api/routing/playbooks/${selectedPlaybook}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...pb, rules: updatedRules }),
                });
                if (res.ok) setSuccess({ playbookName: pb.name });
                else setError(res.data?.error || "Failed to update playbook");
            } else {
                if (!newName.trim()) { setError("Enter a name"); setLoading(false); return; }
                const res = await safeFetchJson("/api/routing/playbooks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: newName.trim(),
                        description: `Auto-created: routes ${modelId} for ${newIntent} tasks`,
                        trigger: { type: "intent", value: newIntent },
                        rules: [{ type: "boost", target: modelId, value: 80000 }],
                        isActive: true,
                    }),
                });
                if (res.ok) setSuccess({ playbookName: newName.trim() });
                else setError(res.data?.error || "Failed to create playbook");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Add to Routing Rules`}>
            <div className="flex flex-col gap-4">
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm font-medium">{modelName || modelId}</p>
                    <p className="text-xs text-text-muted font-mono mt-0.5">{modelId}</p>
                </div>

                {success ? (
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                        <span className="material-symbols-outlined text-green-500 text-[48px]">check_circle</span>
                        <p className="font-medium">Added to <strong>{success.playbookName}</strong></p>
                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={() => { window.location.href = '/dashboard/routing'; }}>View Rules</Button>
                            <Button variant="ghost" onClick={onClose}>Done</Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setMode("existing")}
                                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${mode === "existing" ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted"}`}
                            >
                                Add to Existing
                            </button>
                            <button
                                onClick={() => setMode("new")}
                                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${mode === "new" ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted"}`}
                            >
                                Create New
                            </button>
                        </div>

                        {mode === "existing" ? (
                            <>
                                <Select
                                    label="Select Routing Rule Set"
                                    value={selectedPlaybook}
                                    onChange={e => setSelectedPlaybook(e.target.value)}
                                    options={[
                                        { value: "", label: "Choose a rule set..." },
                                        ...playbooks.filter(p => p.isActive).map(p => ({ value: p.id, label: p.name }))
                                    ]}
                                />
                                <Select
                                    label="Rule Type"
                                    value={ruleType}
                                    onChange={e => setRuleType(e.target.value)}
                                    options={[
                                        { value: "boost", label: "Boost — prioritize this model" },
                                        { value: "filter-in", label: "Filter — only allow this model" },
                                    ]}
                                />
                            </>
                        ) : (
                            <>
                                <Input label="New Rule Set Name" placeholder="e.g. My Coding Rules" value={newName} onChange={e => setNewName(e.target.value)} />
                                <Select label="For which request type?" value={newIntent} onChange={e => setNewIntent(e.target.value)} options={INTENT_OPTIONS} />
                            </>
                        )}

                        {error && <p className="text-sm text-red-500">{error}</p>}

                        <div className="flex gap-2 pt-2">
                            <Button onClick={handleSubmit} disabled={loading} fullWidth>
                                {loading ? "Saving..." : mode === "existing" ? "Add to Rule Set" : "Create Rule Set"}
                            </Button>
                            <Button variant="ghost" onClick={onClose} fullWidth>Cancel</Button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}
