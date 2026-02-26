"use client";

import { useState, useEffect } from "react";
import { Card, Badge, Button, Input, Select } from "@/shared/components";
import Image from "next/image";

export default function MarketplacePage() {
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterProvider, setFilterProvider] = useState("all");

    useEffect(() => {
        fetchModels();
    }, [filterProvider]);

    const fetchModels = async () => {
        setLoading(true);
        try {
            let url = "/api/marketplace/models";
            const params = new URLSearchParams();
            if (filterProvider !== "all") params.append("provider", filterProvider);
            if (search) params.append("search", search);

            if (params.toString()) url += `?${params.toString()}`;

            const res = await fetch(url);
            const data = await res.json();
            if (res.ok) setModels(data.models || []);
        } catch (error) {
            console.error("Error fetching marketplace models:", error);
        } finally {
            setLoading(false);
        }
    };

    const providers = ["all", ...new Set(models.map(m => m.provider))];

    const filteredModels = models.filter(m =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.modelId.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold">Global Model Registry</h1>
                <p className="text-text-muted">Discover and compare models across all your connected providers.</p>
            </div>

            <Card>
                <div className="flex flex-col md:flex-row gap-4 p-4 border-b border-border">
                    <div className="flex-1">
                        <Input
                            placeholder="Search models..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            icon="search"
                        />
                    </div>
                    <div className="w-full md:w-48">
                        <Select
                            options={providers.map(p => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p }))}
                            value={filterProvider}
                            onChange={(e) => setFilterProvider(e.target.value)}
                        />
                    </div>
                    <Button icon="sync" variant="secondary" onClick={fetchModels}>
                        Refresh
                    </Button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-border bg-sidebar/50 text-xs font-medium text-text-muted uppercase tracking-wider">
                                <th className="px-6 py-4">Model</th>
                                <th className="px-6 py-4">Provider</th>
                                <th className="px-6 py-4">Context</th>
                                <th className="px-6 py-4">Pricing (1M Tokens)</th>
                                <th className="px-6 py-4">Latency</th>
                                <th className="px-6 py-4">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-12 text-center text-text-muted">
                                        <div className="flex items-center justify-center gap-2">
                                            <span className="material-symbols-outlined animate-spin-slow">sync</span>
                                            Loading models...
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredModels.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-12 text-center text-text-muted">
                                        No models found in the registry.
                                    </td>
                                </tr>
                            ) : (
                                filteredModels.map((model) => (
                                    <tr key={model.id} className="hover:bg-sidebar/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-sm">{model.name}</span>
                                                <span className="text-xs text-text-muted">{model.modelId}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1 rounded bg-sidebar border border-border">
                                                    <Image
                                                        src={`/providers/${model.provider}.png`}
                                                        alt={model.provider}
                                                        width={16}
                                                        height={16}
                                                        className="object-contain"
                                                        onError={(e) => e.target.style.display = 'none'}
                                                    />
                                                </div>
                                                <span className="text-sm capitalize">{model.provider}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <Badge variant="secondary" size="sm">
                                                {model.contextWindow ? `${(model.contextWindow / 1024).toFixed(0)}k` : "Unknown"}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col text-xs">
                                                <span className="text-text-muted">In: <span className="text-text font-medium">${(model.inputPrice * 1000).toFixed(2)}</span></span>
                                                <span className="text-text-muted">Out: <span className="text-text font-medium">${(model.outputPrice * 1000).toFixed(2)}</span></span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {model.avgLatency ? (
                                                <div className="flex flex-col">
                                                    <span className="text-sm">{model.avgLatency}ms</span>
                                                    {model.avgTps && <span className="text-xs text-text-muted">{model.avgTps} t/s</span>}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-text-muted">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-1 flex-wrap">
                                                {model.isFree && <Badge variant="success" size="sm">Free</Badge>}
                                                {model.isPremium && <Badge variant="warning" size="sm">Premium</Badge>}
                                                {model.isPreview && <Badge variant="default" size="sm">Preview</Badge>}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
