"use client";

import { useState, useEffect } from "react";
import { Card, Badge, Button, Input, Select } from "@/shared/components";
import Image from "next/image";

export default function MarketplacePage() {
    const [models, setModels] = useState([]);
    const [costModels, setCostModels] = useState([]);
    const [spotPriceModels, setSpotPriceModels] = useState([]);
    const [scoreRows, setScoreRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [costLoading, setCostLoading] = useState(true);
    const [spotPriceLoading, setSpotPriceLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterProvider, setFilterProvider] = useState("all");
    const [intent, setIntent] = useState("code");
    const [activeView, setActiveView] = useState("registry");
    const [spotPriceFilter, setSpotPriceFilter] = useState("all");

    useEffect(() => {
        fetchModels();
        fetchCosts();
        fetchScores("code");
    }, [filterProvider]);

    useEffect(() => {
        if (activeView === "spot") fetchSpotPrices();
    }, [activeView, spotPriceFilter]);

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

    const fetchCosts = async () => {
        setCostLoading(true);
        try {
            const res = await fetch("/api/marketplace/costs");
            const data = await res.json();
            if (res.ok) setCostModels(data.models || []);
        } catch (error) {
            console.error("Error fetching marketplace costs:", error);
        } finally {
            setCostLoading(false);
        }
    };

    const fetchSpotPrices = async () => {
        setSpotPriceLoading(true);
        try {
            const params = new URLSearchParams();
            if (spotPriceFilter !== "all") params.append("source", spotPriceFilter);
            const res = await fetch(`/api/marketplace/spot-prices?${params.toString()}`);
            const data = await res.json();
            if (res.ok) setSpotPriceModels(data.models || []);
        } catch (error) {
            console.error("Error fetching spot prices:", error);
        } finally {
            setSpotPriceLoading(false);
        }
    };

    const fetchScores = async (nextIntent) => {
        try {
            const res = await fetch(`/api/marketplace/models/scores?intent=${encodeURIComponent(nextIntent)}`);
            const data = await res.json();
            if (res.ok) setScoreRows(data.scores || []);
        } catch (error) {
            console.error("Error fetching scores:", error);
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
                <div className="flex items-center gap-2 p-4 border-b border-border">
                    <Button variant={activeView === "registry" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("registry")}>
                        Registry
                    </Button>
                    <Button variant={activeView === "costs" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("costs")}>
                        Cost Comparison
                    </Button>
                    <Button variant={activeView === "spot" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("spot")}>
                        Spot Price Matrix
                    </Button>
                    <Button variant={activeView === "intelligence" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("intelligence")}>
                        Intent Intelligence
                    </Button>
                </div>
            </Card>

            {activeView === "registry" && (
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
            )}

            {activeView === "spot" && (
                <Card padding="none">
                    <div className="p-4 border-b border-border flex flex-col md:flex-row md:items-center gap-3">
                        <div className="flex-1">
                            <h2 className="text-lg font-semibold">Spot Price Matrix</h2>
                            <p className="text-sm text-text-muted">Cheapest provider per model (1M input + 500k output tokens). Compare spot prices across providers.</p>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Select
                                options={[
                                    { label: "All Providers", value: "all" },
                                    { label: "Local Only", value: "local" },
                                    { label: "Cloud Only", value: "cloud" },
                                    { label: "OAuth Only", value: "oauth" },
                                    { label: "API Key Only", value: "api-key" },
                                ]}
                                value={spotPriceFilter}
                                onChange={(e) => {
                                    setSpotPriceFilter(e.target.value);
                                }}
                            />
                            <Button icon="sync" variant="secondary" onClick={fetchSpotPrices}>Refresh</Button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border bg-sidebar/50 text-xs font-medium text-text-muted uppercase tracking-wider">
                                    <th className="px-6 py-4">Canonical Model</th>
                                    <th className="px-6 py-4">Spot Price (USD)</th>
                                    <th className="px-6 py-4">Cheapest Provider</th>
                                    <th className="px-6 py-4">All Offers</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {spotPriceLoading ? (
                                    <tr><td colSpan="4" className="px-6 py-10 text-center text-text-muted">Loading spot prices...</td></tr>
                                ) : !spotPriceModels.length ? (
                                    <tr><td colSpan="4" className="px-6 py-10 text-center text-text-muted">No spot price data available.</td></tr>
                                ) : (
                                    spotPriceModels.map((row) => (
                                        <tr key={row.canonicalModelId} className="hover:bg-sidebar/30 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-semibold text-sm">{row.modelDisplayName}</div>
                                                <div className="text-xs text-text-muted">{row.canonicalModelId}</div>
                                            </td>
                                            <td className="px-6 py-4 font-mono font-bold">${Number(row.spotPriceUsd || 0).toFixed(4)}</td>
                                            <td className="px-6 py-4">
                                                {row.cheapestOffer ? (
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant={row.cheapestOffer.isLocal ? "success" : "secondary"} size="sm">
                                                            {row.cheapestOffer.provider}
                                                        </Badge>
                                                        <span className="text-xs text-text-muted">{row.cheapestOffer.providerModelId}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-text-muted">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1 text-xs max-w-xs">
                                                    {(row.offers || []).slice(0, 5).map((offer, idx) => (
                                                        <span key={`${offer.provider}-${offer.providerModelId}-${idx}`}>
                                                            {offer.provider}: ${offer.inputPerMUsd.toFixed(2)} in / ${offer.outputPerMUsd.toFixed(2)} out
                                                            {offer.costDeltaVsCheapest > 0 && (
                                                                <span className="text-text-muted ml-1">(+${offer.costDeltaVsCheapest.toFixed(4)})</span>
                                                            )}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {activeView === "costs" && (
                <Card padding="none">
                    <div className="p-4 border-b border-border flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold">Canonical Cost Comparison</h2>
                            <p className="text-sm text-text-muted">Normalized scenario: 1M input + 500k output tokens.</p>
                        </div>
                        <Button icon="sync" variant="secondary" onClick={fetchCosts}>Refresh</Button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border bg-sidebar/50 text-xs font-medium text-text-muted uppercase tracking-wider">
                                    <th className="px-6 py-4">Canonical Model</th>
                                    <th className="px-6 py-4">Best Scenario Cost</th>
                                    <th className="px-6 py-4">Offers</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {costLoading ? (
                                    <tr><td colSpan="3" className="px-6 py-10 text-center text-text-muted">Loading cost comparison...</td></tr>
                                ) : !costModels.length ? (
                                    <tr><td colSpan="3" className="px-6 py-10 text-center text-text-muted">No cost rows available.</td></tr>
                                ) : (
                                    costModels.map((row) => (
                                        <tr key={row.canonicalModelId} className="hover:bg-sidebar/30 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-semibold text-sm">{row.modelDisplayName}</div>
                                                <div className="text-xs text-text-muted">{row.canonicalModelId}</div>
                                            </td>
                                            <td className="px-6 py-4">${Number(row.normalizedScenarioCostUsd || 0).toFixed(4)}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1 text-xs">
                                                    {(row.offers || []).slice(0, 5).map((offer, idx) => (
                                                        <span key={`${offer.provider}-${offer.providerModelId}-${idx}`}>
                                                            {offer.provider}: ${offer.inputPerMUsd.toFixed(2)} in / ${offer.outputPerMUsd.toFixed(2)} out
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {activeView === "intelligence" && (
                <Card padding="none">
                    <div className="p-4 border-b border-border flex flex-col md:flex-row md:items-center gap-3">
                        <div className="flex-1">
                            <h2 className="text-lg font-semibold">Intent-Based Intelligence</h2>
                            <p className="text-sm text-text-muted">Benchmark-backed where available, metadata-inferred otherwise.</p>
                        </div>
                        <div className="w-full md:w-56">
                            <Select
                                options={[
                                    { label: "Code", value: "code" },
                                    { label: "Reasoning", value: "reasoning" },
                                    { label: "Tool Use", value: "tool_use" },
                                    { label: "Chat", value: "chat" },
                                ]}
                                value={intent}
                                onChange={(e) => {
                                    setIntent(e.target.value);
                                    fetchScores(e.target.value);
                                }}
                            />
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border bg-sidebar/50 text-xs font-medium text-text-muted uppercase tracking-wider">
                                    <th className="px-6 py-4">Provider</th>
                                    <th className="px-6 py-4">Model</th>
                                    <th className="px-6 py-4">{intent} Score</th>
                                    <th className="px-6 py-4">Confidence</th>
                                    <th className="px-6 py-4">Overall</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {!scoreRows.length ? (
                                    <tr><td colSpan="5" className="px-6 py-10 text-center text-text-muted">No intelligence rows available.</td></tr>
                                ) : (
                                    scoreRows.slice(0, 100).map((row, idx) => (
                                        <tr key={`${row.provider}-${row.modelId}-${idx}`} className="hover:bg-sidebar/30 transition-colors">
                                            <td className="px-6 py-4 capitalize">{row.provider}</td>
                                            <td className="px-6 py-4 text-sm">{row.modelId}</td>
                                            <td className="px-6 py-4">{row.intents?.[intent] ?? "-"}</td>
                                            <td className="px-6 py-4">
                                                <Badge variant={row.confidence === "benchmark_backed" ? "success" : "secondary"} size="sm">
                                                    {row.confidence}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4">{row.overallScore}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
}
