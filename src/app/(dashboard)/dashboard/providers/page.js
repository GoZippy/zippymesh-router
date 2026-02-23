"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import PropTypes from "prop-types";
import { Card, CardSkeleton, Badge, Button, Input, Modal, Select } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_PROVIDERS, OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import Link from "next/link";
import { getErrorCode, getRelativeTime } from "@/shared/utils";

// Shared helper function to avoid code duplication between ProviderCard and ApiKeyProviderCard
function getStatusDisplay(connected, error, errorCode) {
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
  if (parts.length === 0) {
    return <span className="text-text-muted">No connections</span>;
  }
  return parts;
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [connectionsRes, nodesRes, presetsRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/provider-nodes"),
          fetch("/api/presets/provider-nodes"),
        ]);
        const connectionsData = await connectionsRes.json();
        const nodesData = await nodesRes.json();
        if (connectionsRes.ok) setConnections(connectionsData.connections || []);
        if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
        if (presetsRes.ok) {
          const presetsData = await presetsRes.json();
          setPresets(presetsData.presets || []);
        }
      } catch (error) {
        console.log("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleScan = async () => {
    setScanning(true);
    setDiscoveredCount(null);
    try {
      const res = await fetch("/api/discovery", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setDiscoveredCount(data.count);
        // Refresh nodes
        const nodesRes = await fetch("/api/provider-nodes");
        const nodesData = await nodesRes.json();
        if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
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

    return { connected, error, total, errorCode, errorTime, avgLatency, avgTps };
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
      color: "#D97757",
      textIcon: "AC",
    }));

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

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasAnyConnection = connections.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {discoveredCount !== null && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/20 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-blue-500">check_circle</span>
            <span className="text-sm font-medium">Scan complete: {discoveredCount} new local providers discovered.</span>
          </div>
          <button onClick={() => setDiscoveredCount(null)} className="text-text-muted hover:text-text">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
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

      {/* OAuth Providers */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">OAuth Providers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(OAUTH_PROVIDERS).map(([key, info]) => (
            <ProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "oauth")}
            />
          ))}
        </div>
      </div>

      {/* Free Providers */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Free Providers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(FREE_PROVIDERS).map(([key, info]) => (
            <ProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "oauth")}
            />
          ))}
        </div>
      </div>


      {/* API Key Providers */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">API Key Providers</h2>
          <div className="flex gap-2">
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
              className="!bg-white !text-black hover:!bg-gray-100"
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
                        // Open appropriate modal with prefilled data using custom event dispatch pattern or state handling
                        if (preset.apiType === "openai-compatible") {
                          // Signal AddOpenAICompatibleModal to prefill data.
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
          {Object.entries(apiKeyProviders).map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
            />
          ))}
        </div>
      </div>
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
    </div>
  );
}

function ProviderCard({ providerId, provider, stats }) {
  const { connected, error, errorCode, errorTime, avgLatency, avgTps } = stats;
  const [imgError, setImgError] = useState(false);

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group">
      <Card padding="xs" className="h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
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
                  src={`/providers/${provider.id}.png`}
                  alt={provider.name}
                  width={30}
                  height={30}
                  className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
                  sizes="32px"
                  onError={() => setImgError(true)}
                />
              )}
            </div>
            <div>
              <h3 className="font-semibold">{provider.name}</h3>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {getStatusDisplay(connected, error, errorCode)}
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
            </div>
          </div>
          <span className="material-symbols-outlined text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            chevron_right
          </span>
        </div>
      </Card>
    </Link>
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
  }).isRequired,
};

// API Key providers - use image with textIcon fallback (same as OAuth providers)
function ApiKeyProviderCard({ providerId, provider, stats }) {
  const { connected, error, errorCode, errorTime, avgLatency, avgTps } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
  const [imgError, setImgError] = useState(false);

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getIconPath = () => {
    if (isCompatible) {
      return provider.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png"; // Use Anthropic icon as base
    }
    return `/providers/${provider.id}.png`;
  };

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group">
      <Card padding="xs" className="h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
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
            <div>
              <h3 className="font-semibold">{provider.name}</h3>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {getStatusDisplay(connected, error, errorCode)}
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
            </div>
          </div>
          <span className="material-symbols-outlined text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            chevron_right
          </span>
        </div>
      </Card>
    </Link>
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
  }).isRequired,
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
        prefix: preset.id.split("-")[0], // e.g. "kilo"
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
      const res = await fetch("/api/provider-nodes", {
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
      const data = await res.json();
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
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: formData.baseUrl, apiKey: checkKey, type: "openai-compatible" }),
      });
      const data = await res.json();
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
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          baseUrl: formData.baseUrl,
          type: "anthropic-compatible",
        }),
      });
      const data = await res.json();
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
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "anthropic-compatible"
        }),
      });
      const data = await res.json();
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
