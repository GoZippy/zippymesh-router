"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/Card";

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

export default function ProviderModelsTable() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("provider");
  const [sortDirection, setSortDirection] = useState("asc");

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/marketplace/models", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load models");
        setModels(data.models || []);
      } catch (err) {
        setError(err.message || "Failed to load models");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const filteredAndSorted = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = models.filter((model) => {
      if (!normalizedQuery) return true;
      const haystack = `${model.provider || ""} ${model.modelId || ""} ${model.name || ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    const next = [...filtered].sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];

      if (typeof left === "number" || typeof right === "number") {
        const leftNumber = toNumber(left);
        const rightNumber = toNumber(right);
        return sortDirection === "asc" ? leftNumber - rightNumber : rightNumber - leftNumber;
      }

      const leftText = String(left ?? "").toLowerCase();
      const rightText = String(right ?? "").toLowerCase();
      if (leftText === rightText) return 0;
      const textCompare = leftText < rightText ? -1 : 1;
      return sortDirection === "asc" ? textCompare : -textCompare;
    });

    return next;
  }, [models, query, sortKey, sortDirection]);

  const setSort = (nextKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  };

  const exportCsv = () => {
    const header = ["provider", "modelId", "name", "inputPrice", "outputPrice", "avgLatency", "isFree", "isPremium"];
    const lines = [
      header.join(","),
      ...filteredAndSorted.map((row) => [
        row.provider || "",
        row.modelId || "",
        row.name || "",
        row.inputPrice || 0,
        row.outputPrice || 0,
        row.avgLatency || 0,
        row.isFree ? "true" : "false",
        row.isPremium ? "true" : "false",
      ].map((value) => `"${String(value).replace(/"/g, "\"\"")}"`).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `provider-model-pricing-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Card padding="lg">Loading provider models and pricing...</Card>;
  if (error) return <Card padding="lg">Failed to load models: {error}</Card>;
  if (!models.length) return <Card padding="lg">No models found in provider registry.</Card>;

  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Models by Provider & Pricing</h3>
          <p className="text-sm text-text-muted">
            Validate model catalog and price metadata before enabling for routing.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="text-xs px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
        >
          Export CSV
        </button>
      </div>
      <div className="px-4 py-3 border-b border-black/10 dark:border-white/10">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter provider or model..."
          className="w-full rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-text-main">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-xs uppercase text-text-muted">
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("provider")}>Provider</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("modelId")}>Model ID</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("name")}>Name</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("inputPrice")}>Input Price</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("outputPrice")}>Output Price</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("avgLatency")}>Latency (ms)</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("isFree")}>Free</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("isPremium")}>Premium</button></th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((row) => (
              <tr key={`${row.provider}:${row.modelId}`} className="border-b border-black/5 dark:border-white/5">
                <td className="px-4 py-3 capitalize">{row.provider}</td>
                <td className="px-4 py-3 font-mono text-xs">{row.modelId}</td>
                <td className="px-4 py-3">{row.name || row.modelId}</td>
                <td className="px-4 py-3">{toNumber(row.inputPrice).toFixed(6)}</td>
                <td className="px-4 py-3">{toNumber(row.outputPrice).toFixed(6)}</td>
                <td className="px-4 py-3">{toNumber(row.avgLatency).toFixed(0)}</td>
                <td className="px-4 py-3">{row.isFree ? "yes" : "no"}</td>
                <td className="px-4 py-3">{row.isPremium ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
