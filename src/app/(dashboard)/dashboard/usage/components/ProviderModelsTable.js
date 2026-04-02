"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/Card";
import { formatRequestError, safeFetchJson } from "@/shared/utils";

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

// Known model capabilities for better detection
const MODEL_CAPABILITIES = {
  "claude-3": ["vision"], "claude-3.5": ["vision"], "claude-4": ["vision"],
  "claude-opus": ["premium", "vision"], "claude-sonnet": ["vision"],
  "gpt-4-vision": ["vision"], "gpt-4o": ["vision"], "gpt-4-turbo": ["vision"], "gpt-5": ["premium", "vision"],
  "gemini-pro-vision": ["vision"], "gemini-1.5": ["vision"], "gemini-2": ["vision"],
  "o1": ["reasoning", "premium"], "o3": ["reasoning", "premium"], "thinking": ["reasoning"], "r1": ["reasoning"],
  "codex": ["code"], "code-": ["code"], "coder": ["code"], "starcoder": ["code"],
  "codellama": ["code"], "deepseek-coder": ["code"], "qwen-coder": ["code"],
};

function categorizeModel(modelId) {
  const id = (modelId || "").toLowerCase();
  const tags = new Set();
  
  for (const [pattern, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (id.includes(pattern.toLowerCase())) caps.forEach(c => tags.add(c));
  }
  
  if (id.includes("free") || id.includes(":free") || id.endsWith("-free")) tags.add("free");
  if (id.includes("code") || id.includes("coder") || id.includes("codex")) tags.add("code");
  if (id.includes("vision") || id.includes("-vl") || id.includes("ocr") || id.match(/\d+v\b/)) tags.add("vision");
  if (id.includes("embed") || id.includes("embedding")) tags.add("embedding");
  if (id.includes("thinking") || id.includes("reason") || id.match(/\bo[13]\b/) || id.includes("deepthink")) tags.add("reasoning");
  if (id.includes("flash") || id.includes("mini") || id.includes("nano") || id.includes("haiku") || id.match(/\b[1-8]b\b/)) tags.add("fast");
  if (id.includes("opus") || id.includes("-pro") || id.includes("ultra") || id.includes("-high") || id.match(/\b(70|72|405)b\b/)) tags.add("premium");
  if (id.includes("chat") || id.includes("instruct") || id.includes("turbo")) tags.add("chat");
  
  return Array.from(tags);
}

const CATEGORY_FILTERS = [
  { key: "all", label: "All", color: "bg-gray-500" },
  { key: "free", label: "Free", color: "bg-green-500" },
  { key: "code", label: "Code", color: "bg-blue-500" },
  { key: "vision", label: "Vision", color: "bg-purple-500" },
  { key: "reasoning", label: "Reasoning", color: "bg-orange-500" },
  { key: "fast", label: "Fast", color: "bg-cyan-500" },
  { key: "chat", label: "Chat", color: "bg-pink-500" },
];

export default function ProviderModelsTable() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("provider");
  const [sortDirection, setSortDirection] = useState("asc");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await safeFetchJson("/api/marketplace/models", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(formatRequestError("Failed to load models", response, "Failed to load models"));
        }
        setModels(response.data?.models || []);
      } catch (err) {
        setError(err.message || "Failed to load models");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  // Get unique providers for filter dropdown
  const uniqueProviders = useMemo(() => {
    const providers = new Set(models.map(m => m.provider).filter(Boolean));
    return ["all", ...Array.from(providers).sort()];
  }, [models]);

  // Count models per category
  const categoryCounts = useMemo(() => {
    const counts = { all: models.length, free: 0, code: 0, vision: 0, reasoning: 0, fast: 0, chat: 0 };
    models.forEach(m => {
      const tags = categorizeModel(m.modelId);
      if (m.isFree) counts.free++;
      tags.forEach(t => { if (counts[t] !== undefined && t !== "free") counts[t]++; });
    });
    return counts;
  }, [models]);

  const filteredAndSorted = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = models.filter((model) => {
      // Text search
      if (normalizedQuery) {
        const haystack = `${model.provider || ""} ${model.modelId || ""} ${model.name || ""}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      // Provider filter (case-insensitive)
      if (providerFilter !== "all" && (model.provider || "").toLowerCase() !== providerFilter.toLowerCase()) return false;
      // Category filter
      if (categoryFilter !== "all") {
        if (categoryFilter === "free") {
          if (!model.isFree) return false;
        } else {
          const tags = categorizeModel(model.modelId);
          if (!tags.includes(categoryFilter)) return false;
        }
      }
      return true;
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
  }, [models, query, sortKey, sortDirection, categoryFilter, providerFilter]);

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
      {/* Filters toolbar */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models..."
            className="w-48 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {uniqueProviders.map(p => (
              <option key={p} value={p}>{p === "all" ? "All Providers" : p}</option>
            ))}
          </select>
        </div>
        {/* Category filter buttons */}
        <div className="flex flex-wrap gap-2">
          {CATEGORY_FILTERS.map(cat => {
            const count = categoryCounts[cat.key] || 0;
            if (cat.key !== "all" && count === 0) return null;
            const isActive = categoryFilter === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setCategoryFilter(cat.key)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  isActive 
                    ? `${cat.color} text-white` 
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>
        {/* Results summary */}
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Showing {filteredAndSorted.length} of {models.length} models
          {categoryFilter !== "all" && ` • Filtered by: ${categoryFilter}`}
          {providerFilter !== "all" && ` • Provider: ${providerFilter}`}
        </div>
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
            {filteredAndSorted.map((row) => {
              const tags = categorizeModel(row.modelId);
              return (
                <tr key={`${row.provider}:${row.modelId}`} className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td className="px-4 py-3 capitalize">{row.provider}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{row.modelId}</span>
                      <div className="flex gap-0.5">
                        {row.isFree && <span className="w-2 h-2 rounded-full bg-green-500" title="Free" />}
                        {tags.includes("code") && <span className="w-2 h-2 rounded-full bg-blue-500" title="Code" />}
                        {tags.includes("vision") && <span className="w-2 h-2 rounded-full bg-purple-500" title="Vision" />}
                        {tags.includes("reasoning") && <span className="w-2 h-2 rounded-full bg-orange-500" title="Reasoning" />}
                        {tags.includes("fast") && <span className="w-2 h-2 rounded-full bg-cyan-500" title="Fast" />}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{row.name || row.modelId}</td>
                  <td className="px-4 py-3">{toNumber(row.inputPrice).toFixed(6)}</td>
                  <td className="px-4 py-3">{toNumber(row.outputPrice).toFixed(6)}</td>
                  <td className="px-4 py-3 text-text-muted">{row.avgLatency != null && row.avgLatency > 0 ? toNumber(row.avgLatency).toFixed(0) : "—"}</td>
                  <td className="px-4 py-3">{row.isFree ? "yes" : "no"}</td>
                  <td className="px-4 py-3">{row.isPremium ? "yes" : "no"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
