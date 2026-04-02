"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, Badge, Button, Input, Select } from "@/shared/components";
import Image from "next/image";
import useUserStore from "@/store/userStore";
import { getProviderIconUrl } from "@/shared/constants/provider-urls";
import { formatRequestError, safeFetchJson, safeFetchJsonAll } from "@/shared/utils";

const VALID_VIEWS = ["registry", "costs", "spot", "intelligence", "leaderboards", "compare", "contributors", "review", "community"];

const INTENT_FILTERS = ['All', 'code', 'chat', 'analysis', 'creative', 'default'];

function StarRating({ value, onChange }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={() => onChange(n)}
          className={`text-sm ${n <= value ? 'text-yellow-400' : 'text-gray-300'}`}>★</button>
      ))}
    </div>
  );
}

function CommunityPlaybooksSection() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [communityIntent, setCommunityIntent] = useState('All');
  const [sort, setSort] = useState('downloads');
  const [installing, setInstalling] = useState(null);
  const [rating, setRating] = useState({});
  const [shareModal, setShareModal] = useState(false);
  const [myPlaybooks, setMyPlaybooks] = useState([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ sort, limit: '20', offset: '0' });
    if (search) params.set('search', search);
    if (communityIntent !== 'All') params.set('intent', communityIntent);
    const r = await safeFetchJson(`/api/marketplace/playbooks?${params}`);
    if (r.ok) { setItems(r.data.items || []); setTotal(r.data.total || 0); }
  }, [search, communityIntent, sort]);

  useEffect(() => { load(); }, [load]);

  const handleInstall = async (item) => {
    setInstalling(item.id);
    try {
      const r1 = await fetch(`/api/marketplace/playbooks/${item.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download' }),
      });
      const { rules, title } = await r1.json();
      await fetch('/api/routing/playbooks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `[Community] ${title}`, rules, isActive: false }),
      });
      alert(`"${title}" installed! Enable it in Routing Rules.`);
      load();
    } catch (e) {
      alert('Install failed: ' + e.message);
    } finally {
      setInstalling(null);
    }
  };

  const handleRate = async (id, r) => {
    setRating(prev => ({ ...prev, [id]: r }));
    await fetch(`/api/marketplace/playbooks/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rate', rating: r }),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Community Playbooks</h2>
          <p className="text-xs text-text-muted mt-0.5">{total} playbooks available</p>
        </div>
        <Button size="sm" icon="upload" onClick={() => { safeFetchJson('/api/routing/playbooks').then(r => { if (r.ok) setMyPlaybooks(r.data.playbooks || r.data || []); setShareModal(true); }); }}>Share a Playbook</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search playbooks..."
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm w-48" />
        <div className="flex gap-1">
          {INTENT_FILTERS.map(f => (
            <button key={f} onClick={() => setCommunityIntent(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${communityIntent===f ? 'bg-primary text-white border-primary' : 'border-border text-text-muted hover:border-primary'}`}>
              {f}
            </button>
          ))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm ml-auto">
          <option value="downloads">Most Downloaded</option>
          <option value="rating">Top Rated</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(item => (
          <div key={item.id} className="border border-border rounded-xl p-4 bg-surface flex flex-col gap-2 hover:border-primary/50 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">{item.title}</p>
                <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{item.description}</p>
              </div>
              {item.is_featured === 1 && <Badge size="xs" variant="primary">Featured</Badge>}
            </div>
            <div className="flex gap-1 flex-wrap">
              {(item.tags || []).map(t => <Badge key={t} size="xs" variant="secondary">{t}</Badge>)}
            </div>
            <div className="flex items-center gap-3 text-xs text-text-muted mt-auto pt-1">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">download</span>{item.downloads}
              </span>
              {item.avgRating && <span className="flex items-center gap-1"><span className="text-yellow-400">★</span>{item.avgRating}</span>}
              <span className="flex items-center gap-1 ml-auto">by {item.author}</span>
            </div>
            <StarRating value={rating[item.id] || 0} onChange={r => handleRate(item.id, r)} />
            <Button size="sm" onClick={() => handleInstall(item)} disabled={installing === item.id}>
              {installing === item.id ? 'Installing...' : 'Install'}
            </Button>
          </div>
        ))}
      </div>

      {/* Share modal */}
      {shareModal && (
        <ShareModal playbooks={myPlaybooks} onClose={() => setShareModal(false)} onShared={load} />
      )}

      <div className="text-center py-4 text-xs text-text-muted border-t border-border mt-4">
        ZippyCoin micro-rewards for top-rated playbooks coming in a future Pro release.
      </div>
    </div>
  );
}

function ShareModal({ playbooks, onClose, onShared }) {
  const [selected, setSelected] = useState(null);
  const [author, setAuthor] = useState('');
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    if (!selected) return;
    const pb = playbooks.find(p => p.id === selected);
    if (!pb) return;
    setSharing(true);
    try {
      await fetch('/api/marketplace/playbooks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: pb.name, description: pb.description, author, intent: pb.intent, tags: pb.tags, rules: pb.rules }),
      });
      onShared();
      onClose();
    } finally { setSharing(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="text-base font-semibold mb-4">Share a Playbook</h3>
        <div className="flex flex-col gap-3">
          <select value={selected || ''} onChange={e => setSelected(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm">
            <option value="">Select a playbook...</option>
            {playbooks.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Your name (optional)"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm" />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleShare} disabled={!selected || sharing}>{sharing ? 'Sharing...' : 'Share'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
    const searchParams = useSearchParams();
    const { user } = useUserStore();
    const [models, setModels] = useState([]);
    const [costModels, setCostModels] = useState([]);
    const [spotPriceModels, setSpotPriceModels] = useState([]);
    const [scoreRows, setScoreRows] = useState([]);
    const [leaderboards, setLeaderboards] = useState({ costLeaders: [], freeModels: [], communityFavorites: [] });
    const [leaderboardsLoading, setLeaderboardsLoading] = useState(true);
    const [loading, setLoading] = useState(true);
    const [costLoading, setCostLoading] = useState(true);
    const [spotPriceLoading, setSpotPriceLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterProvider, setFilterProvider] = useState("all");
    const [intent, setIntent] = useState("code");
    const [activeView, setActiveView] = useState("registry");
    const [spotPriceFilter, setSpotPriceFilter] = useState("all");
    const [error, setError] = useState(null);
    const [showPriceSubmit, setShowPriceSubmit] = useState(false);
    const [priceSubmitForm, setPriceSubmitForm] = useState({
        providerId: "",
        modelId: "",
        tier: "",
        inputPerMUsd: "",
        outputPerMUsd: "",
        notes: "",
    });
    const [priceSubmitLoading, setPriceSubmitLoading] = useState(false);
    const [priceSubmitSuccess, setPriceSubmitSuccess] = useState(false);
    const [comparisonMatrix, setComparisonMatrix] = useState([]);
    const [comparisonLoading, setComparisonLoading] = useState(true);
    const [comparisonSearch, setComparisonSearch] = useState("");
    const [contributors, setContributors] = useState([]);
    const [contributorsLoading, setContributorsLoading] = useState(true);
    const [contributorType, setContributorType] = useState("total");
    const [pendingSubmissions, setPendingSubmissions] = useState([]);
    const [pendingLoading, setPendingLoading] = useState(true);
    const [votingSubmission, setVotingSubmission] = useState(null);
    const [voteReason, setVoteReason] = useState("");
    const [activityFeed, setActivityFeed] = useState([]);
    const [syncAllLoading, setSyncAllLoading] = useState(false);

    useEffect(() => {
        const viewParam = searchParams.get("view");
        if (viewParam && VALID_VIEWS.includes(viewParam)) {
            setActiveView(viewParam);
        }
    }, [searchParams]);

    useEffect(() => {
        fetchModels();
        fetchCosts();
        fetchScores("code");
    }, [filterProvider]);

    useEffect(() => {
        if (activeView === "spot") fetchSpotPrices();
        if (activeView === "leaderboards") fetchLeaderboards();
        if (activeView === "compare") fetchComparisonMatrix();
        if (activeView === "contributors") fetchContributors();
        if (activeView === "review") fetchPendingSubmissions();
    }, [activeView, spotPriceFilter, contributorType]);

    const fetchComparisonMatrix = async () => {
        setComparisonLoading(true);
        try {
            const params = new URLSearchParams();
            if (comparisonSearch) params.append("model", comparisonSearch);
            const res = await safeFetchJson(`/api/marketplace/comparison-matrix?${params.toString()}`);
            const data = res.data || {};
            if (res.ok) {
                setComparisonMatrix(data.matrix || []);
            }
        } catch (error) {
            console.error("Error fetching comparison matrix:", error);
        } finally {
            setComparisonLoading(false);
        }
    };

    const fetchContributors = async () => {
        setContributorsLoading(true);
        try {
            const res = await safeFetchJson(`/api/tokenbuddy/contributors?type=${contributorType}&limit=20`);
            const data = res.data || {};
            if (res.ok) {
                setContributors(data.leaderboard || []);
            }
        } catch (error) {
            console.error("Error fetching contributors:", error);
        } finally {
            setContributorsLoading(false);
        }
    };

    const fetchPendingSubmissions = async () => {
        setPendingLoading(true);
        try {
            const [pendingRes, feedRes] = await safeFetchJsonAll([
                { key: "pending", url: "/api/tokenbuddy/submissions?status=pending&limit=50" },
                { key: "feed", url: "/api/tokenbuddy/submissions?feed=true&limit=10" },
            ]);
            const pendingData = pendingRes.data || {};
            const feedData = feedRes.data || {};
            if (pendingRes.ok) {
                setPendingSubmissions(pendingData.submissions || []);
            }
            if (feedRes.ok) {
                setActivityFeed(feedData.activity || []);
            }
        } catch (error) {
            console.error("Error fetching pending submissions:", error);
        } finally {
            setPendingLoading(false);
        }
    };

    const handleVote = async (submissionId, vote) => {
        try {
            const res = await safeFetchJson("/api/tokenbuddy/vote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    submissionId,
                    voterId: user?.id || "anonymous", // Use actual user ID from auth
                    vote,
                    reason: vote === "down" ? voteReason : null,
                }),
            });
            const data = res.data || {};
            if (res.ok) {
                fetchPendingSubmissions();
                setVotingSubmission(null);
                setVoteReason("");
            } else {
                alert(data.error || "Failed to vote");
            }
        } catch (error) {
            console.error("Error voting:", error);
        }
    };

    const fetchLeaderboards = async () => {
        setLeaderboardsLoading(true);
        try {
            const res = await safeFetchJson("/api/marketplace/leaderboards?limit=10");
            const data = res.data || {};
            if (res.ok) {
                setLeaderboards({
                    costLeaders: data.costLeaders || [],
                    freeModels: data.freeModels || [],
                    communityFavorites: data.communityFavorites || [],
                });
            }
        } catch (error) {
            console.error("Error fetching leaderboards:", error);
        } finally {
            setLeaderboardsLoading(false);
        }
    };

    const submitCommunityPrice = async () => {
        if (!priceSubmitForm.providerId || !priceSubmitForm.modelId) {
            setError("Provider and Model are required");
            return;
        }
        setPriceSubmitLoading(true);
        setPriceSubmitSuccess(false);
        try {
            // Submit to TokenBuddy pending queue for community verification
            const res = await safeFetchJson("/api/tokenbuddy/submissions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    providerId: priceSubmitForm.providerId,
                    modelId: priceSubmitForm.modelId,
                    tier: priceSubmitForm.tier || null,
                    inputPerMUsd: parseFloat(priceSubmitForm.inputPerMUsd) || 0,
                    outputPerMUsd: parseFloat(priceSubmitForm.outputPerMUsd) || 0,
                    notes: priceSubmitForm.notes || null,
                    isNewModel: priceSubmitForm.isNewModel || false,
                    isFree: priceSubmitForm.isFree || false,
                    submittedBy: user?.id || "anonymous", // Use actual user ID from auth
                }),
            });
            if (res.ok) {
                setPriceSubmitSuccess(true);
                setPriceSubmitForm({ providerId: "", modelId: "", tier: "", inputPerMUsd: "", outputPerMUsd: "", notes: "" });
                setTimeout(() => {
                    setShowPriceSubmit(false);
                    setPriceSubmitSuccess(false);
                    if (activeView === "leaderboards") fetchLeaderboards();
                }, 1500);
            } else {
                const data = res.data || {};
                setError(data.error || "Failed to submit price");
            }
        } catch (err) {
            console.error("Error submitting price:", err);
            setError("Failed to submit price");
        } finally {
            setPriceSubmitLoading(false);
        }
    };

    const fetchModels = async () => {
        setLoading(true);
        setError(null);
        try {
            let url = "/api/marketplace/models";
            const params = new URLSearchParams();
            if (filterProvider !== "all") params.append("provider", filterProvider);
            if (search) params.append("search", search);

            if (params.toString()) url += `?${params.toString()}`;

            const res = await safeFetchJson(url);
            const data = res.data || {};
            if (res.ok) setModels(data.models || []);
            else setError(data.error || "Failed to load models");
        } catch (error) {
            console.error("Error fetching marketplace models:", error);
            setError("Failed to connect to marketplace");
        } finally {
            setLoading(false);
        }
    };

    const handleSyncAllProviders = async () => {
        if (syncAllLoading) return;
        setSyncAllLoading(true);
        try {
            const res = await safeFetchJson("/api/provider-sync/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ force: true }),
            });
            if (res.ok) {
                await fetchModels();
                await fetchCosts();
                await fetchScores("code");
                if (activeView === "compare") fetchComparisonMatrix();
            }
        } catch (err) {
            console.error("Sync all providers failed:", err);
        } finally {
            setSyncAllLoading(false);
        }
    };

    const fetchCosts = async () => {
        setCostLoading(true);
        try {
            const res = await safeFetchJson("/api/marketplace/costs");
            const data = res.data || {};
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
            const res = await safeFetchJson(`/api/marketplace/spot-prices?${params.toString()}`);
            const data = res.data || {};
            if (res.ok) setSpotPriceModels(data.models || []);
        } catch (error) {
            console.error("Error fetching spot prices:", error);
        } finally {
            setSpotPriceLoading(false);
        }
    };

    const fetchScores = async (nextIntent) => {
        try {
            const res = await safeFetchJson(`/api/marketplace/models/scores?intent=${encodeURIComponent(nextIntent)}`);
            const data = res.data || {};
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
                <h1 className="text-2xl font-bold">Model Marketplace</h1>
                <p className="text-text-muted">Spot pricing (USD per 1M tokens) across providers. Live data when connected; official defaults otherwise.</p>
            </div>

            {error && (
                <Card className="border-red-500 bg-red-50 dark:bg-red-900/20">
                    <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                            <span>⚠️</span>
                            <span>{error}</span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setError(null)}>✕</Button>
                    </div>
                </Card>
            )}

            <Card>
                <div className="flex items-center gap-2 p-4 border-b border-border">
                    <Button variant={activeView === "registry" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("registry")}>
                        Registry
                    </Button>
                    <Button variant={activeView === "costs" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("costs")}>
                        Cost Comparison
                    </Button>
                    <Button variant={activeView === "spot" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("spot")}>
                        Spot Prices
                    </Button>
                    <Button variant={activeView === "intelligence" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("intelligence")}>
                        Intent Intelligence
                    </Button>
                    <Button variant={activeView === "leaderboards" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("leaderboards")}>
                        Leaderboards
                    </Button>
                    <Button variant={activeView === "compare" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("compare")}>
                        Compare
                    </Button>
                    <Button variant={activeView === "contributors" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("contributors")}>
                        TokenBuddy
                    </Button>
                    <Button variant={activeView === "review" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("review")}>
                        Review Queue {pendingSubmissions.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs bg-orange-500 rounded-full">{pendingSubmissions.length}</span>}
                    </Button>
                    <Button variant={activeView === "community" ? "primary" : "secondary"} size="sm" onClick={() => setActiveView("community")}>
                        Community Playbooks
                    </Button>
                    <div className="ml-auto flex items-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            icon="sync"
                            onClick={handleSyncAllProviders}
                            disabled={syncAllLoading}
                        >
                            {syncAllLoading ? "Syncing…" : "Sync all provider models"}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setShowPriceSubmit(true)}>
                            Submit Price
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Price Submission Modal */}
            {showPriceSubmit && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <Card className="w-full max-w-md mx-4">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <h2 className="text-lg font-semibold">Submit Community Price</h2>
                            <Button variant="ghost" size="sm" onClick={() => setShowPriceSubmit(false)}>✕</Button>
                        </div>
                        <div className="p-4 space-y-4">
                            {priceSubmitSuccess ? (
                                <div className="text-center py-8">
                                    <div className="text-4xl mb-2">✓</div>
                                    <p className="text-green-500 font-medium">Price submitted successfully!</p>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Provider *</label>
                                        <Input
                                            placeholder="e.g., openai, anthropic, groq"
                                            value={priceSubmitForm.providerId}
                                            onChange={(e) => setPriceSubmitForm({ ...priceSubmitForm, providerId: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Model ID *</label>
                                        <Input
                                            placeholder="e.g., gpt-4o, claude-3.5-sonnet"
                                            value={priceSubmitForm.modelId}
                                            onChange={(e) => setPriceSubmitForm({ ...priceSubmitForm, modelId: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Tier (optional)</label>
                                        <Input
                                            placeholder="e.g., free, pro, enterprise"
                                            value={priceSubmitForm.tier}
                                            onChange={(e) => setPriceSubmitForm({ ...priceSubmitForm, tier: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">$/1M Input</label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                placeholder="0.00"
                                                value={priceSubmitForm.inputPerMUsd}
                                                onChange={(e) => setPriceSubmitForm({ ...priceSubmitForm, inputPerMUsd: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">$/1M Output</label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                placeholder="0.00"
                                                value={priceSubmitForm.outputPerMUsd}
                                                onChange={(e) => setPriceSubmitForm({ ...priceSubmitForm, outputPerMUsd: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={priceSubmitForm.isNewModel || false}
                                                onChange={(e) => setPriceSubmitForm({ ...priceSubmitForm, isNewModel: e.target.checked })}
                                                className="w-4 h-4"
                                            />
                                            <span className="text-sm">New model (first report)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={priceSubmitForm.isFree || false}
                                                onChange={(e) => setPriceSubmitForm({ ...priceSubmitForm, isFree: e.target.checked })}
                                                className="w-4 h-4"
                                            />
                                            <span className="text-sm">Free tier / preview</span>
                                        </label>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Notes (optional)</label>
                                        <Input
                                            placeholder="e.g., Source URL, rate limits, context window..."
                                            value={priceSubmitForm.notes}
                                            onChange={(e) => setPriceSubmitForm({ ...priceSubmitForm, notes: e.target.value })}
                                        />
                                    </div>
                                    <p className="text-xs text-text-muted">
                                        Submissions are reviewed by the community before being published. 
                                        Higher trust levels require fewer verifications.
                                    </p>
                                    <div className="flex gap-2 pt-2">
                                        <Button variant="secondary" className="flex-1" onClick={() => setShowPriceSubmit(false)}>
                                            Cancel
                                        </Button>
                                        <Button
                                            variant="primary"
                                            className="flex-1"
                                            onClick={submitCommunityPrice}
                                            disabled={priceSubmitLoading}
                                        >
                                            {priceSubmitLoading ? "Submitting..." : "Submit"}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </Card>
                </div>
            )}

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
                                <th className="px-6 py-4">Pricing ($/1M tokens)</th>
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
                                                        src={getProviderIconUrl(model.provider)}
                                                        alt={model.provider}
                                                        width={16}
                                                        height={16}
                                                        className="object-contain"
                                                        onError={(e) => { const t = e?.target; if (t) t.style.display = 'none'; }}
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
                                                <span className="text-text-muted">In: <span className="text-text font-medium">${Number(model.inputPrice || 0).toFixed(2)}</span>/1M</span>
                                                <span className="text-text-muted">Out: <span className="text-text font-medium">${Number(model.outputPrice || 0).toFixed(2)}</span>/1M</span>
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
                            <h2 className="text-lg font-semibold">Spot Price Comparison</h2>
                            <p className="text-sm text-text-muted">USD per 1M tokens (in/out). Cheapest provider per canonical model. Scenario: 1M input + 500k output.</p>
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
                                    <th className="px-6 py-4">Spot (1M in + 500k out)</th>
                                    <th className="px-6 py-4">Cheapest Provider</th>
                                    <th className="px-6 py-4">All Offers ($/1M in / $/1M out)</th>
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
                            <h2 className="text-lg font-semibold">Cost Comparison</h2>
                            <p className="text-sm text-text-muted">USD per 1M tokens. Scenario: 1M input + 500k output.</p>
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

            {activeView === "leaderboards" && (
                <div className="flex flex-col gap-6">
                    {leaderboardsLoading ? (
                        <Card padding="lg">
                            <div className="flex items-center justify-center py-12 text-text-muted">
                                <span className="material-symbols-outlined animate-spin-slow">sync</span>
                                <span className="ml-2">Loading leaderboards...</span>
                            </div>
                        </Card>
                    ) : (
                        <>
                            {/* Cost Leaders */}
                            <Card padding="none">
                                <div className="p-4 border-b border-border">
                                    <h2 className="text-lg font-semibold">Cost Leaders</h2>
                                    <p className="text-sm text-text-muted">Cheapest provider per model (scenario: 1M input + 500K output)</p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-border bg-sidebar/50 text-xs font-medium text-text-muted uppercase tracking-wider">
                                                <th className="px-6 py-3">Rank</th>
                                                <th className="px-6 py-3">Model</th>
                                                <th className="px-6 py-3">Provider</th>
                                                <th className="px-6 py-3">$/1M in</th>
                                                <th className="px-6 py-3">$/1M out</th>
                                                <th className="px-6 py-3">Scenario Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {leaderboards.costLeaders.length === 0 ? (
                                                <tr><td colSpan="6" className="px-6 py-10 text-center text-text-muted">No cost leaders available.</td></tr>
                                            ) : (
                                                leaderboards.costLeaders.map((row, idx) => (
                                                    <tr key={`${row.provider}-${row.providerModelId}`} className="hover:bg-sidebar/30 transition-colors">
                                                        <td className="px-6 py-3 font-bold text-brand">{idx + 1}</td>
                                                        <td className="px-6 py-3">
                                                            <span className="font-medium">{row.modelDisplayName}</span>
                                                            {row.tier && <Badge variant="secondary" size="sm" className="ml-2">{row.tier}</Badge>}
                                                        </td>
                                                        <td className="px-6 py-3 capitalize">{row.provider}</td>
                                                        <td className="px-6 py-3">${row.inputPerMUsd.toFixed(2)}</td>
                                                        <td className="px-6 py-3">${row.outputPerMUsd.toFixed(2)}</td>
                                                        <td className="px-6 py-3 font-semibold text-green-600">${row.scenarioCostUsd.toFixed(2)}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>

                            {/* Free Models */}
                            <Card padding="none">
                                <div className="p-4 border-b border-border">
                                    <h2 className="text-lg font-semibold">Free Models</h2>
                                    <p className="text-sm text-text-muted">Currently available for free (may have rate limits)</p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-border bg-sidebar/50 text-xs font-medium text-text-muted uppercase tracking-wider">
                                                <th className="px-6 py-3">Model</th>
                                                <th className="px-6 py-3">Provider</th>
                                                <th className="px-6 py-3">Tier</th>
                                                <th className="px-6 py-3">Source</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {leaderboards.freeModels.length === 0 ? (
                                                <tr><td colSpan="4" className="px-6 py-10 text-center text-text-muted">No free models found.</td></tr>
                                            ) : (
                                                leaderboards.freeModels.map((row) => (
                                                    <tr key={`${row.provider}-${row.providerModelId}`} className="hover:bg-sidebar/30 transition-colors">
                                                        <td className="px-6 py-3 font-medium">{row.modelDisplayName}</td>
                                                        <td className="px-6 py-3 capitalize">{row.provider}</td>
                                                        <td className="px-6 py-3">
                                                            {row.tier ? <Badge variant="secondary" size="sm">{row.tier}</Badge> : "—"}
                                                        </td>
                                                        <td className="px-6 py-3">
                                                            <Badge variant={row.source === "oauth" ? "info" : "secondary"} size="sm">{row.source}</Badge>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>

                            {/* Community Favorites */}
                            {leaderboards.communityFavorites.length > 0 && (
                                <Card padding="none">
                                    <div className="p-4 border-b border-border">
                                        <h2 className="text-lg font-semibold">Community Tracked</h2>
                                        <p className="text-sm text-text-muted">Models with community price submissions</p>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-border bg-sidebar/50 text-xs font-medium text-text-muted uppercase tracking-wider">
                                                    <th className="px-6 py-3">Provider</th>
                                                    <th className="px-6 py-3">Model</th>
                                                    <th className="px-6 py-3">Submissions</th>
                                                    <th className="px-6 py-3">Latest Price</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {leaderboards.communityFavorites.map((row) => (
                                                    <tr key={`${row.providerId}-${row.modelId}`} className="hover:bg-sidebar/30 transition-colors">
                                                        <td className="px-6 py-3 capitalize">{row.providerId}</td>
                                                        <td className="px-6 py-3">{row.modelId}</td>
                                                        <td className="px-6 py-3">
                                                            <Badge variant="info" size="sm">{row.submissionCount}</Badge>
                                                        </td>
                                                        <td className="px-6 py-3">
                                                            {row.latestPrice ? (
                                                                <span className="text-sm">
                                                                    ${row.latestPrice.inputPerMUsd.toFixed(2)} in / ${row.latestPrice.outputPerMUsd.toFixed(2)} out
                                                                </span>
                                                            ) : "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </Card>
                            )}
                        </>
                    )}
                </div>
            )}

            {activeView === "compare" && (
                <Card padding="none">
                    <div className="p-4 border-b border-border flex flex-col md:flex-row md:items-center gap-3">
                        <div className="flex-1">
                            <h2 className="text-lg font-semibold">Provider Comparison Matrix</h2>
                            <p className="text-sm text-text-muted">Compare the same model across different providers</p>
                        </div>
                        <div className="w-full md:w-64">
                            <Input
                                placeholder="Search model (e.g., claude, gpt-4)..."
                                value={comparisonSearch}
                                onChange={(e) => setComparisonSearch(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && fetchComparisonMatrix()}
                            />
                        </div>
                        <Button variant="secondary" onClick={fetchComparisonMatrix}>
                            Search
                        </Button>
                    </div>
                    {comparisonLoading ? (
                        <div className="flex items-center justify-center py-12 text-text-muted">
                            <span className="material-symbols-outlined animate-spin-slow">sync</span>
                            <span className="ml-2">Loading comparison matrix...</span>
                        </div>
                    ) : comparisonMatrix.length === 0 ? (
                        <div className="px-6 py-10 text-center text-text-muted">
                            No models with multiple providers found. {comparisonSearch && "Try a different search term."}
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {comparisonMatrix.map((row) => (
                                <div key={row.canonicalModelId} className="p-4">
                                    <div className="flex items-center gap-3 mb-3">
                                        <span className="font-semibold">{row.modelDisplayName}</span>
                                        <Badge variant="secondary" size="sm">{row.providerCount} providers</Badge>
                                        <span className="text-sm text-text-muted ml-auto">
                                            Cheapest: <span className="text-green-500 font-medium">{row.cheapestProvider} (${row.cheapestCost?.toFixed(2)})</span>
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                            <thead>
                                                <tr className="text-text-muted text-xs uppercase">
                                                    <th className="py-1 pr-4">Provider</th>
                                                    <th className="py-1 pr-4">Type</th>
                                                    <th className="py-1 pr-4">Tier</th>
                                                    <th className="py-1 pr-4">$/1M in</th>
                                                    <th className="py-1 pr-4">$/1M out</th>
                                                    <th className="py-1 pr-4">Scenario</th>
                                                    <th className="py-1">vs Cheapest</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {row.providers.map((p) => (
                                                    <tr key={`${p.provider}-${p.providerModelId}`} className={p.isCheapest ? "bg-green-500/10" : ""}>
                                                        <td className="py-1 pr-4 capitalize">{p.provider}</td>
                                                        <td className="py-1 pr-4">
                                                            <Badge variant={p.providerType === "oauth" ? "info" : p.providerType === "local" ? "success" : "secondary"} size="sm">
                                                                {p.providerType}
                                                            </Badge>
                                                        </td>
                                                        <td className="py-1 pr-4">{p.tier || "—"}</td>
                                                        <td className="py-1 pr-4">{p.isFree ? "Free" : `$${p.inputPerMUsd.toFixed(2)}`}</td>
                                                        <td className="py-1 pr-4">{p.isFree ? "Free" : `$${p.outputPerMUsd.toFixed(2)}`}</td>
                                                        <td className="py-1 pr-4 font-medium">{p.isFree ? "Free" : `$${p.scenarioCostUsd.toFixed(2)}`}</td>
                                                        <td className="py-1">
                                                            {p.isCheapest ? (
                                                                <span className="text-green-500">★ Cheapest</span>
                                                            ) : p.deltaVsCheapest > 0 ? (
                                                                <span className="text-red-400">+${p.deltaVsCheapest.toFixed(2)}</span>
                                                            ) : "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {activeView === "contributors" && (
                <div className="space-y-6">
                    <Card padding="none">
                        <div className="p-4 border-b border-border flex flex-col md:flex-row md:items-center gap-3">
                            <div className="flex-1">
                                <h2 className="text-lg font-semibold">Zippy's TokenBuddy</h2>
                                <p className="text-sm text-text-muted">Community contributors tracking LLM pricing</p>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                <Button
                                    variant={contributorType === "total" ? "primary" : "secondary"}
                                    size="sm"
                                    onClick={() => setContributorType("total")}
                                >
                                    All-Time
                                </Button>
                                <Button
                                    variant={contributorType === "weekly" ? "primary" : "secondary"}
                                    size="sm"
                                    onClick={() => setContributorType("weekly")}
                                >
                                    Weekly
                                </Button>
                                <Button
                                    variant={contributorType === "verifications" ? "primary" : "secondary"}
                                    size="sm"
                                    onClick={() => setContributorType("verifications")}
                                >
                                    Verifications
                                </Button>
                                <Button
                                    variant={contributorType === "models" ? "primary" : "secondary"}
                                    size="sm"
                                    onClick={() => setContributorType("models")}
                                >
                                    New Models
                                </Button>
                                <Button
                                    variant={contributorType === "streak" ? "primary" : "secondary"}
                                    size="sm"
                                    onClick={() => setContributorType("streak")}
                                >
                                    Streaks
                                </Button>
                            </div>
                        </div>

                        {contributorsLoading ? (
                            <div className="flex items-center justify-center py-12 text-text-muted">
                                <span className="material-symbols-outlined animate-spin-slow">sync</span>
                                <span className="ml-2">Loading contributors...</span>
                            </div>
                        ) : contributors.length === 0 ? (
                            <div className="p-8 text-center">
                                <p className="text-text-muted mb-4">No contributors yet. Be the first!</p>
                                <Button variant="primary" onClick={() => setShowPriceSubmit(true)}>
                                    Submit Your First Price
                                </Button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-sidebar/50 text-text-muted text-xs uppercase tracking-wider">
                                        <tr>
                                            <th className="px-6 py-3">Rank</th>
                                            <th className="px-6 py-3">Contributor</th>
                                            <th className="px-6 py-3">Points</th>
                                            <th className="px-6 py-3">Submissions</th>
                                            <th className="px-6 py-3">Verified</th>
                                            <th className="px-6 py-3">Models</th>
                                            <th className="px-6 py-3">Streak</th>
                                            <th className="px-6 py-3">Badges</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {contributors.map((c) => (
                                            <tr key={c.id} className="hover:bg-sidebar/30 transition-colors">
                                                <td className="px-6 py-3">
                                                    <Badge
                                                        variant={c.rank === 1 ? "warning" : c.rank === 2 ? "secondary" : c.rank === 3 ? "info" : "secondary"}
                                                        size="sm"
                                                    >
                                                        #{c.rank}
                                                    </Badge>
                                                </td>
                                                <td className="px-6 py-3 font-medium">{c.displayName}</td>
                                                <td className="px-6 py-3">
                                                    <Badge variant="success" size="sm">{c.totalPoints.toLocaleString()}</Badge>
                                                </td>
                                                <td className="px-6 py-3">{c.contributions.priceSubmissions}</td>
                                                <td className="px-6 py-3">{c.contributions.priceVerifications}</td>
                                                <td className="px-6 py-3">{c.contributions.newModelsAdded}</td>
                                                <td className="px-6 py-3">
                                                    {c.currentStreak > 0 ? (
                                                        <span className="text-orange-400">{c.currentStreak} days</span>
                                                    ) : (
                                                        <span className="text-text-muted">—</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-3">
                                                    <div className="flex gap-1">
                                                        {c.badges.slice(0, 3).map((b) => (
                                                            <span key={b.id} title={b.name} className="text-base cursor-default">
                                                                {b.icon}
                                                            </span>
                                                        ))}
                                                        {c.badges.length > 3 && (
                                                            <span className="text-xs text-text-muted ml-1">+{c.badges.length - 3}</span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card>
                            <h3 className="text-lg font-semibold mb-4">How to Earn Points</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <span>Submit new pricing data</span>
                                    <Badge variant="success" size="sm">+5 pts</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span>Verify existing prices</span>
                                    <Badge variant="success" size="sm">+3 pts</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span>Report new model</span>
                                    <Badge variant="success" size="sm">+10 pts</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span>Report free model</span>
                                    <Badge variant="success" size="sm">+8 pts</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span>Update price changes</span>
                                    <Badge variant="success" size="sm">+4 pts</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span>Daily check-in</span>
                                    <Badge variant="success" size="sm">+1 pt</Badge>
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <h3 className="text-lg font-semibold mb-4">Badges to Earn</h3>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">🌱</span>
                                    <span>First Steps</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">✓</span>
                                    <span>Fact Checker</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">🔍</span>
                                    <span>Model Scout</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">🔥</span>
                                    <span>Week Warrior</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">💎</span>
                                    <span>Monthly Champion</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">🏆</span>
                                    <span>Top Contributor</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">🆓</span>
                                    <span>Free Finder</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">⭐</span>
                                    <span>Price Pioneer</span>
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>
            )}

            {activeView === "review" && (
                <div className="grid lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-4">
                        <Card padding="none">
                            <div className="p-4 border-b border-border">
                                <h2 className="text-lg font-semibold">Pending Submissions</h2>
                                <p className="text-sm text-text-muted">Help verify community-submitted pricing data</p>
                            </div>

                            {pendingLoading ? (
                                <div className="flex items-center justify-center py-12 text-text-muted">
                                    <span className="material-symbols-outlined animate-spin-slow">sync</span>
                                    <span className="ml-2">Loading submissions...</span>
                                </div>
                            ) : pendingSubmissions.length === 0 ? (
                                <div className="p-8 text-center">
                                    <p className="text-text-muted mb-4">No pending submissions to review.</p>
                                    <p className="text-sm text-text-muted">Check back later or submit your own pricing data!</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-border">
                                    {pendingSubmissions.map((sub) => (
                                        <div key={sub.id} className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold capitalize">{sub.providerId}</span>
                                                        <span className="text-text-muted">/</span>
                                                        <span>{sub.modelId}</span>
                                                        {sub.isNewModel && <Badge variant="success" size="sm">New Model</Badge>}
                                                        {sub.isFree && <Badge variant="info" size="sm">Free</Badge>}
                                                    </div>
                                                    <div className="text-sm text-text-muted mt-1">
                                                        Submitted by {sub.submittedBy} • {new Date(sub.submittedAt).toLocaleDateString()}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-sm">
                                                        <span className="font-medium">${sub.inputPerMUsd?.toFixed(2)}</span>
                                                        <span className="text-text-muted"> in / </span>
                                                        <span className="font-medium">${sub.outputPerMUsd?.toFixed(2)}</span>
                                                        <span className="text-text-muted"> out</span>
                                                    </div>
                                                    {sub.tier && <div className="text-xs text-text-muted">Tier: {sub.tier}</div>}
                                                </div>
                                            </div>

                                            {sub.notes && (
                                                <p className="text-sm text-text-muted mb-3 bg-sidebar/30 p-2 rounded">{sub.notes}</p>
                                            )}

                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-4 text-sm">
                                                    <span className="text-green-400">▲ {sub.upvotes?.length || 0}</span>
                                                    <span className="text-red-400">▼ {sub.downvotes?.length || 0}</span>
                                                    <span className="text-text-muted">
                                                        Needs {sub.votesRequired - (sub.upvotes?.length || 0)} more to verify
                                                    </span>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => handleVote(sub.id, "up")}
                                                    >
                                                        ✓ Verify
                                                    </Button>
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => setVotingSubmission(sub)}
                                                    >
                                                        ✗ Reject
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="space-y-4">
                        <Card>
                            <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
                            {activityFeed.length === 0 ? (
                                <p className="text-text-muted text-sm">No recent activity</p>
                            ) : (
                                <div className="space-y-3">
                                    {activityFeed.map((item, i) => (
                                        <div key={i} className="text-sm">
                                            <div className="flex items-center gap-2">
                                                <Badge
                                                    variant={item.type === "verified" ? "success" : "warning"}
                                                    size="sm"
                                                >
                                                    {item.type}
                                                </Badge>
                                                <span className="font-medium capitalize">{item.submission?.providerId}</span>
                                            </div>
                                            <div className="text-text-muted">
                                                {item.submission?.modelId} • {new Date(item.timestamp).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>

                        <Card>
                            <h3 className="text-lg font-semibold mb-4">Trust Levels</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between items-center">
                                    <span>New (0 pts)</span>
                                    <span className="text-text-muted">Can submit, cannot vote</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span>Member (50+ pts)</span>
                                    <span className="text-text-muted">Can vote, 3 votes to verify</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span>Trusted (500+ pts)</span>
                                    <span className="text-text-muted">2 votes to verify</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-purple-400">Verified (2000+ pts)</span>
                                    <span className="text-text-muted">Auto-verify submissions</span>
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <h3 className="text-lg font-semibold mb-4">Guidelines</h3>
                            <ul className="text-sm text-text-muted space-y-2">
                                <li>• Verify pricing data you know to be accurate</li>
                                <li>• Reject submissions with incorrect information</li>
                                <li>• Provide reasons when rejecting</li>
                                <li>• Repeated bad submissions result in timeout</li>
                                <li>• Earn points for accurate votes!</li>
                            </ul>
                        </Card>
                    </div>

                    {votingSubmission && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                            <div className="bg-background border border-border rounded-lg p-6 max-w-md w-full mx-4">
                                <h3 className="text-lg font-semibold mb-4">Reject Submission</h3>
                                <p className="text-sm text-text-muted mb-4">
                                    Rejecting: {votingSubmission.providerId} / {votingSubmission.modelId}
                                </p>
                                <div className="mb-4">
                                    <label className="block text-sm font-medium mb-2">Reason (optional but helpful)</label>
                                    <Input
                                        placeholder="e.g., Incorrect pricing, outdated info..."
                                        value={voteReason}
                                        onChange={(e) => setVoteReason(e.target.value)}
                                    />
                                </div>
                                <div className="flex gap-3 justify-end">
                                    <Button variant="secondary" onClick={() => { setVotingSubmission(null); setVoteReason(""); }}>
                                        Cancel
                                    </Button>
                                    <Button variant="primary" onClick={() => handleVote(votingSubmission.id, "down")}>
                                        Confirm Rejection
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeView === "community" && (
                <Card>
                    <div className="p-4">
                        <CommunityPlaybooksSection />
                    </div>
                </Card>
            )}
        </div>
    );
}
