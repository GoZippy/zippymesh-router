"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import PropTypes from "prop-types";
import { Card, CardSkeleton, Badge, Button, Input, Modal, Select } from "@/shared/components";
import AddToPlaybookModal from "@/shared/components/AddToPlaybookModal";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_PROVIDERS, OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import { getProviderSignupUrl, getProviderIconUrl } from "@/shared/constants/provider-urls";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatRequestError, getErrorCode, getRelativeTime, safeFetchJson, safeFetchJsonAll } from "@/shared/utils";

const STORAGE_KEY = "providers-page-filters";
const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "type", label: "Provider type" },
  { value: "connections-desc", label: "Most connected" },
  { value: "unadded-first", label: "Not yet added first" },
];
const TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "oauth", label: "OAuth" },
  { value: "free", label: "Free" },
  { value: "apikey", label: "API Key" },
  { value: "local", label: "Local" },
];
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "added", label: "Added only" },
  { value: "unadded", label: "Not yet added" },
  { value: "multiple", label: "Multiple accounts" },
];
const MODEL_FAMILY_OPTIONS = [
  { value: "all", label: "All makers" },
  { value: "gpt", label: "OpenAI (GPT)" },
  { value: "claude", label: "Anthropic (Claude)" },
  { value: "gemini", label: "Google (Gemini)" },
  { value: "llama", label: "Meta (Llama)" },
  { value: "qwen", label: "Qwen" },
  { value: "mistral", label: "Mistral" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "kimi", label: "Kimi" },
  { value: "glm", label: "GLM" },
  { value: "other", label: "Other" },
];

// Format token expiry into a human-readable string
function formatTokenExpiry(expiresAt) {
  if (!expiresAt) return null;
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return null;
  const diffMs = expiresMs - Date.now();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 0) {
    const ago = Math.abs(diffMins);
    if (ago < 60) return `Expired ${ago}m ago`;
    return `Expired ${Math.floor(ago / 60)}h ${ago % 60}m ago`;
  }
  if (diffMins < 60) return `Expires in ${diffMins}m`;
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  return `Expires in ${h}h ${m > 0 ? `${m}m` : ""}`.trim();
}

// Format rate limit time into HH:MM
function formatRateLimit(rateLimitedUntil) {
  if (!rateLimitedUntil) return null;
  const until = new Date(rateLimitedUntil);
  if (!Number.isFinite(until.getTime())) return null;
  if (until.getTime() <= Date.now()) return null;
  return until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Shared helper function to avoid code duplication between ProviderCard and ApiKeyProviderCard
function getStatusDisplay(connected, error, errorCode, secretsMissing = 0) {
  const parts = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" variant="success" size="sm" dot>
        {connected} Connected
      </Badge>
    );
  }
  if (error > 0) {
    const errText = errorCode ? `${error} Error (${errorCode})` : `${error} Error`;
    parts.push(
      <Badge key="error" variant="error" size="sm" dot>
        {errText}
      </Badge>
    );
  }
  if (secretsMissing > 0) {
    parts.push(
      <Badge key="missing-secret" variant="warning" size="sm" dot>
        {secretsMissing} Secret Missing
      </Badge>
    );
  }
  if (parts.length === 0) {
    return <span className="text-text-muted">No connections</span>;
  }
  return parts;
}

