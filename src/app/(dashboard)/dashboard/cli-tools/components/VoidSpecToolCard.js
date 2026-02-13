"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";

export default function VoidSpecToolCard({
    tool,
    isExpanded,
    onToggle,
    baseUrl,
    hasActiveProviders,
    apiKeys,
    activeProviders,
}) {
    const [applying, setApplying] = useState(false);
    const [message, setMessage] = useState(null);
    const [selectedApiKey, setSelectedApiKey] = useState("");
    const [selectedModel, setSelectedModel] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [modelAliases, setModelAliases] = useState({});
    const [showManualConfigModal, setShowManualConfigModal] = useState(false);
    const [customBaseUrl, setCustomBaseUrl] = useState("");

    useEffect(() => {
        if (apiKeys?.length > 0 && !selectedApiKey) {
            setSelectedApiKey(apiKeys[0].key);
        }
    }, [apiKeys, selectedApiKey]);

    useEffect(() => {
        if (isExpanded) {
            fetchModelAliases();
        }
    }, [isExpanded]);

    const fetchModelAliases = async () => {
        try {
            const res = await fetch("/api/models/alias");
            const data = await res.json();
            if (res.ok) setModelAliases(data.aliases || {});
        } catch (error) {
            console.log("Error fetching model aliases:", error);
        }
    };

    const getEffectiveBaseUrl = () => {
        const url = customBaseUrl || baseUrl;
        return url.endsWith("/v1") ? url : `${url}/v1`;
    };

    const handleModelSelect = (model) => {
        setSelectedModel(model.value);
        setModalOpen(false);
    };

    const getManualConfigs = () => {
        const keyToUse = (selectedApiKey && selectedApiKey.trim())
            ? selectedApiKey
            : "sk_zippymesh";

        const settingsContent = {
            "voidspec.router.enabled": true,
            "voidspec.router.url": getEffectiveBaseUrl(),
            "voidspec.router.apiKey": keyToUse,
            "voidspec.router.model": selectedModel || "cc/claude-opus-4-6",
            "voidspec.router.prompted": true
        };

        return [
            {
                filename: "VS Code settings.json",
                content: JSON.stringify(settingsContent, null, 2),
            },
        ];
    };

    return (
        <Card padding="sm" className="overflow-hidden">
            <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
                <div className="flex items-center gap-3">
                    <div className="size-8 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-primary text-[32px]">Spec</span>
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-medium text-sm">{tool.name}</h3>
                        <p className="text-xs text-text-muted truncate">{tool.description}</p>
                    </div>
                </div>
                <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
            </div>

            {isExpanded && (
                <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        {/* Base URL */}
                        <div className="flex items-center gap-2">
                            <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">Base URL</span>
                            <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                            <input
                                type="text"
                                value={customBaseUrl || baseUrl}
                                onChange={(e) => setCustomBaseUrl(e.target.value)}
                                placeholder="https://.../v1"
                                className="flex-1 px-2 py-1.5 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>

                        {/* API Key */}
                        <div className="flex items-center gap-2">
                            <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">API Key</span>
                            <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                            {apiKeys.length > 0 ? (
                                <select value={selectedApiKey} onChange={(e) => setSelectedApiKey(e.target.value)} className="flex-1 px-2 py-1.5 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50">
                                    {apiKeys.map((key) => <option key={key.id} value={key.key}>{key.key}</option>)}
                                </select>
                            ) : (
                                <span className="flex-1 text-xs text-text-muted px-2 py-1.5">sk_zippymesh (default)</span>
                            )}
                        </div>

                        {/* Model */}
                        <div className="flex items-center gap-2">
                            <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">Model</span>
                            <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                            <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="cc/claude-opus-4-6" className="flex-1 px-2 py-1.5 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50" />
                            <button onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className={`px-2 py-1.5 rounded border text-xs transition-colors shrink-0 whitespace-nowrap ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select Model</button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="primary" size="sm" onClick={() => setShowManualConfigModal(true)} disabled={!selectedModel}>
                            <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Get Config
                        </Button>
                    </div>

                    <p className="text-[10px] text-text-muted italic"> VoidSpec uses VS Code settings. Copy the recommended JSON above to your VS Code settings.json file. </p>
                </div>
            )}

            <ModelSelectModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                onSelect={handleModelSelect}
                selectedModel={selectedModel}
                activeProviders={activeProviders}
                modelAliases={modelAliases}
                title="Select Model for VoidSpec"
            />

            <ManualConfigModal
                isOpen={showManualConfigModal}
                onClose={() => setShowManualConfigModal(false)}
                title="VoidSpec - Manual Configuration"
                configs={getManualConfigs()}
            />
        </Card>
    );
}
