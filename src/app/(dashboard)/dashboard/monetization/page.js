"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components/Card";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import Badge from "@/shared/components/Badge";
import { getWalletBalance } from "@/lib/sidecar";
import Link from "next/link";

const SOURCE_LABELS = { local: "Local (Ollama/LM Studio)", cloud: "Cloud", oauth: "OAuth", "api-key": "API Key" };
const PRICING_STRATEGIES = [
  { value: "spot+margin", label: "Spot + margin %" },
  { value: "spot+fixed", label: "Spot + fixed per request" },
  { value: "custom", label: "Custom (manual)" },
];

function formatCost(usd) {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

export default function MonetizationPage() {
  const [balance, setBalance] = useState({ balance: 0, currency: "ZIP" });
  const [offered, setOffered] = useState([]);
  const [available, setAvailable] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [walkthroughStep, setWalkthroughStep] = useState(0);
  const [selectedToAdd, setSelectedToAdd] = useState(null);
  const [draftOffer, setDraftOffer] = useState({
    pricingStrategy: "spot+margin",
    marginPercent: 20,
    fixedPerRequestUsd: 0,
  });

  async function fetchData() {
    setError(null);
    try {
      const [bal, modelsRes] = await Promise.all([
        getWalletBalance().catch(() => ({ balance: 0, currency: "ZIP" })),
        fetch("/api/mesh/offered-models"),
      ]);
      if (bal) setBalance(bal);
      if (modelsRes.ok) {
        const d = await modelsRes.json();
        setOffered(d.offered || []);
        setAvailable(d.available || []);
        setRecommendations(d.recommendations || []);
      } else {
        setError("Could not load models. Add providers first.");
      }
    } catch (e) {
      console.error("Failed to fetch monetization data", e);
      setError("Failed to load data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleSaveOffered() {
    setSaving(true);
    try {
      const res = await fetch("/api/mesh/offered-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offered }),
      });
      if (res.ok) {
        const d = await res.json();
        setOffered(d.offered || []);
        setSelectedToAdd(null);
        setWalkthroughStep(0);
        alert("Monetization config saved. Mesh will announce your models (provider not exposed).");
      } else {
        alert("Failed to save.");
      }
    } catch (e) {
      alert("Error saving.");
    } finally {
      setSaving(false);
    }
  }

  function addModel(av) {
    const cheapest = av.cheapestOffer;
    if (!cheapest) return;
    const existing = offered.find((o) => o.canonicalModelId === av.canonicalModelId);
    if (existing) return;
    const newOffer = {
      canonicalModelId: av.canonicalModelId,
      displayName: av.displayName || av.canonicalModelId,
      backingProvider: cheapest.provider,
      backingModelId: cheapest.modelId,
      source: cheapest.source,
      baseCostInputPerMUsd: cheapest.inputPerMUsd,
      baseCostOutputPerMUsd: cheapest.outputPerMUsd,
      pricingStrategy: draftOffer.pricingStrategy,
      marginPercent: draftOffer.marginPercent ?? 20,
      fixedPerRequestUsd: draftOffer.fixedPerRequestUsd ?? 0,
    };
    setOffered((prev) => [...prev, newOffer]);
    setSelectedToAdd(null);
    setDraftOffer({ pricingStrategy: "spot+margin", marginPercent: 20, fixedPerRequestUsd: 0 });
  }

  function removeModel(canonicalModelId) {
    setOffered((prev) => prev.filter((o) => o.canonicalModelId !== canonicalModelId));
  }

  function updateOffer(canonicalModelId, updates) {
    setOffered((prev) =>
      prev.map((o) =>
        o.canonicalModelId === canonicalModelId ? { ...o, ...updates } : o
      )
    );
  }

  const offeredIds = new Set(offered.map((o) => o.canonicalModelId));
  const canAdd = available.filter((a) => !offeredIds.has(a.canonicalModelId));

  if (loading) return <div className="p-8">Loading Monetization Data...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Monetization & Mesh</h1>

      {/* Wallet Section */}
      <Card className="p-6 bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-indigo-100 font-medium">Current Balance</p>
            <h2 className="text-4xl font-bold mt-2">
              {Number(balance?.balance ?? 0).toFixed(4)} <span className="text-xl opacity-80">{balance?.currency ?? "ZIP"}</span>
            </h2>
          </div>
          <Link href="/dashboard/wallet">
            <Button variant="secondary" className="bg-white text-indigo-600 hover:bg-gray-100">
              Wallet
            </Button>
          </Link>
        </div>
      </Card>

      {error && (
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
          {error} <Link href="/dashboard/providers" className="underline font-medium">Add Providers</Link>
        </div>
      )}

      {/* Walkthrough: Add Models to Monetize */}
      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-2">Add Models to the Mesh</h3>
        <p className="text-gray-500 dark:text-text-muted mb-4">
          Expose models to the network by name only—your provider stays private. Choose from local runtimes (Ollama, LM Studio), controlled nodes, or OAuth/API providers. Costs shown are from your instance.
        </p>

        {walkthroughStep === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-text-muted">
              <strong>Step 1:</strong> Pick models you have access to. Base costs are from your instance (local vs cloud).
            </p>
            {recommendations?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-text-muted mb-2">Suggested (local first, then cheap cloud)</p>
                <div className="flex flex-wrap gap-2">
                  {recommendations.map((r) => (
                    <button
                      key={r.canonicalModelId}
                      type="button"
                      onClick={() => {
                        const av = canAdd.find((a) => a.canonicalModelId === r.canonicalModelId);
                        if (av) {
                          setSelectedToAdd(av);
                          setWalkthroughStep(1);
                        }
                      }}
                      className="px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 text-sm"
                    >
                      {r.displayName}
                      <span className="ml-2 text-xs text-text-muted">{r.reason}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {canAdd.slice(0, 16).map((av) => (
                <button
                  key={av.canonicalModelId}
                  type="button"
                  onClick={() => {
                    setSelectedToAdd(av);
                    setWalkthroughStep(1);
                  }}
                  className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:border-primary bg-transparent text-sm"
                >
                  {av.displayName || av.canonicalModelId}
                  <span className="ml-2 text-xs text-text-muted">
                    {formatCost(av.spotPriceUsd)}/1M
                  </span>
                </button>
              ))}
              {canAdd.length > 16 && (
                <span className="text-sm text-text-muted self-center">+{canAdd.length - 16} more</span>
              )}
            </div>
            {canAdd.length === 0 && (
              <p className="text-sm text-text-muted">
                {available.length === 0
                  ? "No models in registry. Add providers in "
                  : "All available models are already offered. Add more in "}
                <Link href="/dashboard/providers" className="text-primary underline">Providers</Link>.
              </p>
            )}
          </div>
        )}

        {walkthroughStep === 1 && selectedToAdd && (
          <div className="space-y-4">
            <p className="text-sm font-medium">
              <strong>Step 2:</strong> Set pricing for &quot;{selectedToAdd.displayName || selectedToAdd.canonicalModelId}&quot;
            </p>
            <div className="p-4 rounded-lg bg-muted/10 border border-black/5 dark:border-white/5 space-y-3">
              <div className="flex justify-between text-sm">
                <span>Base cost (your instance)</span>
                <span>{formatCost(selectedToAdd.spotPriceUsd)} per 1M tokens</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Cheapest source</span>
                <Badge variant="default">{SOURCE_LABELS[selectedToAdd.cheapestOffer?.source] || selectedToAdd.cheapestOffer?.source}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Pricing strategy"
                options={PRICING_STRATEGIES}
                value={draftOffer.pricingStrategy}
                onChange={(e) => setDraftOffer({ ...draftOffer, pricingStrategy: e.target.value })}
              />
              {draftOffer.pricingStrategy === "spot+margin" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Margin %</label>
                  <Input
                    type="number"
                    min={0}
                    max={200}
                    value={draftOffer.marginPercent}
                    onChange={(e) => setDraftOffer({ ...draftOffer, marginPercent: Number(e.target.value) })}
                  />
                </div>
              )}
              {draftOffer.pricingStrategy === "spot+fixed" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Fixed $ per request</label>
                  <Input
                    type="number"
                    step="0.001"
                    min={0}
                    value={draftOffer.fixedPerRequestUsd}
                    onChange={(e) => setDraftOffer({ ...draftOffer, fixedPerRequestUsd: Number(e.target.value) })}
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  addModel(selectedToAdd);
                  setSelectedToAdd(null);
                  setWalkthroughStep(0);
                }}
              >
                Add to offered models
              </Button>
              <Button variant="outline" onClick={() => setWalkthroughStep(0)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Offered Models Table */}
      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-4">Models Offered to Mesh</h3>
        <p className="text-gray-500 mb-4">
          Only model names are announced—your provider connection is never exposed.
        </p>
        {offered.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No models offered yet. Use the walkthrough above to add models.
          </div>
        ) : (
          <div className="space-y-3">
            {offered.map((o) => (
              <div
                key={o.canonicalModelId}
                className="flex items-center justify-between p-3 rounded-lg border border-black/10 dark:border-white/10"
              >
                <div>
                  <span className="font-medium">{o.displayName || o.canonicalModelId}</span>
                  <span className="ml-2 text-xs text-text-muted">
                    {o.pricingStrategy === "spot+margin" && `${o.marginPercent}% margin`}
                    {o.pricingStrategy === "spot+fixed" && `+$${o.fixedPerRequestUsd}/req`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    options={PRICING_STRATEGIES}
                    value={o.pricingStrategy || "spot+margin"}
                    onChange={(e) => updateOffer(o.canonicalModelId, { pricingStrategy: e.target.value })}
                    selectClassName="py-1 text-xs"
                  />
                  {o.pricingStrategy === "spot+margin" && (
                    <Input
                      type="number"
                      min={0}
                      max={200}
                      className="w-20 py-1 text-sm"
                      value={o.marginPercent}
                      onChange={(e) => updateOffer(o.canonicalModelId, { marginPercent: Number(e.target.value) })}
                    />
                  )}
                  <Button variant="ghost" size="sm" onClick={() => removeModel(o.canonicalModelId)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <div className="pt-4">
              <Button onClick={handleSaveOffered} disabled={saving}>
                {saving ? "Saving..." : "Save & Publish to Mesh"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Cost Reminder */}
      <Card className="p-6 border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-900/10">
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-600">info</span>
          Cost reminder
        </h3>
        <p className="text-sm text-text-muted">
          Base costs are from your instance only. Local (Ollama, LM Studio) = near-zero. Cloud/OAuth = your provider&apos;s rates. Set margin or fixed markup to cover your costs and earn.
        </p>
      </Card>

      {/* Recent Transactions */}
      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-4">Recent Transactions</h3>
        <div className="text-center py-8 text-gray-500">
          No transactions yet. Connect to the P2P network to start earning.
        </div>
      </Card>
    </div>
  );
}