function loadSavedFilters() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveFilters(filters) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // ignore
  }
}

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [discoveredCount, setDiscoveredCount] = useState(null);
  const [presets, setPresets] = useState([]);
  const [models, setModels] = useState([]);
  const [spotPrices, setSpotPrices] = useState([]);
  const [spotPricesLoading, setSpotPricesLoading] = useState(false);
  const [syncModelsLoading, setSyncModelsLoading] = useState(false);
  const [addToRulesTarget, setAddToRulesTarget] = useState(null);

  const [sortBy, setSortBy] = useState("name-asc");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterModelFamily, setFilterModelFamily] = useState("all");
  const [modelSearch, setModelSearch] = useState("");

  useEffect(() => {
    const saved = loadSavedFilters();
    if (saved) {
      setSortBy(saved.sortBy ?? "name-asc");
      setFilterType(saved.filterType ?? "all");
      setFilterStatus(saved.filterStatus ?? "all");
      setFilterModelFamily(saved.filterModelFamily ?? "all");
      setModelSearch(saved.modelSearch ?? "");
    }
  }, []);

  useEffect(() => {
    saveFilters({ sortBy, filterType, filterStatus, filterModelFamily, modelSearch });
  }, [sortBy, filterType, filterStatus, filterModelFamily, modelSearch]);

  const fetchData = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes, presetsRes, modelsRes] = await safeFetchJsonAll([
        { key: "connections", url: "/api/providers" },
        { key: "nodes", url: "/api/provider-nodes" },
        { key: "presets", url: "/api/presets/provider-nodes" },
        { key: "models", url: "/api/marketplace/models" },
      ]);
      if (connectionsRes.ok) setConnections(connectionsRes.data?.connections || []);
      if (nodesRes.ok) setProviderNodes(nodesRes.data?.nodes || []);
      if (presetsRes.ok) setPresets(presetsRes.data?.presets || []);
      if (modelsRes.ok) setModels(modelsRes.data?.models || []);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSyncAllProviderModels = useCallback(async () => {
    if (syncModelsLoading) return;
    setSyncModelsLoading(true);
    try {
      const res = await safeFetchJson("/api/provider-sync/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (res.ok) await fetchData();
    } catch (err) {
      console.error("Sync all provider models failed:", err);
    } finally {
      setSyncModelsLoading(false);
    }
  }, [syncModelsLoading, fetchData]);

  const handleScan = async () => {
    setScanning(true);
    setDiscoveredCount(null);
    try {
      const res = await safeFetchJson("/api/discovery", { method: "POST" });
      if (res.ok) {
        setDiscoveredCount(res.data?.count);
        // Refresh nodes
        const nodesRes = await safeFetchJson("/api/provider-nodes");
        if (nodesRes.ok) setProviderNodes(nodesRes.data?.nodes || []);
      }
    } catch (err) {
      console.error("Discovery failed:", err);
    } finally {
      setScanning(false);
    }
  };

  const getProviderStats = (providerId, authType) => {
    const providerConnections = connections.filter(
      c => c.provider === providerId && c.authType === authType
    );

    // Helper: check if connection is effectively active (cooldown expired)
    const getEffectiveStatus = (conn) => {
      const isCooldown = conn.rateLimitedUntil && new Date(conn.rateLimitedUntil).getTime() > Date.now();
      return (conn.testStatus === "unavailable" && !isCooldown) ? "active" : conn.testStatus;
    };

    const activeConns = providerConnections.filter(c => {
      const status = getEffectiveStatus(c);
      return status === "active" || status === "success";
    });

    const connected = activeConns.length;

    const errorConns = providerConnections.filter(c => {
      const status = getEffectiveStatus(c);
      return status === "error" || status === "expired" || status === "unavailable";
    });
    const secretsMissing = providerConnections.filter((c) => c.oauthNeedsSecret).length;

    const error = errorConns.length;
    const total = providerConnections.length;

    // Calculate health metrics (average of active connections)
    const activeWithMetrics = activeConns.filter(c => c.latency || c.tps);
    const avgLatency = activeWithMetrics.length > 0
      ? Math.round(activeWithMetrics.reduce((sum, c) => sum + (c.latency || 0), 0) / activeWithMetrics.length)
      : null;
    const avgTps = activeWithMetrics.length > 0
      ? (activeWithMetrics.reduce((sum, c) => sum + (c.tps || 0), 0) / activeWithMetrics.length).toFixed(1)
      : null;

    // Get latest error info
    const latestError = errorConns.sort((a, b) =>
      new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0)
    )[0];
    const errorCode = latestError ? getErrorCode(latestError.lastError) : null;
    const errorTime = latestError?.lastErrorAt ? getRelativeTime(latestError.lastErrorAt) : null;

    // Get active groups
    const groups = [...new Set(providerConnections.filter(c => c.isEnabled !== false).map(c => c.group || "default"))];

    // Token expiry: find soonest-expiring OAuth connection
    const oauthConns = providerConnections.filter(c => c.authType === "oauth" && c.expiresAt);
    const soonestExpiry = oauthConns.reduce((soonest, c) => {
      const t = new Date(c.expiresAt).getTime();
      return (!soonest || t < soonest) ? t : soonest;
    }, null);
    const expiryLabel = soonestExpiry ? formatTokenExpiry(new Date(soonestExpiry).toISOString()) : null;
    const isExpiringSoon = soonestExpiry && (soonestExpiry - Date.now()) < 2 * 60 * 60 * 1000; // < 2h
    const isExpired = soonestExpiry && soonestExpiry <= Date.now();

    // Needs reauth: any OAuth connection explicitly needs reauth or is expired
    const needsReauthCount = providerConnections.filter(c =>
      c.needsReauth || c.tokenExpired || c.testStatus === "needs_reauth"
    ).length;

    // Rate limiting: find active rate limit
    const rateLimitedConn = providerConnections.find(c =>
      c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > Date.now()
    );
    const rateLimitLabel = rateLimitedConn ? formatRateLimit(rateLimitedConn.rateLimitedUntil) : null;

    return {
      connected, error, total, errorCode, errorTime, avgLatency, avgTps, groups, secretsMissing,
      expiryLabel, isExpiringSoon, isExpired, needsReauthCount, rateLimitLabel,
    };
  };

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
    }));

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Anthropic Compatible",
      color: "#E85C4A",
      textIcon: "AC",
    }));

  // Local providers (Ollama, LMStudio) - dedupe by baseUrl to avoid showing multiple entries
  const localProviders = (() => {
    const seen = new Map();
    for (const node of providerNodes.filter((n) => n.type === "local")) {
      // Only show localhost entries to avoid clutter
      if (!node.baseUrl?.includes("localhost") && !node.baseUrl?.includes("127.0.0.1")) continue;
      const key = node.apiType === "ollama" ? "ollama" : "lmstudio";
      if (!seen.has(key)) {
        seen.set(key, {
          id: key,
          name: node.apiType === "ollama" ? "Ollama" : "LM Studio",
          color: node.apiType === "ollama" ? "#FFFFFF" : "#4B5563",
          textIcon: node.apiType === "ollama" ? "OL" : "LM",
          baseUrl: node.baseUrl,
          isLocal: true,
        });
      }
    }
    return Array.from(seen.values());
  })();

  const apiKeyProviders = {
    ...APIKEY_PROVIDERS,
    ...compatibleProviders.reduce((acc, provider) => {
      acc[provider.id] = provider;
      return acc;
    }, {}),
    ...anthropicCompatibleProviders.reduce((acc, provider) => {
      acc[provider.id] = provider;
      return acc;
    }, {}),
  };

  const providerModelsMap = useMemo(() => {
    const map = new Map();
    for (const m of models) {
      const family = m.modelFamily || "other";
      if (!map.has(m.provider)) map.set(m.provider, new Set());
      map.get(m.provider).add(family);
    }
    return map;
  }, [models]);

  const providerModelsForSearch = useMemo(() => {
    const map = new Map();
    for (const m of models) {
      if (!map.has(m.provider)) map.set(m.provider, []);
      map.get(m.provider).push({ name: m.name || "", modelId: m.modelId || "" });
    }
    return map;
  }, [models]);

  const allProviders = useMemo(() => {
    const list = [];
    for (const [key, info] of Object.entries(OAUTH_PROVIDERS)) {
      const stats = getProviderStats(key, "oauth");
      list.push({
        id: key,
        name: info.name,
        provider: info,
        providerType: "oauth",
        authType: "oauth",
        stats,
        hasConnection: stats.connected > 0,
        connectionCount: stats.total,
        hasMultipleAccounts: stats.total >= 2,
      });
    }
    for (const [key, info] of Object.entries(FREE_PROVIDERS)) {
      const stats = getProviderStats(key, "oauth");
      list.push({
        id: key,
        name: info.name,
        provider: info,
        providerType: "free",
        authType: "oauth",
        stats,
        hasConnection: stats.connected > 0,
        connectionCount: stats.total,
        hasMultipleAccounts: stats.total >= 2,
      });
    }
    for (const [key, info] of Object.entries(apiKeyProviders)) {
      const stats = getProviderStats(key, "apikey");
      list.push({
        id: key,
        name: info.name,
        provider: info,
        providerType: "apikey",
        authType: "apikey",
        stats,
        hasConnection: stats.connected > 0,
        connectionCount: stats.total,
        hasMultipleAccounts: stats.total >= 2,
      });
    }
    // Add local providers (Ollama, LMStudio) with actual connection status
    for (const info of localProviders) {
      // Look up auto-managed connection for this local provider
      const localConnections = connections.filter(
        (c) => c.provider === info.id && c.isActive
      );
      const hasAutoConnection = localConnections.length > 0;
      const connectedCount = localConnections.filter(
        (c) => c.testStatus === "ok" || !c.testStatus
      ).length;
      const errorCount = localConnections.filter(
        (c) => c.testStatus === "error"
      ).length;

      list.push({
        id: info.id,
        name: info.name,
        provider: info,
        providerType: "local",
        authType: "local",
        stats: {
          connected: hasAutoConnection ? Math.max(connectedCount, 1) : 0,
          error: errorCount,
          total: Math.max(localConnections.length, 1),
        },
        hasConnection: hasAutoConnection || true, // Local providers always "exist"
        connectionCount: localConnections.length || 1,
        hasMultipleAccounts: false,
        isLocal: true,
        autoManaged: true,
      });
    }
    return list;
  }, [connections, providerNodes, localProviders]);

  const filteredAndSortedProviders = useMemo(() => {
    let result = [...allProviders];

    if (filterType !== "all") {
      result = result.filter((p) => p.providerType === filterType);
    }
    if (filterStatus === "added") {
      result = result.filter((p) => p.hasConnection);
    } else if (filterStatus === "unadded") {
      result = result.filter((p) => !p.hasConnection);
    } else if (filterStatus === "multiple") {
      result = result.filter((p) => p.hasMultipleAccounts);
    }
    if (filterModelFamily !== "all") {
      result = result.filter((p) => {
        const families = providerModelsMap.get(p.id);
        if (!families) return true;
        return families.has(filterModelFamily);
      });
    }
    if (modelSearch.trim()) {
      const q = modelSearch.trim().toLowerCase();
      result = result.filter((p) => {
        const items = providerModelsForSearch.get(p.id);
        if (!items) return false;
        return items.some(
          (x) =>
            (x.name && x.name.toLowerCase().includes(q)) ||
            (x.modelId && x.modelId.toLowerCase().includes(q))
        );
      });
    }

    const typeOrder = { oauth: 0, free: 1, apikey: 2 };
    if (sortBy === "name-asc") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "name-desc") {
      result.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortBy === "type") {
      result.sort((a, b) => {
        const diff = typeOrder[a.providerType] - typeOrder[b.providerType];
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    } else if (sortBy === "connections-desc") {
      result.sort((a, b) => {
        const diff = (b.connectionCount || 0) - (a.connectionCount || 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    } else if (sortBy === "unadded-first") {
      result.sort((a, b) => {
        const diff = (a.hasConnection ? 1 : 0) - (b.hasConnection ? 1 : 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    }
    return result;
  }, [
    allProviders,
    filterType,
    filterStatus,
    filterModelFamily,
    modelSearch,
    sortBy,
    providerModelsMap,
    providerModelsForSearch,
  ]);

  useEffect(() => {
    if (loading) return;
    setSpotPricesLoading(true);
    safeFetchJson("/api/marketplace/spot-prices?limit=20")
      .then((res) => {
        if (res.ok) {
          setSpotPrices(res.data?.models || []);
        } else {
          console.error("Error fetching spot prices:", formatRequestError("Failed to load spot prices", res, "Request failed"));
          setSpotPrices([]);
        }
      })
      .catch((err) => {
        console.error("Error fetching spot prices:", err);
        setSpotPrices([]);
      })
      .finally(() => setSpotPricesLoading(false));
  }, [loading]);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasAnyConnection = connections.length > 0;

  // Global health summary for banner
  const healthSummary = (() => {
    if (!hasAnyConnection) return null;
    const total = connections.length;
    const active = connections.filter(c => {
      const isCooldown = c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > Date.now();
      const status = (c.testStatus === "unavailable" && !isCooldown) ? "active" : c.testStatus;
      return status === "active" || status === "success";
    }).length;
    const needAttention = connections.filter(c =>
      c.needsReauth || c.tokenExpired || c.testStatus === "needs_reauth" || c.testStatus === "error"
    ).length;
    return { total, active, needAttention };
  })();

  return (
    <div className="flex flex-col gap-6">
      {discoveredCount !== null && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/20 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-blue-500">check_circle</span>
            <span className="text-sm font-medium">
              {discoveredCount > 0
                ? `Scan complete: ${discoveredCount} local provider(s) discovered and added.`
                : "Scan complete: No new local providers found on the network."}
            </span>
          </div>
          <button onClick={() => setDiscoveredCount(null)} className="text-text-muted hover:text-text">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}
      {/* Global provider health banner - shown when there are connections */}
      {healthSummary && (
        <div className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${
          healthSummary.needAttention > 0
            ? "border-yellow-200 dark:border-yellow-900/50 bg-yellow-50/60 dark:bg-yellow-950/20"
            : "border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-950/20"
        }`}>
          <div className="flex items-center gap-2.5">
            <span className={`material-symbols-outlined text-lg ${
              healthSummary.needAttention > 0 ? "text-yellow-600" : "text-green-600"
            }`}>
              {healthSummary.needAttention > 0 ? "warning" : "check_circle"}
            </span>
            <span className="text-sm font-medium">
              {healthSummary.active} of {healthSummary.total} connection{healthSummary.total !== 1 ? "s" : ""} active
            </span>
            {healthSummary.needAttention > 0 && (
              <span className="text-sm text-yellow-700 dark:text-yellow-400">
                &mdash; {healthSummary.needAttention} connection{healthSummary.needAttention !== 1 ? "s" : ""} need attention
              </span>
            )}
          </div>
          {healthSummary.needAttention > 0 && (
            <button
              onClick={() => setFilterStatus("added")}
              className="text-xs text-yellow-700 dark:text-yellow-400 underline underline-offset-2 hover:no-underline shrink-0"
            >
              Show connected
            </button>
          )}
        </div>
      )}

      {/* Getting started callout - shown only when no connections exist */}
      {!hasAnyConnection && (
        <div className="rounded-xl border border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-950/20 p-4 flex gap-3">
          <span className="material-symbols-outlined text-green-600 shrink-0 mt-0.5">rocket_launch</span>
          <div className="text-sm">
            <p className="font-semibold text-green-700 dark:text-green-300 mb-1">Getting Started — Add your first provider</p>
            <p className="text-text-muted mb-3">
              ZippyMesh routes your LLM requests across multiple providers with automatic failover.
              To get started, connect at least one provider. Here are the quickest free options:
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { name: "Groq", url: "https://console.groq.com", desc: "Free — fastest inference, Llama & Mistral models" },
                { name: "GitHub Models", url: "https://github.com/marketplace/models", desc: "Free — GPT-4o & Llama via your GitHub PAT" },
                { name: "Cerebras", url: "https://cloud.cerebras.ai", desc: "Free — ultra-fast Llama inference" },
              ].map((opt) => (
                <a
                  key={opt.name}
                  href={opt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-200 dark:border-green-800 bg-white dark:bg-green-950/30 text-xs font-medium text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                  title={opt.desc}
                >
                  <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                  Get {opt.name} key
                </a>
              ))}
            </div>
            <p className="text-text-muted mt-3 text-xs">
              Once you have a key, find the provider below in <strong>API Key Providers</strong>, click it, and paste your key.
            </p>
          </div>
        </div>
      )}

      {/* Filter/Sort Toolbar */}
      <Card padding="sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[140px]">
              <Select
                label="Sort"
                options={SORT_OPTIONS}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                placeholder=""
              />
            </div>
            <div className="min-w-[120px]">
              <Select
                label="Type"
                options={TYPE_OPTIONS}
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                placeholder=""
              />
            </div>
            <div className="min-w-[140px]">
              <Select
                label="Status"
                options={STATUS_OPTIONS}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                placeholder=""
              />
            </div>
            <div className="min-w-[140px]">
              <Select
                label="Model maker"
                options={MODEL_FAMILY_OPTIONS}
                value={filterModelFamily}
                onChange={(e) => setFilterModelFamily(e.target.value)}
                placeholder=""
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <Input
                label="Model search"
                placeholder="Filter by model name..."
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </div>
            {(filterType !== "all" || filterStatus !== "all" || filterModelFamily !== "all" || modelSearch.trim()) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterType("all");
                  setFilterStatus("all");
                  setFilterModelFamily("all");
                  setModelSearch("");
                }}
              >
                Reset filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Providers Grid */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            Providers ({filteredAndSortedProviders.length})
          </h2>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={syncModelsLoading ? "sync" : "sync"}
              onClick={handleSyncAllProviderModels}
              disabled={syncModelsLoading}
              className={syncModelsLoading ? "animate-spin-slow" : ""}
            >
              {syncModelsLoading ? "Syncing…" : "Sync all provider model lists"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={scanning ? "sync" : "travel_explore"}
              onClick={handleScan}
              disabled={scanning}
              className={scanning ? "animate-spin-slow" : ""}
            >
              {scanning ? "Scanning..." : "Scan Local Network"}
            </Button>
            <Button size="sm" icon="add" onClick={() => setShowAddAnthropicCompatibleModal(true)}>
              Add Anthropic Compatible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              className="bg-white! text-black! hover:bg-gray-100!"
            >
              Add OpenAI Compatible
            </Button>
            <Link href="/dashboard/providers/new">
              <Button size="sm" variant="primary" icon="add">
                Add Provider
              </Button>
            </Link>
            {presets.length > 0 && (
              <div className="relative group">
                <Button size="sm" variant="secondary" icon="keyboard_arrow_down" iconPosition="right">
                  Add Preset
                </Button>
                <div className="absolute right-0 top-full mt-1 w-64 bg-background border border-border rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1">
                  {presets.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        if (preset.apiType === "openai-compatible") {
                          const event = new CustomEvent('prefill-openai-compatible-modal', { detail: preset });
                          window.dispatchEvent(event);
                          setShowAddCompatibleModal(true);
                        }
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-sidebar text-sm flex flex-col gap-0.5"
                    >
                      <span className="font-medium">{preset.name}</span>
                      <span className="text-xs text-text-muted">{preset.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredAndSortedProviders.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-12 px-4 rounded-xl border border-border bg-sidebar/30">
              <span className="material-symbols-outlined text-4xl text-text-muted mb-2">filter_list_off</span>
              <p className="text-text-muted text-center">No providers match your filters.</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setFilterType("all");
                  setFilterStatus("all");
                  setFilterModelFamily("all");
                  setModelSearch("");
                }}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            filteredAndSortedProviders.map((item) =>
              item.authType === "oauth" ? (
                <ProviderCard
                  key={item.id}
                  providerId={item.id}
                  provider={item.provider}
                  stats={item.stats}
                  onAddToRules={() => setAddToRulesTarget({ id: item.id, name: item.name || item.id })}
                />
              ) : (
                <ApiKeyProviderCard
                  key={item.id}
                  providerId={item.id}
                  provider={item.provider}
                  stats={item.stats}
                  onAddToRules={() => setAddToRulesTarget({ id: item.id, name: item.name || item.id })}
                />
              )
            )
          )}
        </div>
      </div>

      {/* Price Comparison Section */}
      <Card padding="sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Price comparison</h2>
              <p className="text-sm text-text-muted">
                Cheapest provider per model (tokens per $1). Compare spot prices across providers.
              </p>
            </div>
            <Link href="/dashboard/marketplace?view=spot">
              <Button variant="secondary" size="sm">
                View full matrix
              </Button>
            </Link>
          </div>
          {spotPricesLoading ? (
            <div className="flex items-center justify-center py-8 text-text-muted">
              <span className="material-symbols-outlined animate-spin-slow">sync</span>
              <span className="ml-2">Loading prices...</span>
            </div>
          ) : spotPrices.length === 0 ? (
            <p className="text-sm text-text-muted py-4">
              No pricing data available. Connect providers and sync models to see price comparisons.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-text-muted">
                    <th className="py-2 pr-4 font-medium">Model</th>
                    <th className="py-2 pr-4 font-medium">Cheapest</th>
                    <th className="py-2 pr-4 font-medium">$/1M in</th>
                    <th className="py-2 pr-4 font-medium">$/1M out</th>
                    <th className="py-2 font-medium">Tokens/$1 (input)</th>
                  </tr>
                </thead>
                <tbody>
                  {spotPrices.slice(0, 15).map((row) => {
                    const cheapest = row.cheapestOffer;
                    if (!cheapest) return null;
                    const inputPerMUsd = cheapest.inputPerMUsd;
                    const outputPerMUsd = cheapest.outputPerMUsd;
                    const isValidInput = inputPerMUsd > 0 && inputPerMUsd <= 1000;
                    const isValidOutput = outputPerMUsd >= 0 && outputPerMUsd <= 1000;
                    const tokensPerDollar = isValidInput
                      ? Math.round(1000000 / inputPerMUsd).toLocaleString()
                      : "—";
                    const formatPrice = (val, isValid) =>
                      isValid ? `$${Number(val).toFixed(2)}` : "—";
                    return (
                      <tr key={row.canonicalModelId} className="border-b border-border/50">
                        <td className="py-2 pr-4">
                          <span className="font-medium">{row.modelDisplayName || row.canonicalModelId}</span>
                        </td>
                        <td className="py-2 pr-4">{cheapest.provider}</td>
                        <td className="py-2 pr-4">{formatPrice(inputPerMUsd, isValidInput)}</td>
                        <td className="py-2 pr-4">{formatPrice(outputPerMUsd, isValidOutput)}</td>
                        <td className="py-2">{tokensPerDollar}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
      <AddOpenAICompatibleModal
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
        }}
      />
      <AddAnthropicCompatibleModal
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
        }}
      />
      <AddToPlaybookModal
        isOpen={!!addToRulesTarget}
        onClose={() => setAddToRulesTarget(null)}
        modelId={addToRulesTarget?.id}
        modelName={addToRulesTarget?.name}
      />
    </div>
  );
}

function ProviderCard({ providerId, provider, stats, onAddToRules }) {
  const router = useRouter();
  const {
    connected, error, errorCode, errorTime, avgLatency, avgTps, secretsMissing,
    expiryLabel, isExpiringSoon, isExpired, needsReauthCount, rateLimitLabel,
  } = stats;
  const [imgError, setImgError] = useState(false);
  const signupUrl = getProviderSignupUrl(providerId);

  // Color dot: green=active, yellow=expiring soon, red=expired/needs_reauth, gray=no connections
  const statusDotColor = (() => {
    if (needsReauthCount > 0 || isExpired) return "bg-red-500";
    if (isExpiringSoon) return "bg-yellow-400";
    if (connected > 0) return "bg-green-500";
    return "bg-gray-300 dark:bg-gray-600";
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/dashboard/providers/${providerId}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/dashboard/providers/${providerId}`)}
      className="group cursor-pointer"
    >
      <Card padding="xs" className="h-full hover:bg-black/1 dark:hover:bg-white/1 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div
                className="size-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${provider.color}15` }}
              >
                {imgError ? (
                  <span
                    className="text-xs font-bold"
                    style={{ color: provider.color }}
                  >
                    {provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                  </span>
                ) : (
                  <Image
                    src={getProviderIconUrl(provider.id)}
                    alt={provider.name}
                    width={30}
                    height={30}
                    className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
                    sizes="32px"
                    onError={() => setImgError(true)}
                  />
                )}
              </div>
              {/* Status dot indicator */}
              <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background ${statusDotColor}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold truncate">{provider.name}</h3>
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  {getStatusDisplay(connected, error, errorCode, secretsMissing)}
                  {avgLatency && (
                    <span className="text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">timer</span>
                      {avgLatency}ms
                    </span>
                  )}
                  {avgTps && (
                    <span className="text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">speed</span>
                      {avgTps} t/s
                    </span>
                  )}
                  {errorTime && <span className="text-text-muted">• {errorTime}</span>}
                </div>
                {/* Token expiry row */}
                {expiryLabel && (
                  <span className={`text-xs flex items-center gap-1 ${isExpired || needsReauthCount > 0 ? "text-red-500" : isExpiringSoon ? "text-yellow-600 dark:text-yellow-400" : "text-text-muted"}`}>
                    <span className="material-symbols-outlined text-[13px]">schedule</span>
                    {expiryLabel}
                  </span>
                )}
                {/* Rate limit row */}
                {rateLimitLabel && (
                  <span className="text-xs text-orange-500 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">block</span>
                    Rate limited until {rateLimitLabel}
                  </span>
                )}
                {/* Reconnect prompt */}
                {needsReauthCount > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/dashboard/providers/${providerId}`);
                    }}
                    className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors w-fit"
                  >
                    <span className="material-symbols-outlined text-[13px]">refresh</span>
                    Reconnect
                  </button>
                )}
                {stats.groups && stats.groups.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {stats.groups.map(g => (
                      <span key={g} className={`text-[9px] px-1.5 py-0 rounded border ${g === "work" ? "bg-purple-500/10 text-purple-600 border-purple-500/20" :
                        g === "team" ? "bg-blue-500/10 text-blue-600 border-blue-500/20" :
                          g === "personal" ? "bg-green-500/10 text-green-600 border-green-500/20" :
                            "bg-gray-500/10 text-gray-600 border-gray-500/20"
                        }`}>
                        {g === "default" ? "Def" : g.charAt(0).toUpperCase() + g.slice(1, 4)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onAddToRules && (
              <button
                onClick={(e) => { e.stopPropagation(); onAddToRules(); }}
                className="p-1 hover:bg-primary/10 rounded text-primary"
                title="Add to Routing Rules"
              >
                <span className="material-symbols-outlined text-[18px]">alt_route</span>
              </button>
            )}
            {signupUrl && (
              <a
                href={signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary transition-colors"
                title={`Sign up for ${provider.name}`}
              >
                <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              </a>
            )}
            <span className="material-symbols-outlined text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
              chevron_right
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

ProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
    expiryLabel: PropTypes.string,
    isExpiringSoon: PropTypes.bool,
    isExpired: PropTypes.bool,
    needsReauthCount: PropTypes.number,
    rateLimitLabel: PropTypes.string,
  }).isRequired,
  onAddToRules: PropTypes.func,
};

// API Key providers - use image with textIcon fallback (same as OAuth providers)
function ApiKeyProviderCard({ providerId, provider, stats, onAddToRules }) {
  const router = useRouter();
  const { connected, error, errorCode, errorTime, avgLatency, avgTps, secretsMissing, rateLimitLabel } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
  const [imgError, setImgError] = useState(false);
  const signupUrl = getProviderSignupUrl(providerId);

  // Status dot: api-key type — gray if no connections, green if active, red if error
  const statusDotColor = (() => {
    if (error > 0 && connected === 0) return "bg-red-500";
    if (connected > 0) return "bg-green-500";
    return "bg-gray-300 dark:bg-gray-600";
  })();

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getIconPath = () => {
    if (isCompatible) {
      return getProviderIconUrl(provider.apiType === "responses" ? "oai-r" : "oai-cc");
    }
    if (isAnthropicCompatible) {
      return getProviderIconUrl("anthropic-m");
    }
    return getProviderIconUrl(provider.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/dashboard/providers/${providerId}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/dashboard/providers/${providerId}`)}
      className="group cursor-pointer"
    >
      <Card padding="xs" className="h-full hover:bg-black/1 dark:hover:bg-white/1 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div
                className="size-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${provider.color}15` }}
              >
                {imgError ? (
                  <span
                    className="text-xs font-bold"
                    style={{ color: provider.color }}
                  >
                    {provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                  </span>
                ) : (
                  <Image
                    src={getIconPath()}
                    alt={provider.name}
                    width={30}
                    height={30}
                    className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                    sizes="30px"
                    onError={() => setImgError(true)}
                  />
                )}
              </div>
              {/* Status dot indicator */}
              <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background ${statusDotColor}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold truncate">{provider.name}</h3>
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  {getStatusDisplay(connected, error, errorCode, secretsMissing)}
                  {avgLatency && (
                    <span className="text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">timer</span>
                      {avgLatency}ms
                    </span>
                  )}
                  {avgTps && (
                    <span className="text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">speed</span>
                      {avgTps} t/s
                    </span>
                  )}
                  {isCompatible && (
                    <Badge variant="default" size="sm">
                      {provider.apiType === "responses" ? "Responses" : "Chat"}
                    </Badge>
                  )}
                  {isAnthropicCompatible && (
                    <Badge variant="default" size="sm">
                      Messages
                    </Badge>
                  )}
                  {errorTime && <span className="text-text-muted">• {errorTime}</span>}
                </div>
                {/* Rate limit row */}
                {rateLimitLabel && (
                  <span className="text-xs text-orange-500 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">block</span>
                    Rate limited until {rateLimitLabel}
                  </span>
                )}
                {stats.groups && stats.groups.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {stats.groups.map(g => (
                      <span key={g} className={`text-[9px] px-1.5 py-0 rounded border ${g === "work" ? "bg-purple-500/10 text-purple-600 border-purple-500/20" :
                        g === "team" ? "bg-blue-500/10 text-blue-600 border-blue-500/20" :
                          g === "personal" ? "bg-green-500/10 text-green-600 border-green-500/20" :
                            "bg-gray-500/10 text-gray-600 border-gray-500/20"
                        }`}>
                        {g === "default" ? "Def" : g.charAt(0).toUpperCase() + g.slice(1, 4)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onAddToRules && (
              <button
                onClick={(e) => { e.stopPropagation(); onAddToRules(); }}
                className="p-1 hover:bg-primary/10 rounded text-primary"
                title="Add to Routing Rules"
              >
                <span className="material-symbols-outlined text-[18px]">alt_route</span>
              </button>
            )}
            {signupUrl && (
              <a
                href={signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary transition-colors"
                title={`Sign up for ${provider.name}`}
              >
                <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              </a>
            )}
            <span className="material-symbols-outlined text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
              chevron_right
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

ApiKeyProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
    rateLimitLabel: PropTypes.string,
  }).isRequired,
  onAddToRules: PropTypes.func,
};

function AddOpenAICompatibleModal({ isOpen, onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  useEffect(() => {
    // Listen for preset triggers
    const handlePrefill = (e) => {
      const preset = e.detail;
      setFormData(prev => ({
        ...prev,
        name: preset.name.split(" ")[0], // e.g. "Kilo"
        prefix: preset.id.split("-")[0], // e.g. "kiro"
        baseUrl: preset.baseUrl,
      }));
    };
    window.addEventListener('prefill-openai-compatible-modal', handlePrefill);
    return () => window.removeEventListener('prefill-openai-compatible-modal', handlePrefill);
  }, []);

  useEffect(() => {
    // Only reset baseUrl if we didn't just load a preset
    if (formData.name === "") {
      const defaultBaseUrl = "https://api.openai.com/v1";
      setFormData((prev) => ({
        ...prev,
        baseUrl: defaultBaseUrl,
      }));
    }
  }, [formData.apiType]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await safeFetchJson("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          apiType: formData.apiType,
          baseUrl: formData.baseUrl,
          type: "openai-compatible",
        }),
      });
      const data = res.data || {};
      if (res.ok) {
        onCreated(data.node);
        setFormData({
          name: "",
          prefix: "",
          apiType: "chat",
          baseUrl: "https://api.openai.com/v1",
        });
        setCheckKey("");
        setValidationResult(null);
      }
    } catch (error) {
      console.log("Error creating OpenAI Compatible node:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await safeFetchJson("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: formData.baseUrl, apiKey: checkKey, type: "openai-compatible" }),
      });
      const data = res.data || {};
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Add OpenAI Compatible" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="OpenAI Compatible (Prod)"
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder="oc-prod"
          hint="Required. Used as the provider prefix for model IDs."
        />
        <Select
          label="API Type"
          options={apiTypeOptions}
          value={formData.apiType}
          onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
          hint="Use the base URL (ending in /v1) for your OpenAI-compatible API."
        />
        <div className="flex gap-2">
          <Input
            label="API Key (for Check)"
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}>
            {submitting ? "Creating..." : "Create"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddOpenAICompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

function AddAnthropicCompatibleModal({ isOpen, onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: "https://api.anthropic.com/v1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    // Reset validation when modal opens
    if (isOpen) {
      setValidationResult(null);
      setCheckKey("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await safeFetchJson("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          baseUrl: formData.baseUrl,
          type: "anthropic-compatible",
        }),
      });
      const data = res.data || {};
      if (res.ok) {
        onCreated(data.node);
        setFormData({
          name: "",
          prefix: "",
          baseUrl: "https://api.anthropic.com/v1",
        });
        setCheckKey("");
        setValidationResult(null);
      }
    } catch (error) {
      console.log("Error creating Anthropic Compatible node:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await safeFetchJson("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "anthropic-compatible"
        }),
      });
      const data = res.data || {};
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Add Anthropic Compatible" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Anthropic Compatible (Prod)"
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder="ac-prod"
          hint="Required. Used as the provider prefix for model IDs."
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder="https://api.anthropic.com/v1"
          hint="Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages."
        />
        <div className="flex gap-2">
          <Input
            label="API Key (for Check)"
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}>
            {submitting ? "Creating..." : "Create"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddAnthropicCompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};
