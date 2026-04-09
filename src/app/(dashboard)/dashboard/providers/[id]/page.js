"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card, Button, Badge, Input, Modal, CardSkeleton, OAuthModal, KiroOAuthWrapper, CursorAuthModal, Toggle, Select } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getProviderUrls, getProviderIconUrl } from "@/shared/constants/provider-urls";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { formatRequestError, safeFetchJson, safeFetchJsonAll } from "@/shared/utils";

// Add to Playbook Modal
function AddToPlaybookModal({ modelId, providerId, onClose }) {
  const [playbooks, setPlaybooks] = useState([]);
  const [selectedPlaybook, setSelectedPlaybook] = useState("");
  const [newPlaybookName, setNewPlaybookName] = useState("");
  const [intent, setIntent] = useState("code");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  
  useEffect(() => {
    const load = async () => {
      try {
        const response = await safeFetchJson("/api/routing/playbooks");
        if (!response.ok) {
          throw new Error(formatRequestError("Failed to load playbooks", response, "Failed to load playbooks"));
        }
        const data = response.data;
        setPlaybooks(data.playbooks || []);
      } catch (e) {
        console.error("Failed to load playbooks:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);
  
  const handleAddToExisting = async () => {
    if (!selectedPlaybook) return;
    setSaving(true);
    try {
      const playbook = playbooks.find(p => p.id === selectedPlaybook);
      if (!playbook) return;
      
      const updatedRoutes = [...(playbook.routes || [])];
      const existingRoute = updatedRoutes.find(r => r.intent === intent);
      
      if (existingRoute) {
        if (!existingRoute.models.includes(modelId)) {
          existingRoute.models.push(modelId);
        }
      } else {
        updatedRoutes.push({ intent, models: [modelId], priority: updatedRoutes.length + 1 });
      }
      
      const response = await safeFetchJson(`/api/routing/playbooks/${selectedPlaybook}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: updatedRoutes }),
      });
      if (!response.ok) {
        throw new Error(formatRequestError("Failed to update playbook", response, "Failed to update playbook"));
      }
      onClose();
    } catch (e) {
      console.error("Failed to add to playbook:", e);
    } finally {
      setSaving(false);
    }
  };
  
  const handleCreateNew = async () => {
    if (!newPlaybookName.trim()) return;
    setSaving(true);
    try {
      const response = await safeFetchJson("/api/routing/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPlaybookName,
          routes: [{ intent, models: [modelId], priority: 1 }],
        }),
      });
      if (response.ok) {
        onClose();
        router.push("/dashboard/routing");
      } else {
        throw new Error(formatRequestError("Failed to create playbook", response, "Failed to create playbook"));
      }
    } catch (e) {
      console.error("Failed to create playbook:", e);
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <Modal isOpen onClose={onClose} title="Add to Playbook">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium block mb-1">Model</label>
          <code className="text-xs bg-bg-secondary px-2 py-1 rounded">{modelId}</code>
        </div>
        
        <div>
          <label className="text-sm font-medium block mb-1 text-gray-700 dark:text-gray-300">Intent / Use Case</label>
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="code">Code Generation</option>
            <option value="chat">Chat / Conversation</option>
            <option value="reasoning">Complex Reasoning</option>
            <option value="vision">Vision / Image Analysis</option>
            <option value="fast">Fast / Low Latency</option>
            <option value="embedding">Embeddings</option>
            <option value="default">Default / Fallback</option>
          </select>
        </div>
        
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading playbooks...</p>
        ) : playbooks.length > 0 ? (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <label className="text-sm font-medium block mb-2 text-gray-700 dark:text-gray-300">Add to existing playbook</label>
            <div className="flex gap-2">
              <select
                value={selectedPlaybook}
                onChange={(e) => setSelectedPlaybook(e.target.value)}
                className="flex-1 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="">Select playbook...</option>
                {playbooks.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <Button onClick={handleAddToExisting} disabled={!selectedPlaybook || saving}>
                {saving ? "Adding..." : "Add"}
              </Button>
            </div>
          </div>
        ) : null}
        
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <label className="text-sm font-medium block mb-2 text-gray-700 dark:text-gray-300">Or create new playbook</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newPlaybookName}
              onChange={(e) => setNewPlaybookName(e.target.value)}
              placeholder="Playbook name..."
              className="flex-1 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
            />
            <Button onClick={handleCreateNew} disabled={!newPlaybookName.trim() || saving}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Report Pricing Modal for Token Buddy
function ReportPricingModal({ modelId, providerId, fullModel, onClose }) {
  const [isFree, setIsFree] = useState(false);
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [freeLimit, setFreeLimit] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pointsEarned, setPointsEarned] = useState(0);

  const handleSubmit = async () => {
    if (submitting) return;

    const inputPerM = isFree ? 0 : Number(inputPrice) || 0;
    const outputPerM = isFree ? 0 : Number(outputPrice) || 0;

    if (!isFree && inputPerM <= 0 && outputPerM <= 0) {
      alert("Please enter pricing or mark as free");
      return;
    }

    setSubmitting(true);
    try {
      const response = await safeFetchJson("/api/marketplace/community-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          modelId,
          inputPerMUsd: inputPerM,
          outputPerMUsd: outputPerM,
          isFree,
          freeLimit: freeLimit || null,
          notes: notes || null,
          sourceUrl: sourceUrl || null,
        }),
      });

      if (response.ok) {
        const data = response.data || {};
        setSubmitted(true);
        if (data.contribution?.pointsEarned) {
          setPointsEarned(data.contribution.pointsEarned);
        }
        setTimeout(() => onClose(), 2000);
      } else {
        alert(formatRequestError("Failed to submit pricing", response, "Failed to submit pricing"));
      }
    } catch (error) {
      console.error("Error submitting pricing:", error);
      alert("Failed to submit pricing");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Modal isOpen onClose={onClose} title="Thank You!">
        <div className="flex flex-col gap-4 text-center">
          <p className="text-sm">Your pricing report has been submitted!</p>
          {pointsEarned > 0 && (
            <p className="text-sm font-semibold text-primary">
              🎉 You earned {pointsEarned} Token Buddy points!
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Report Pricing">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium block mb-1">Model</label>
          <code className="text-xs bg-bg-secondary px-2 py-1 rounded">{fullModel}</code>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Free Model?</label>
          <Toggle value={isFree} onChange={setIsFree} />
        </div>

        {!isFree && (
          <>
            <div>
              <label className="text-sm font-medium block mb-1">Input Price (USD per 1M tokens)</label>
              <input
                type="number"
                value={inputPrice}
                onChange={(e) => setInputPrice(e.target.value)}
                placeholder="0.01"
                step="0.0001"
                min="0"
                className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Output Price (USD per 1M tokens)</label>
              <input
                type="number"
                value={outputPrice}
                onChange={(e) => setOutputPrice(e.target.value)}
                placeholder="0.03"
                step="0.0001"
                min="0"
                className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
          </>
        )}

        {isFree && (
          <div>
            <label className="text-sm font-medium block mb-1">Free Limit (optional, e.g., "100 req/day")</label>
            <input
              type="text"
              value={freeLimit}
              onChange={(e) => setFreeLimit(e.target.value)}
              placeholder="e.g., 100 requests per day"
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
        )}

        <div>
          <label className="text-sm font-medium block mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional info (e.g., context length, tested date)"
            rows="3"
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Source URL (optional)</label>
          <input
            type="text"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.id;
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState(null);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [reauthConnectionId, setReauthConnectionId] = useState(null);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [headerImgError, setHeaderImgError] = useState(false);
  const [testingConnections, setTestingConnections] = useState({}); // connectionId -> boolean
  const [testResults, setTestResults] = useState({}); // connectionId -> "success" | "failed" | null
  const [dynamicModels, setDynamicModels] = useState([]); // Models fetched from /v1/models
  const [dynamicModelsLoading, setDynamicModelsLoading] = useState(false);
  const [dynamicModelsUpdatedAt, setDynamicModelsUpdatedAt] = useState(null);
  const [refreshModelsTrigger, setRefreshModelsTrigger] = useState(0);
  const [refreshModelsSyncing, setRefreshModelsSyncing] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelSort, setModelSort] = useState("name-asc");
  const [modelFilter, setModelFilter] = useState("all"); // all, free, premium, code, chat, vision
  const [favorites, setFavorites] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("zmlr_favorite_models") || "[]");
    } catch { return []; }
  });
  const [showPlaybookModal, setShowPlaybookModal] = useState(false);
  const [selectedModelForPlaybook, setSelectedModelForPlaybook] = useState(null);
  const [showReportPricingModal, setShowReportPricingModal] = useState(false);
  const [selectedModelForReport, setSelectedModelForReport] = useState(null);
  const [selectedFullModelForReport, setSelectedFullModelForReport] = useState(null);
  const { copied, copy } = useCopyToClipboard();
  
  // Save favorites to localStorage
  const toggleFavorite = (modelId) => {
    setFavorites(prev => {
      const fullId = `${providerId}/${modelId}`;
      const next = prev.includes(fullId) ? prev.filter(f => f !== fullId) : [...prev, fullId];
      localStorage.setItem("zmlr_favorite_models", JSON.stringify(next));
      return next;
    });
  };
  
  const isFavorite = (modelId) => {
    return favorites.includes(`${providerId}/${modelId}`);
  };
  
  // Local provider definitions
  const LOCAL_PROVIDERS = {
    ollama: { id: "ollama", name: "Ollama", color: "#FFFFFF", textIcon: "OL", isLocal: true },
    lmstudio: { id: "lmstudio", name: "LM Studio", color: "#4B5563", textIcon: "LM", isLocal: true },
  };
  const isLocalProvider = providerId === "ollama" || providerId === "lmstudio";
  
  const providerInfo = isLocalProvider
    ? LOCAL_PROVIDERS[providerId]
    : providerNode
    ? {
      id: providerNode.id,
      name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
      color: providerNode.type === "anthropic-compatible" ? "#E85C4A" : "#10A37F",
      textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
      apiType: providerNode.apiType,
      baseUrl: providerNode.baseUrl,
      type: providerNode.type,
    }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId]);
  const isOAuth = !!OAUTH_PROVIDERS[providerId];
  const staticModels = getModelsByProviderId(providerId);
  // Use dynamic models if available, fall back to static
  const models = dynamicModels.length > 0 ? dynamicModels : staticModels;
  const providerAlias = getProviderAlias(providerId);

  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;

  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  const providerDisplayAlias = isCompatible
    ? (providerNode?.prefix || providerId)
    : providerAlias;

  // Define callbacks BEFORE the useEffect that uses them
  const fetchAliases = useCallback(async () => {
    try {
      const response = await safeFetchJson("/api/models/alias");
      if (!response.ok) {
        throw new Error(formatRequestError("Failed to load aliases", response, "Failed to load aliases"));
      }
      setModelAliases(response.data?.aliases || {});
    } catch (error) {
      console.log("Error fetching aliases:", error);
    }
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsResult, nodesResult] = await safeFetchJsonAll([
        { key: "connections", url: "/api/providers", options: { cache: "no-store" } },
        { key: "providerNodes", url: "/api/provider-nodes", options: { cache: "no-store" } },
      ]);

      if (connectionsResult.ok) {
        const connectionsData = connectionsResult.data;
        const filtered = (connectionsData?.connections || []).filter(c => c.provider === providerId);
        setConnections(filtered);
      }
      if (nodesResult.ok) {
        const nodesData = nodesResult.data;
        let node = (nodesData?.nodes || []).find((entry) => entry.id === providerId) || null;
        
        // For local providers (ollama, lmstudio), find by apiType instead of id
        if (!node && (providerId === "ollama" || providerId === "lmstudio")) {
          const localApiType = providerId === "ollama" ? "ollama" : "openai";
          node = (nodesData.nodes || []).find((entry) => 
            entry.type === "local" && 
            entry.apiType === localApiType &&
            (entry.baseUrl?.includes("localhost") || entry.baseUrl?.includes("127.0.0.1"))
          ) || null;
        }

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const retryResult = await safeFetchJson("/api/provider-nodes", { cache: "no-store" });
            if (!retryResult.ok) continue;
            const retryData = retryResult.data;
            node = (retryData.nodes || []).find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        setProviderNode(node);
      }
    } catch (error) {
      console.log("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId, isCompatible]);

  const handleUpdateNode = async (formData) => {
    try {
      const response = await safeFetchJson(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setProviderNode(response.data?.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      } else {
        throw new Error(formatRequestError("Failed to update provider node", response, "Failed to update provider node"));
      }
    } catch (error) {
      console.log("Error updating provider node:", error);
    }
  };

  useEffect(() => {
    fetchConnections();
    fetchAliases();

    // Refetch when tab gains focus (e.g. after OAuth popup closes) so new connection appears even if postMessage was missed
    const handleFocus = () => fetchConnections();
    window.addEventListener("focus", handleFocus);
    const handleVisibility = () => { if (document.visibilityState === "visible") fetchConnections(); };
    document.addEventListener("visibilitychange", handleVisibility);

    // Listen for re-auth requests from edit modal
    const handleReauth = (e) => {
      if (e.detail?.provider === providerId) {
        setReauthConnectionId(e.detail?.connectionId || null);
        setShowOAuthModal(true);
      }
    };
    window.addEventListener("trigger-oauth-flow", handleReauth);
    return () => {
      window.removeEventListener("trigger-oauth-flow", handleReauth);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchConnections, fetchAliases, providerId]);

  // Fetch dynamic models from /v1/models for providers with dynamic model endpoints
  useEffect(() => {
    const fetchDynamicModels = async () => {
      try {
        setDynamicModelsLoading(true);
        const response = await safeFetchJson("/v1/models");
        if (!response.ok) {
          console.log(formatRequestError("Failed to load models", response, "Failed to load models"));
          setDynamicModels([]);
          return;
        }
        const allModels = response.data?.data || [];
        
        // Filter models belonging to this provider
        const providerPrefix = providerId + "/";
        const filtered = allModels
          .filter(m => m.id?.startsWith(providerPrefix) || m.owned_by === providerId)
          .map(m => ({
            id: m.id?.startsWith(providerPrefix) ? m.id.slice(providerPrefix.length) : m.root || m.id,
            name: m.name || m.id,
            fullId: m.id,
          }));
        
        if (filtered.length > 0) {
          setDynamicModels(filtered);
          setDynamicModelsUpdatedAt(new Date().toISOString());
        } else {
          setDynamicModels([]);
          setDynamicModelsUpdatedAt(new Date().toISOString());
        }
      } catch (e) {
        console.log("Error fetching dynamic models:", e);
      } finally {
        setDynamicModelsLoading(false);
      }
    };
    
    fetchDynamicModels();
    const intervalId = setInterval(fetchDynamicModels, 180000);
    return () => clearInterval(intervalId);
  }, [providerId, refreshModelsTrigger]);

  const handleRefreshModels = useCallback(async () => {
    if (refreshModelsSyncing || connections.length === 0) return;
    setRefreshModelsSyncing(true);
    try {
      const res = await safeFetchJson(`/api/provider-sync/${providerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (res.ok) setRefreshModelsTrigger((t) => t + 1);
    } finally {
      setRefreshModelsSyncing(false);
    }
  }, [providerId, connections.length, refreshModelsSyncing]);

  const handleSetAlias = async (modelId, alias, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const response = await safeFetchJson("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (response.ok) {
        await fetchAliases();
      } else {
        alert(formatRequestError("Failed to set alias", response, "Failed to set alias"));
      }
    } catch (error) {
      console.log("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const response = await safeFetchJson(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (response.ok) {
        await fetchAliases();
      } else {
        throw new Error(formatRequestError("Failed to delete alias", response, "Failed to delete alias"));
      }
    } catch (error) {
      console.log("Error deleting alias:", error);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this connection?")) return;
    try {
      const response = await safeFetchJson(`/api/providers/${id}`, { method: "DELETE" });
      if (response.ok) {
        setConnections(connections.filter(c => c.id !== id));
      } else {
        throw new Error(formatRequestError("Failed to delete connection", response, "Failed to delete connection"));
      }
    } catch (error) {
      console.log("Error deleting connection:", error);
    }
  };

  const handleOAuthSuccess = useCallback(() => {
    setShowOAuthModal(false);
    // Brief delay so server has committed the new connection before we refetch
    setTimeout(() => fetchConnections(), 400);
  }, [fetchConnections]);

  const handleSaveApiKey = async (formData) => {
    try {
      const response = await safeFetchJson("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });
      if (response.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
      } else {
        throw new Error(formatRequestError("Failed to save connection", response, "Failed to save connection"));
      }
    } catch (error) {
      console.log("Error saving connection:", error);
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const response = await safeFetchJson(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        await fetchConnections();
        setShowEditModal(false);
      } else {
        throw new Error(formatRequestError("Failed to update connection", response, "Failed to update connection"));
      }
    } catch (error) {
      console.log("Error updating connection:", error);
    }
  };

  const handleSwapPriority = async (conn1, conn2) => {
    if (!conn1 || !conn2) return;

    // If priorities are identical, derive them from their sorted positions
    let p1 = conn1.priority || 1;
    let p2 = conn2.priority || 1;
    if (p1 === p2) {
      const sorted = [...connections].sort((a, b) => (a.priority || 0) - (b.priority || 0));
      const i1 = sorted.findIndex(c => c.id === conn1.id);
      const i2 = sorted.findIndex(c => c.id === conn2.id);
      p1 = i1 + 1;
      p2 = i2 + 1;
    }

    // Optimistic UI update
    setConnections(prev => {
      return prev.map(c => {
        if (c.id === conn1.id) return { ...c, priority: p2 };
        if (c.id === conn2.id) return { ...c, priority: p1 };
        return c;
      });
    });

    try {
      await Promise.all([
        safeFetchJson(`/api/providers/${conn1.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: p2 }),
        }),
        safeFetchJson(`/api/providers/${conn2.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: p1 }),
        })
      ]);
      await fetchConnections();
    } catch (error) {
      console.log("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  const handleUpdateConnectionStatus = async (id, isEnabled) => {
    setConnections(prev => prev.map(c => c.id === id ? { ...c, isEnabled, isActive: isEnabled } : c));

    try {
      const response = await safeFetchJson(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled }),
      });
      if (!response.ok) {
        throw new Error("Failed to update connection status");
      }
      await fetchConnections();
    } catch (error) {
      console.log("Error updating connection status:", error);
      await fetchConnections();
    }
  };

  const handleTestConnection = async (id) => {
    setTestingConnections(prev => ({ ...prev, [id]: true }));
    setTestResults(prev => ({ ...prev, [id]: null }));
    try {
      const response = await safeFetchJson(`/api/providers/${id}/test`, { method: "POST" });
      const data = response.data || {};
      const isValid = !!data.valid;
      setTestResults(prev => ({ ...prev, [id]: isValid ? "success" : "failed" }));
      if (response.ok) {
        await fetchConnections();
        // Clear result after 3 seconds
        setTimeout(() => {
          setTestResults(prev => ({ ...prev, [id]: null }));
        }, 3000);
        return isValid;
      }
    } catch (error) {
      console.log("Error testing connection:", error);
      setTestResults(prev => ({ ...prev, [id]: "failed" }));
      setTimeout(() => {
        setTestResults(prev => ({ ...prev, [id]: null }));
      }, 3000);
    } finally {
      setTestingConnections(prev => ({ ...prev, [id]: false }));
    }
    return false;
  };



  // Known model capabilities (canonical mapping for better tag detection)
  const MODEL_CAPABILITIES = {
    // Claude models with vision
    "claude-3": ["vision"],
    "claude-3.5": ["vision"],
    "claude-4": ["vision"],
    "claude-opus": ["premium", "vision"],
    "claude-sonnet": ["vision"],
    // GPT models with vision
    "gpt-4-vision": ["vision"],
    "gpt-4o": ["vision"],
    "gpt-4-turbo": ["vision"],
    "gpt-5": ["premium", "vision"],
    // Gemini with vision
    "gemini-pro-vision": ["vision"],
    "gemini-1.5": ["vision"],
    "gemini-2": ["vision"],
    // Reasoning models
    "o1": ["reasoning", "premium"],
    "o3": ["reasoning", "premium"],
    "thinking": ["reasoning"],
    "deepthink": ["reasoning"],
    "r1": ["reasoning"],
    // Code models
    "codex": ["code"],
    "code-": ["code"],
    "coder": ["code"],
    "starcoder": ["code"],
    "codellama": ["code"],
    "deepseek-coder": ["code"],
    "qwen-coder": ["code"],
    "wizardcoder": ["code"],
  };

  // Categorize model based on name patterns and known capabilities
  const categorizeModel = (modelId) => {
    const id = (modelId || "").toLowerCase();
    const tags = new Set();
    
    // Check against known model capabilities first
    for (const [pattern, caps] of Object.entries(MODEL_CAPABILITIES)) {
      if (id.includes(pattern.toLowerCase())) {
        caps.forEach(c => tags.add(c));
      }
    }
    
    // Pattern-based detection
    if (id.includes("free") || id.includes(":free") || id.endsWith("-free")) tags.add("free");
    if (id.includes("code") || id.includes("coder") || id.includes("codex")) tags.add("code");
    if (id.includes("vision") || id.includes("-vl") || id.includes("ocr") || id.includes("-v-") || id.match(/\d+v\b/)) tags.add("vision");
    if (id.includes("embed") || id.includes("embedding")) tags.add("embedding");
    if (id.includes("thinking") || id.includes("reason") || id.match(/\bo[13]\b/) || id.includes("deepthink")) tags.add("reasoning");
    if (id.includes("flash") || id.includes("mini") || id.includes("nano") || id.includes("tiny") || id.includes("haiku") || id.match(/\b[1-8]b\b/)) tags.add("fast");
    if (id.includes("opus") || id.includes("-pro") || id.includes("ultra") || id.includes("-large") || id.match(/\b(70|72|405)b\b/) || id.includes("-high")) tags.add("premium");
    if (id.includes("chat") || id.includes("instruct") || id.includes("turbo")) tags.add("chat");
    
    return Array.from(tags);
  };

  // Filter and sort models
  const getFilteredSortedModels = () => {
    let filtered = [...models];
    
    // Search filter
    if (modelSearch.trim()) {
      const search = modelSearch.toLowerCase();
      filtered = filtered.filter(m => 
        (m.id || "").toLowerCase().includes(search) || 
        (m.name || "").toLowerCase().includes(search)
      );
    }
    
    // Category filter
    if (modelFilter === "favorites") {
      filtered = filtered.filter(m => isFavorite(m.id));
    } else if (modelFilter !== "all") {
      filtered = filtered.filter(m => {
        const tags = categorizeModel(m.id);
        return tags.includes(modelFilter);
      });
    }
    
    // Sort
    filtered.sort((a, b) => {
      const aId = (a.id || "").toLowerCase();
      const bId = (b.id || "").toLowerCase();
      const aName = (a.name || a.id || "").toLowerCase();
      const bName = (b.name || b.id || "").toLowerCase();
      const aFav = isFavorite(a.id);
      const bFav = isFavorite(b.id);
      
      // Favorites always first in all sorts
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      
      switch (modelSort) {
        case "name-asc": return aName.localeCompare(bName);
        case "name-desc": return bName.localeCompare(aName);
        case "size-desc": {
          const sizeA = parseInt((aId.match(/(\d+)b/i) || ["0", "0"])[1]) || 0;
          const sizeB = parseInt((bId.match(/(\d+)b/i) || ["0", "0"])[1]) || 0;
          return sizeB - sizeA;
        }
        case "free-first": {
          const tagsA = categorizeModel(aId);
          const tagsB = categorizeModel(bId);
          if (tagsA.includes("free") && !tagsB.includes("free")) return -1;
          if (!tagsA.includes("free") && tagsB.includes("free")) return 1;
          return aName.localeCompare(bName);
        }
        case "premium-first": {
          const tagsA = categorizeModel(aId);
          const tagsB = categorizeModel(bId);
          if (tagsA.includes("premium") && !tagsB.includes("premium")) return -1;
          if (!tagsA.includes("premium") && tagsB.includes("premium")) return 1;
          return aName.localeCompare(bName);
        }
        case "reasoning-first": {
          const tagsA = categorizeModel(aId);
          const tagsB = categorizeModel(bId);
          if (tagsA.includes("reasoning") && !tagsB.includes("reasoning")) return -1;
          if (!tagsA.includes("reasoning") && tagsB.includes("reasoning")) return 1;
          return aName.localeCompare(bName);
        }
        default: return 0;
      }
    });
    
    return filtered;
  };

  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
          node={providerNode}
        />
      );
    }
    if (providerInfo.passthroughModels) {
      return (
        <PassthroughModelsSection
          providerAlias={providerAlias}
          providerStorageAlias={providerStorageAlias}
          modelAliases={modelAliases}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          connections={connections}
          discoveredModels={models}
          discoveredModelsLoading={dynamicModelsLoading}
          categorizeModel={categorizeModel}
          onRefreshModels={handleRefreshModels}
          refreshModelsSyncing={refreshModelsSyncing}
          onReportPricing={(modelId, fullModel) => {
            setSelectedModelForReport(modelId);
            setSelectedFullModelForReport(fullModel);
            setShowReportPricingModal(true);
          }}
          providerId={providerId}
        />
      );
    }
    if (models.length === 0) {
      return <p className="text-sm text-text-muted">No models configured</p>;
    }
    
    const filteredModels = getFilteredSortedModels();
    const tagCounts = { free: 0, code: 0, vision: 0, reasoning: 0, fast: 0, premium: 0, chat: 0 };
    const favCount = models.filter(m => isFavorite(m.id)).length;
    models.forEach(m => {
      const tags = categorizeModel(m.id);
      tags.forEach(t => { if (tagCounts[t] !== undefined) tagCounts[t]++; });
    });
    
    return (
      <div className="flex flex-col gap-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search models..."
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            className="w-48 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={modelSort}
            onChange={(e) => setModelSort(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="size-desc">Size (largest)</option>
            <option value="free-first">Free first</option>
            <option value="premium-first">Premium first</option>
            <option value="reasoning-first">Reasoning first</option>
          </select>
        </div>
        
        {/* Category filter buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setModelFilter("all")}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "all" ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
          >
            All ({models.length})
          </button>
          {favCount > 0 && (
            <button
              onClick={() => setModelFilter("favorites")}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "favorites" ? "bg-yellow-500 text-white" : "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/60"}`}
            >
              ★ Favorites ({favCount})
            </button>
          )}
          {tagCounts.free > 0 && (
            <button
              onClick={() => setModelFilter("free")}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "free" ? "bg-green-500 text-white" : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60"}`}
            >
              Free ({tagCounts.free})
            </button>
          )}
          {tagCounts.code > 0 && (
            <button
              onClick={() => setModelFilter("code")}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "code" ? "bg-blue-500 text-white" : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60"}`}
            >
              Code ({tagCounts.code})
            </button>
          )}
          {tagCounts.vision > 0 && (
            <button
              onClick={() => setModelFilter("vision")}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "vision" ? "bg-purple-500 text-white" : "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60"}`}
            >
              Vision ({tagCounts.vision})
            </button>
          )}
          {tagCounts.reasoning > 0 && (
            <button
              onClick={() => setModelFilter("reasoning")}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "reasoning" ? "bg-orange-500 text-white" : "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/60"}`}
            >
              Reasoning ({tagCounts.reasoning})
            </button>
          )}
          {tagCounts.fast > 0 && (
            <button
              onClick={() => setModelFilter("fast")}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "fast" ? "bg-cyan-500 text-white" : "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-200 dark:hover:bg-cyan-900/60"}`}
            >
              Fast ({tagCounts.fast})
            </button>
          )}
          {tagCounts.premium > 0 && (
            <button
              onClick={() => setModelFilter("premium")}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "premium" ? "bg-amber-500 text-white" : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60"}`}
            >
              Premium ({tagCounts.premium})
            </button>
          )}
          {tagCounts.chat > 0 && (
            <button
              onClick={() => setModelFilter("chat")}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${modelFilter === "chat" ? "bg-pink-500 text-white" : "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 hover:bg-pink-200 dark:hover:bg-pink-900/60"}`}
            >
              Chat ({tagCounts.chat})
            </button>
          )}
        </div>
        
        {/* Results count */}
        {modelSearch || modelFilter !== "all" ? (
          <p className="text-xs text-text-muted">
            Showing {filteredModels.length} of {models.length} models
          </p>
        ) : null}
        
        {/* Model grid */}
        <div className="flex flex-wrap gap-3">
          {filteredModels.map((model) => {
            const fullModel = `${providerStorageAlias}/${model.id}`;
            const oldFormatModel = `${providerId}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(
              ([, m]) => m === fullModel || m === oldFormatModel
            )?.[0];
            const tags = categorizeModel(model.id);
            const fav = isFavorite(model.id);
            
            return (
              <div
                key={model.id}
                className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${fav ? "bg-yellow-900/10 border-yellow-600/50" : "bg-bg-secondary hover:bg-bg-tertiary border-border-primary"}`}
              >
                {/* Favorite star */}
                <button
                  onClick={() => toggleFavorite(model.id)}
                  className={`text-sm transition-colors ${fav ? "text-yellow-400" : "text-gray-500 hover:text-yellow-400"}`}
                  title={fav ? "Remove from favorites" : "Add to favorites"}
                >
                  {fav ? "★" : "☆"}
                </button>
                
                {/* Tags as colored dots */}
                <div className="flex gap-0.5">
                  {tags.includes("free") && <span className="w-2 h-2 rounded-full bg-green-500" title="Free" />}
                  {tags.includes("code") && <span className="w-2 h-2 rounded-full bg-blue-500" title="Code" />}
                  {tags.includes("vision") && <span className="w-2 h-2 rounded-full bg-purple-500" title="Vision" />}
                  {tags.includes("reasoning") && <span className="w-2 h-2 rounded-full bg-orange-500" title="Reasoning" />}
                  {tags.includes("fast") && <span className="w-2 h-2 rounded-full bg-cyan-500" title="Fast" />}
                  {tags.includes("premium") && <span className="w-2 h-2 rounded-full bg-amber-500" title="Premium" />}
                  {tags.includes("chat") && <span className="w-2 h-2 rounded-full bg-pink-500" title="Chat" />}
                </div>
                
                <span className="text-sm font-mono text-text-primary max-w-[200px] truncate" title={model.fullId || `${providerDisplayAlias}/${model.id}`}>
                  {model.id}
                </span>
                
                {existingAlias && (
                  <Badge variant="secondary" size="sm">{existingAlias}</Badge>
                )}
                
                {/* Quick actions on hover */}
                <div className="hidden group-hover:flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => copy(model.fullId || `${providerDisplayAlias}/${model.id}`)}
                    className="p-1 text-text-muted hover:text-text-primary"
                    title="Copy model ID"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      setSelectedModelForPlaybook(model.fullId || `${providerDisplayAlias}/${model.id}`);
                      setShowPlaybookModal(true);
                    }}
                    className="p-1 text-text-muted hover:text-primary"
                    title="Add to Playbook"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        
        {filteredModels.length === 0 && (
          <p className="text-sm text-text-muted text-center py-4">No models match your filters</p>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  // Defensive check for rendering models
  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/dashboard/providers" className="text-primary mt-4 inline-block">
          Back to Providers
        </Link>
      </div>
    );
  }

  const enabledConnections = connections.filter((connection) => connection.isEnabled !== false).length;
  const activeConnections = connections.filter(
    (connection) => connection.isEnabled !== false && connection.testStatus === "active"
  ).length;
  const erroredConnections = connections.filter(
    (connection) => connection.isEnabled !== false && connection.testStatus === "error"
  ).length;
  const discoveredModelCount = dynamicModels.length;
  const knownModelCount = (dynamicModels.length > 0 ? dynamicModels : models).length;
  const syncLabel = dynamicModelsUpdatedAt
    ? new Date(dynamicModelsUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return getProviderIconUrl(providerInfo.apiType === "responses" ? "oai-r" : "oai-cc");
    }
    if (isAnthropicCompatible) {
      return getProviderIconUrl("anthropic-m");
    }
    return getProviderIconUrl(providerInfo.id);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/providers"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to Providers
        </Link>
        <div className="flex items-center gap-4">
          <div
            className="rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${providerInfo.color}15` }}
          >
            {headerImgError ? (
              <span className="text-sm font-bold" style={{ color: providerInfo.color }}>
                {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <Image
                src={getHeaderIconPath()}
                alt={providerInfo.name}
                width={48}
                height={48}
                className="object-contain rounded-lg max-w-[48px] max-h-[48px]"
                sizes="48px"
                onError={() => setHeaderImgError(true)}
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-3xl font-semibold tracking-tight">{providerInfo.name}</h1>
              <Badge variant="secondary" size="sm" className="font-mono text-xs">
                {providerAlias || providerId}
              </Badge>
            </div>
            <p className="text-text-muted">
              {connections.length} connection{connections.length === 1 ? "" : "s"}
            </p>
          </div>
          {(() => {
            const urls = getProviderUrls(providerId);
            if (!urls?.signupUrl) return null;
            return (
              <div className="flex gap-2 shrink-0">
                <a
                  href={urls.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background hover:bg-sidebar text-sm font-medium transition-colors"
                >
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                  Sign up
                </a>
                {urls.infoUrl && urls.infoUrl !== urls.signupUrl && (
                  <a
                    href={urls.infoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background hover:bg-sidebar text-sm font-medium transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">info</span>
                    Docs
                  </a>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {connections.length > 0 && connections.some(c => c.testStatus === "unknown" || c.testStatus === "error") && (
        <div className="flex gap-4 p-4 rounded-xl bg-primary/5 border border-primary/20 items-start">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-xl">bolt</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">Connection Activation Required</p>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              Before these models can be used in <strong>Combos</strong> or <strong>Routing Playbooks</strong>, you must verify the connection. Click the <span className="material-symbols-outlined text-[14px] align-middle">bolt</span> <strong>Test</strong> icon on your connection card below to activate it.
            </p>
          </div>
        </div>
      )}

      {/* Connections */}
      <Card>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-lg font-semibold">Connections</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {isCompatible && (
              <Button
                size="sm"
                variant="secondary"
                icon="settings"
                onClick={() => setShowEditNodeModal(true)}
              >
                Configure Endpoint
              </Button>
            )}
            <Button
              size="sm"
              icon="add"
              onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)}
            >
              Add Connection
            </Button>
          </div>
        </div>

        {connections.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">{isOAuth ? "lock" : "key"}</span>
            </div>
            <p className="text-text-main font-medium mb-1">No connections yet</p>
            <p className="text-sm text-text-muted mb-4">Add your first connection to get started</p>
            <div className="flex items-center justify-center gap-2">
              {isCompatible && (
                <Button variant="secondary" icon="settings" onClick={() => setShowEditNodeModal(true)}>
                  Configure Endpoint
                </Button>
              )}
              <Button icon="add" onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)}>
                Add Connection
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
            {connections
              .sort((a, b) => (a.priority || 0) - (b.priority || 0))
              .map((conn, index) => (
                <ConnectionRow
                  key={conn.id}
                  connection={conn}
                  isOAuth={isOAuth}
                  providerNode={providerNode}
                  isFirst={index === 0}
                  isLast={index === connections.length - 1}
                  isTesting={!!testingConnections[conn.id]}
                  testResult={testResults[conn.id]}
                  onMoveUp={() => handleSwapPriority(conn, connections[index - 1])}
                  onMoveDown={() => handleSwapPriority(conn, connections[index + 1])}
                  onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
                  onEdit={() => {
                    setSelectedConnection(conn);
                    setShowEditModal(true);
                  }}
                  onTest={() => handleTestConnection(conn.id)}
                  onDelete={() => handleDelete(conn.id)}
                  onReauth={isOAuth ? () => {
                    setReauthConnectionId(conn.id);
                    setShowOAuthModal(true);
                  } : undefined}
                />
              ))}
          </div>
        )}
      </Card>

      {/* Models */}
      <Card>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">
            {providerInfo.passthroughModels ? "Model Aliases" : "Available Models"}
          </h2>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Badge variant={activeConnections > 0 ? "success" : (erroredConnections > 0 ? "error" : "secondary")} size="sm">
              {activeConnections}/{enabledConnections || connections.length || 0} active
            </Badge>
            <Badge variant="secondary" size="sm">
              {knownModelCount} models
            </Badge>
            {providerInfo.passthroughModels && (
              <Badge variant="outline" size="sm">
                live {discoveredModelCount}
              </Badge>
            )}
            <span className="text-[11px] text-text-muted">
              sync {dynamicModelsLoading ? "..." : syncLabel}
            </span>
          </div>
        </div>
        {renderModelsSection()}

      </Card>

      {/* Add to Playbook Modal */}
      {showPlaybookModal && (
        <AddToPlaybookModal
          modelId={selectedModelForPlaybook}
          providerId={providerId}
          onClose={() => {
            setShowPlaybookModal(false);
            setSelectedModelForPlaybook(null);
          }}
        />
      )}

      {showReportPricingModal && (
        <ReportPricingModal
          modelId={selectedModelForReport}
          providerId={providerId}
          fullModel={selectedFullModelForReport}
          onClose={() => {
            setShowReportPricingModal(false);
            setSelectedModelForReport(null);
            setSelectedFullModelForReport(null);
          }}
        />
      )}

      {/* Modals */}
      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          connectionId={reauthConnectionId}
          onSuccess={handleOAuthSuccess}
          onClose={() => {
            setShowOAuthModal(false);
            setReauthConnectionId(null);
          }}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal
          isOpen={showOAuthModal}
          connectionId={reauthConnectionId}
          onSuccess={handleOAuthSuccess}
          onClose={() => {
            setShowOAuthModal(false);
            setReauthConnectionId(null);
          }}
        />
      ) : (
        <OAuthModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          connectionId={reauthConnectionId}
          onSuccess={handleOAuthSuccess}
          onClose={() => {
            setShowOAuthModal(false);
            setReauthConnectionId(null);
          }}
        />
      )}
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        onSave={handleSaveApiKey}
        onClose={() => setShowAddApiKeyModal(false)}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={handleUpdateNode}
          onClose={() => setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
    </div>
  );
}

function ModelRow({ model, fullModel, alias, copied, onCopy }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-sidebar/50">
      <span className="material-symbols-outlined text-base text-text-muted">smart_toy</span>
      <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
      <button
        onClick={() => onCopy(fullModel, `model-${model.id}`)}
        className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
        title="Copy model"
      >
        <span className="material-symbols-outlined text-sm">
          {copied === `model-${model.id}` ? "check" : "content_copy"}
        </span>
      </button>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
};

function PassthroughModelsSection({
  providerAlias,
  providerStorageAlias,
  modelAliases,
  copied,
  onCopy,
  onSetAlias,
  onDeleteAlias,
  connections,
  discoveredModels = [],
  discoveredModelsLoading = false,
  categorizeModel,
  onRefreshModels,
  refreshModelsSyncing = false,
  onReportPricing,
  providerId,
}) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  // Filter aliases for this provider - models are persisted via alias
  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => model.startsWith(`${providerAlias}/`)
  );

  const normalizeModelId = (rawModelId) => {
    const value = String(rawModelId || "").trim();
    const prefix = `${providerAlias}/`;
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  };

  const aliasedModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: fullModel.replace(`${providerAlias}/`, ""),
    fullModel,
    alias,
    source: "alias",
  }));

  const discoveredOnlyModels = (Array.isArray(discoveredModels) ? discoveredModels : [])
    .map((model) => {
      const modelId = normalizeModelId(model?.id || model?.name || model?.model);
      if (!modelId) return null;
      // Use fullId if available (from dynamic models), otherwise reconstruct
      const fullModel = model?.fullId || `${providerAlias}/${modelId}`;
      return {
        modelId,
        fullModel,
        alias: null,
        source: "live",
      };
    })
    .filter(Boolean)
    .filter((model) => !aliasedModels.some((existing) => existing.modelId === model.modelId));

  const allModels = [...aliasedModels, ...discoveredOnlyModels];

  const activeConnection = connections.find((conn) => conn.isEnabled !== false);
  const canImport = !!activeConnection;

  // Generate default alias from modelId (last part after /)
  const generateDefaultAlias = (modelId) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1];
  };

  const resolveAlias = (modelId) => {
    const baseAlias = generateDefaultAlias(modelId);
    if (!modelAliases[baseAlias]) return baseAlias;
    const prefixedAlias = `${providerAlias}-${baseAlias}`;
    if (!modelAliases[prefixedAlias]) return prefixedAlias;
    return null;
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = normalizeModelId(newModel);
    if (!modelId) return;
    const resolvedAlias = resolveAlias(modelId);
    if (!resolvedAlias) {
      alert("All suggested aliases already exist. Please use a different model or edit existing alias.");
      return;
    }

    setAdding(true);
    try {
      await onSetAlias(modelId, resolvedAlias, providerStorageAlias || providerAlias);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (!activeConnection || importing) return;

    setImporting(true);
    try {
      const response = await safeFetchJson(`/api/providers/${activeConnection.id}/models`);
      const data = response.data || {};
      if (!response.ok) {
        alert(data.error || "Failed to import models");
        return;
      }

      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }

      let importedCount = 0;
      for (const model of models) {
        const modelId = normalizeModelId(model.id || model.name || model.model);
        if (!modelId) continue;
        const resolvedAlias = resolveAlias(modelId);
        if (!resolvedAlias) continue;
        await onSetAlias(modelId, resolvedAlias, providerStorageAlias || providerAlias);
        importedCount += 1;
      }

      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
      alert("Failed to import models");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add models manually, or import the provider /models list and create aliases for quick access.
      </p>

      {/* Add new model */}
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="anthropic/claude-3-opus"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
        {onRefreshModels && connections.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            icon="sync"
            onClick={onRefreshModels}
            disabled={refreshModelsSyncing}
          >
            {refreshModelsSyncing ? "Refreshing..." : "Refresh models"}
          </Button>
        )}
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add and enable a connection to import models.
        </p>
      )}

      {discoveredModelsLoading && (
        <p className="text-xs text-text-muted">
          Refreshing live model list...
        </p>
      )}

      {/* Models list */}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel, alias, source }) => (
            <PassthroughModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={fullModel}
              providerAlias={providerAlias}
              tags={categorizeModel ? [...(categorizeModel(modelId) || [])] : []}
              copied={copied}
              onCopy={onCopy}
              source={source}
              onDeleteAlias={alias ? () => onDeleteAlias(alias) : null}
              onReportPricing={onReportPricing ? () => onReportPricing(modelId, fullModel) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

PassthroughModelsSection.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  providerStorageAlias: PropTypes.string,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onRefreshModels: PropTypes.func,
  refreshModelsSyncing: PropTypes.bool,
  onDeleteAlias: PropTypes.func.isRequired,
  connections: PropTypes.array.isRequired,
  discoveredModels: PropTypes.array,
  discoveredModelsLoading: PropTypes.bool,
  categorizeModel: PropTypes.func,
  onReportPricing: PropTypes.func,
  providerId: PropTypes.string,
};

function PassthroughModelRow({ modelId, fullModel, providerAlias, tags = [], copied, onCopy, source = "alias", onDeleteAlias = null, onReportPricing = null }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-sidebar/50">
      <span className="material-symbols-outlined text-base text-text-muted">smart_toy</span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">{modelId}</p>
          {providerAlias && (
            <Badge variant="secondary" size="sm" className="shrink-0 font-mono text-xs">
              {providerAlias}
            </Badge>
          )}
          {source === "live" && (
            <Badge variant="outline" size="sm" className="text-xs">
              live
            </Badge>
          )}
          {tags.length > 0 && (
            <span className="flex items-center gap-1 flex-wrap">
              {tags.map((tag) => (
                <Badge key={tag} variant="outline" size="sm" className="text-xs capitalize">
                  {tag}
                </Badge>
              ))}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <button
            onClick={() => onCopy(fullModel, `model-${modelId}`)}
            className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            title="Copy model"
          >
            <span className="material-symbols-outlined text-sm">
              {copied === `model-${modelId}` ? "check" : "content_copy"}
            </span>
          </button>
        </div>
      </div>

      {/* Report pricing button */}
      {typeof onReportPricing === "function" && (
        <button
          onClick={onReportPricing}
          className="p-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded text-blue-600 dark:text-blue-400"
          title="Report pricing"
        >
          <span className="material-symbols-outlined text-sm">description</span>
        </button>
      )}

      {/* Delete button */}
      {typeof onDeleteAlias === "function" && (
        <button
          onClick={onDeleteAlias}
          className="p-1 hover:bg-red-50 rounded text-red-500"
          title="Remove model"
        >
          <span className="material-symbols-outlined text-sm">delete</span>
        </button>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  connections: PropTypes.array.isRequired,
  isAnthropic: PropTypes.bool.isRequired,
  node: PropTypes.object,
};

function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias, connections, isAnthropic, node }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncingKiro, setSyncingKiro] = useState(false);
  const [kiroSyncStats, setKiroSyncStats] = useState(null);

  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => model.startsWith(`${providerStorageAlias}/`)
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: fullModel.replace(`${providerStorageAlias}/`, ""),
    fullModel,
    alias,
  }));

  const generateDefaultAlias = (modelId) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1];
  };

  const resolveAlias = (modelId) => {
    const baseAlias = generateDefaultAlias(modelId);
    if (!modelAliases[baseAlias]) return baseAlias;
    const prefixedAlias = `${providerDisplayAlias}-${baseAlias}`;
    if (!modelAliases[prefixedAlias]) return prefixedAlias;
    return null;
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const resolvedAlias = resolveAlias(modelId);
    if (!resolvedAlias) {
      alert("All suggested aliases already exist. Please choose a different model or remove conflicting aliases.");
      return;
    }

    setAdding(true);
    try {
      await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isEnabled !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const response = await safeFetchJson(`/api/providers/${activeConnection.id}/models`);
      const data = response.data || {};
      if (!response.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        const resolvedAlias = resolveAlias(modelId);
        if (!resolvedAlias) continue;
        await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const handleSyncKiro = async () => {
    if (syncingKiro || !node) return;
    setSyncingKiro(true);
    setKiroSyncStats(null);
    try {
      const activeConn = connections.find(c => c.isEnabled !== false) || connections[0];
      const response = await safeFetchJson("/api/providers/kiro/sync-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: activeConn?.id,
          nodeId: node.id,
          apiKey: activeConn?.apiKey || "",
        }),
      });
      const data = response.data || {};
      if (response.ok) {
        const reg = data.registeredToRegistry != null ? ` (${data.registeredToRegistry} in registry)` : "";
        setKiroSyncStats(`Synced ${data.count} models at ${new Date(data.fetchedAt).toLocaleTimeString()}${reg}`);
      } else {
        setKiroSyncStats(formatRequestError("Failed to sync models", response, "Failed to sync models"));
      }
    } catch (error) {
      setKiroSyncStats("Failed to sync models");
    } finally {
      setSyncingKiro(false);
    }
  };

  const canImport = connections.some((conn) => conn.isEnabled !== false);
  const isKiroNode = node?.baseUrl?.includes("kiro.ai");

  return (
    <div className="flex flex-col gap-4">
      {isKiroNode && (
        <div className="flex items-center gap-4 bg-primary/5 border border-primary/20 p-4 rounded-xl">
          <div className="flex-1">
            <h3 className="font-semibold mb-1">Kiro Auto-Sync</h3>
            <p className="text-sm text-text-muted">
              Automatically fetch and merge the latest Kiro/OpenRouter generic models into the global `/v1/models` route. Add an API key connection above if you want to sync premium models.
            </p>
            {kiroSyncStats && (
              <p className="text-xs text-primary mt-2 font-medium">{kiroSyncStats}</p>
            )}
          </div>
          <Button
            onClick={handleSyncKiro}
            disabled={syncingKiro || connections.length === 0}
            icon={syncingKiro ? "sync" : "cloud_download"}
            className={syncingKiro ? "animate-spin-slow" : ""}
          >
            {syncingKiro ? "Syncing..." : "Sync Models from Kiro"}
          </Button>
        </div>
      )}

      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel, alias }) => (
            <PassthroughModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={`${providerDisplayAlias}/${modelId}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isEnabled: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};

function CooldownTimer({ until }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const updateRemaining = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("");
        return;
      }
      const secs = Math.floor(diff / 1000);
      if (secs < 60) {
        setRemaining(`${secs}s`);
      } else if (secs < 3600) {
        setRemaining(`${Math.floor(secs / 60)}m ${secs % 60}s`);
      } else {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        setRemaining(`${hrs}h ${mins}m`);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [until]);

  if (!remaining) return null;

  return (
    <span className="text-xs text-primary font-mono">
      ⏱ {remaining}
    </span>
  );
}

CooldownTimer.propTypes = {
  until: PropTypes.string.isRequired,
};

function ConnectionRow({ connection, isOAuth, providerNode, isFirst, isLast, isTesting, testResult, onMoveUp, onMoveDown, onToggleActive, onEdit, onDelete, onTest, onReauth }) {
  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name;

  const subLabel = !isOAuth && providerNode?.baseUrl
    ? providerNode.baseUrl.replace(/\/$/, "")
    : null;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  useEffect(() => {
    const checkCooldown = () => {
      const cooldown = connection.rateLimitedUntil &&
        new Date(connection.rateLimitedUntil).getTime() > Date.now();
      setIsCooldown(cooldown);
    };

    checkCooldown();
    // Update every second while in cooldown
    const interval = connection.rateLimitedUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [connection.rateLimitedUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired → treat as active
    : connection.testStatus;

  const getStatusVariant = () => {
    if (connection.isEnabled === false) return "default";
    if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
    if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
    return "default";
  };

  return (
    <div className={`group flex items-center justify-between p-3 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${connection.isEnabled === false ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Priority arrows */}
        <div className="flex flex-col">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </button>
        </div>
        <span className="material-symbols-outlined text-base text-text-muted">
          {isOAuth ? "lock" : "key"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {subLabel && <p className="text-xs text-text-muted truncate font-mono mt-0.5">{subLabel}</p>}
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isEnabled === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            {connection.authType === "oauth" && connection.oauthNeedsSecret && connection.isEnabled !== false && (
              <Badge variant="warning" size="sm" dot>
                secret missing
              </Badge>
            )}
            {connection.authType === "oauth" && connection.hasOAuthClientSecret && connection.isEnabled !== false && (
              <Badge variant="secondary" size="sm">
                secret configured
              </Badge>
            )}
            {isCooldown && connection.isEnabled !== false && <CooldownTimer until={connection.rateLimitedUntil} />}
            {connection.lastError && connection.isEnabled !== false && (
              <span className="text-xs text-red-500 truncate max-w-[300px]" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
            {/* Group Badge */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${connection.group === "work" ? "bg-purple-500/10 text-purple-600 border-purple-500/20" :
              connection.group === "team" ? "bg-blue-500/10 text-blue-600 border-blue-500/20" :
                connection.group === "personal" ? "bg-green-500/10 text-green-600 border-green-500/20" :
                  "bg-gray-500/10 text-gray-600 border-gray-500/20"
              }`}>
              {connection.group ? connection.group.charAt(0).toUpperCase() + connection.group.slice(1) : "Default"}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex flex-col items-end mr-2">
          {connection.latency && (
            <div className="flex items-center gap-1 text-[10px] text-text-muted">
              <span className="material-symbols-outlined text-[12px]">timer</span>
              {connection.latency}ms
            </div>
          )}
          {connection.tps && (
            <div className="flex items-center gap-1 text-[10px] text-text-muted">
              <span className="material-symbols-outlined text-[12px]">speed</span>
              {connection.tps} t/s
            </div>
          )}
        </div>
        {/* Always-visible Reconnect button for errored/expired OAuth connections */}
        {isOAuth && onReauth && connection.isEnabled !== false && (
          effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable"
        ) && (
          <button
            onClick={onReauth}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition-colors shrink-0"
            title="Re-authenticate this connection"
          >
            <span className="material-symbols-outlined text-[13px]">refresh</span>
            Reconnect
          </button>
        )}
        <Toggle
          size="sm"
          checked={connection.isEnabled ?? true}
          onChange={onToggleActive}
          title={(connection.isEnabled ?? true) ? "Disable connection" : "Enable connection"}
        />
        <div className="flex gap-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onTest}
            disabled={isTesting}
            className={`p-2 rounded transition-all duration-200 ${isTesting ? "bg-primary/10 text-primary animate-pulse" : "hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"}`}
            title="Test Connection - required to activate in Combos"
          >
            {testResult === "success" ? (
              <span className="material-symbols-outlined text-[18px] text-green-500">check_circle</span>
            ) : testResult === "failed" ? (
              <span className="material-symbols-outlined text-[18px] text-red-500">error</span>
            ) : (
              <span className={`material-symbols-outlined text-[18px] ${isTesting ? "spin-animation" : ""}`}>bolt</span>
            )}
          </button>
          <button onClick={onEdit} className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary" title="Edit Connection">
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-red-500/10 rounded text-red-500">
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    rateLimitedUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    isEnabled: PropTypes.bool,
    hasOAuthClientSecret: PropTypes.bool,
    oauthNeedsSecret: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
    group: PropTypes.string,
  }).isRequired,
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  isTesting: PropTypes.bool,
  testResult: PropTypes.string,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onTest: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onReauth: PropTypes.func,
};

function AddApiKeyModal({ isOpen, provider, providerName, isCompatible, isAnthropic, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    apiKey: "",
    priority: 1,
    group: "default",
    isEnabled: true,
  });
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const response = await safeFetchJson("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = response.data || {};
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;

    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true);
        setValidationResult(null);
        const response = await safeFetchJson("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = response.data || {};
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch {
        setValidationResult("failed");
      } finally {
        setValidating(false);
      }

      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        group: formData.group,
        isEnabled: formData.isEnabled,
        testStatus: isValid ? "active" : "unknown",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} API Key`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Production Key"
        />
        <div className="flex gap-2">
          <Input
            label="API Key"
            type="password"
            value={formData.apiKey}
            onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        {isCompatible && (
          <p className="text-xs text-text-muted">
            {isAnthropic
              ? `Validation checks ${providerName || "Anthropic Compatible"} by verifying the API key.`
              : `Validation checks ${providerName || "OpenAI Compatible"} via /models on your base URL.`
            }
          </p>
        )}
        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />
        <div className="flex flex-col gap-1.5 mt-2">
          <label className="text-sm font-medium">Group</label>
          <div className="flex gap-2">
            {["default", "work", "personal", "other"].map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setFormData({ ...formData, group: g })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${formData.group === g
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-transparent border-border text-text-muted hover:border-primary/50"
                  }`}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-black/5 dark:bg-white/5 mt-2 mb-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Enable Connection</span>
            <span className="text-xs text-text-muted">Allow this account to be used for routing</span>
          </div>
          <Toggle
            checked={formData.isEnabled}
            onChange={(checked) => setFormData({ ...formData, isEnabled: checked })}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name || !formData.apiKey || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  isCompatible: PropTypes.bool,
  isAnthropic: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

function EditConnectionModal({ isOpen, connection, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    priority: 1,
    group: "default",
    apiKey: "",
    isEnabled: true,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name || "",
        priority: connection.priority || 1,
        group: connection.group || "default",
        apiKey: "",
        isEnabled: connection.isEnabled !== false,
      });
      setTestResult(null);
      setValidationResult(null);
    }
  }, [connection]);

  const handleTest = async () => {
    if (!connection?.provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const response = await safeFetchJson(`/api/providers/${connection.id}/test`, { method: "POST" });
      const data = response.data || {};
      setTestResult(data.valid ? "success" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false);
    }
  };

  const handleValidate = async () => {
    if (!connection?.provider || !formData.apiKey) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const response = await safeFetchJson("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: connection.provider, apiKey: formData.apiKey }),
      });
      const data = response.data || {};
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const updates = {
        name: formData.name,
        priority: formData.priority,
        group: formData.group,
        isEnabled: formData.isEnabled
      };
      if (!isOAuth && formData.apiKey) {
        updates.apiKey = formData.apiKey;
        let isValid = validationResult === "success";
        if (!isValid) {
          try {
            setValidating(true);
            setValidationResult(null);
            const response = await safeFetchJson("/api/providers/validate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider: connection.provider, apiKey: formData.apiKey }),
            });
            const data = response.data || {};
            isValid = !!data.valid;
            setValidationResult(isValid ? "success" : "failed");
          } catch {
            setValidationResult("failed");
          } finally {
            setValidating(false);
          }
        }
        if (isValid) {
          updates.testStatus = "active";
          updates.lastError = null;
          updates.lastErrorAt = null;
        }
      }
      await onSave(updates);
    } finally {
      setSaving(false);
    }
  };

  if (!connection) return null;

  const isOAuth = connection.authType === "oauth";
  const isCompatible = isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider);

  return (
    <Modal isOpen={isOpen} title="Edit Connection" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOAuth ? "Account name" : "Production Key"}
        />
        {isOAuth && (
          <div className="bg-sidebar/50 p-3 rounded-lg flex items-center justify-between">
            <div>
              <p className="text-sm text-text-muted mb-1">{connection.email ? "Email" : "Account Type"}</p>
              <p className="font-medium">{connection.email || "Local OAuth Connection"}</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              onClick={() => {
                onClose(); // Close edit modal
                // Detail page has the OAuthModal and we can trigger it
                // We assume there's a global way or we need to pass a callback
                window.dispatchEvent(new CustomEvent("trigger-oauth-flow", { detail: { provider: connection.provider } }));
              }}
            >
              Re-authenticate
            </Button>
          </div>
        )}
        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Group</label>
          <div className="flex gap-2">
            {["default", "work", "personal", "other"].map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setFormData({ ...formData, group: g })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${formData.group === g
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-transparent border-border text-text-muted hover:border-primary/50"
                  }`}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-black/5 dark:bg-white/5 mt-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Enable Connection</span>
            <span className="text-xs text-text-muted">Allow this account to be used for routing</span>
          </div>
          <Toggle
            checked={formData.isEnabled}
            onChange={(checked) => setFormData({ ...formData, isEnabled: checked })}
          />
        </div>
        {!isOAuth && (
          <>
            <div className="flex gap-2">
              <Input
                label="API Key"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="Enter new API key"
                hint="Leave blank to keep the current API key."
                className="flex-1"
              />
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
                  {validating ? "Checking..." : "Check"}
                </Button>
              </div>
            </div>
            {validationResult && (
              <Badge variant={validationResult === "success" ? "success" : "error"}>
                {validationResult === "success" ? "Valid" : "Invalid"}
              </Badge>
            )}
          </>
        )}

        {/* Test Connection */}
        <div className="flex items-center gap-3">
          <Button onClick={handleTest} variant="secondary" disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </Button>
          {testResult && (
            <Badge variant={testResult === "success" ? "success" : "error"}>
              {testResult === "success" ? "Valid" : "Failed"}
            </Badge>
          )}
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

EditConnectionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    priority: PropTypes.number,
    authType: PropTypes.string,
    provider: PropTypes.string,
    group: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

function EditCompatibleNodeModal({ isOpen, node, onSave, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
      });
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const response = await safeFetchJson("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible"
        }),
      });
      const data = response.data || {};
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  if (!node) return null;

  return (
    <Modal isOpen={isOpen} title={`Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={`${isAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={isAnthropic ? "ac-prod" : "oc-prod"}
          hint="Required. Used as the provider prefix for model IDs."
        />
        {!isAnthropic && (
          <Select
            label="API Type"
            options={apiTypeOptions}
            value={formData.apiType}
            onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
          />
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
          hint={`Use the base URL (ending in /v1) for your ${isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
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
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
