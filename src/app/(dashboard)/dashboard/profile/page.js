"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Badge, Toggle, Input } from "@/shared/components";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { formatRequestError, safeFetchJson } from "@/shared/utils";

export default function ProfilePage() {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);

  // API Key Management State
  const [apiKeys, setApiKeys] = useState([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);
  const [keyStatus, setKeyStatus] = useState({ type: "", message: "" });

  // Webhooks State
  const [webhooks, setWebhooks] = useState([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvents, setNewWebhookEvents] = useState({ request_complete: true, routing_error: false, cache_hit: false });
  const [addingWebhook, setAddingWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState({ type: "", message: "" });
  const [testingId, setTestingId] = useState(null);
  const [deliveryHistory, setDeliveryHistory] = useState([]);

  // Routing Intelligence State
  const [intelligence, setIntelligence] = useState(null);
  const [totalSamples, setTotalSamples] = useState(0);
  const [resettingMemory, setResettingMemory] = useState(false);
  const [memoryResetStatus, setMemoryResetStatus] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await safeFetchJson("/api/settings", { credentials: "include" });
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) {
          const data = res.data || {};
          console.error("Failed to fetch settings:", formatRequestError("Failed to load settings", res, data.error || "Request failed"));
          return;
        }
        const data = res.data;
        setSettings(data);
        if (data?.requireApiKey !== undefined) setRequireApiKey(data.requireApiKey);
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      } finally {
        setLoading(false);
      }
    })();

    fetchApiKeys();
    fetchWebhooks();
    fetchIntelligence();
  }, [router]);

  const fetchApiKeys = async () => {
    setKeysLoading(true);
    try {
      const res = await safeFetchJson("/api/keys");
      if (res.ok && Array.isArray(res.data?.keys)) {
        setApiKeys(res.data.keys);
      }
    } catch (err) {
      console.error("Failed to fetch API keys:", err);
    } finally {
      setKeysLoading(false);
    }
  };

  const fetchWebhooks = useCallback(async () => {
    setWebhooksLoading(true);
    try {
      const res = await safeFetchJson("/api/settings/webhooks");
      if (res.ok) {
        setWebhooks(res.data?.webhooks || []);
        setDeliveryHistory(res.data?.deliveryHistory || []);
      }
    } catch {}
    finally { setWebhooksLoading(false); }
  }, []);

  const fetchIntelligence = useCallback(async () => {
    try {
      const res = await safeFetchJson("/api/routing/intelligence");
      if (res.ok) {
        setIntelligence(res.data?.summary || null);
        setTotalSamples(res.data?.totalSamples || 0);
      }
    } catch {}
  }, []);

  const addWebhook = async () => {
    const evts = Object.entries(newWebhookEvents).filter(([, v]) => v).map(([k]) => k);
    if (!newWebhookUrl.trim() || evts.length === 0) {
      setWebhookStatus({ type: "error", message: "URL and at least one event are required" });
      return;
    }
    setAddingWebhook(true);
    setWebhookStatus({ type: "", message: "" });
    try {
      const res = await safeFetchJson("/api/settings/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newWebhookUrl.trim(), events: evts }),
      });
      if (res.ok) {
        setNewWebhookUrl("");
        setNewWebhookEvents({ request_complete: true, routing_error: false, cache_hit: false });
        setWebhookStatus({ type: "success", message: "Webhook added" });
        fetchWebhooks();
      } else {
        setWebhookStatus({ type: "error", message: res.data?.error || "Failed to add" });
      }
    } catch { setWebhookStatus({ type: "error", message: "An error occurred" }); }
    finally { setAddingWebhook(false); }
  };

  const deleteWebhook = async (id) => {
    if (!confirm("Remove this webhook?")) return;
    try {
      const res = await safeFetchJson(`/api/settings/webhooks?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchWebhooks();
    } catch {}
  };

  const testWebhookById = async (id) => {
    setTestingId(id);
    try {
      const res = await safeFetchJson(`/api/settings/webhooks?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const ok = res.data?.ok;
      setWebhookStatus({ type: ok ? "success" : "error", message: ok ? `Test delivered (${res.data?.status})` : `Test failed: ${res.data?.error || "unknown error"}` });
      fetchWebhooks();
    } catch { setWebhookStatus({ type: "error", message: "Test request failed" }); }
    finally { setTestingId(null); }
  };

  const toggleWebhookEnabled = async (webhook) => {
    try {
      const res = await safeFetchJson(`/api/settings/webhooks?id=${webhook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !webhook.enabled }),
      });
      if (res.ok) fetchWebhooks();
    } catch {}
  };

  const resetRoutingMemory = async () => {
    if (!confirm("Clear all routing history? The router will relearn from scratch.")) return;
    setResettingMemory(true);
    setMemoryResetStatus("");
    try {
      const res = await safeFetchJson("/api/routing/intelligence", { method: "DELETE" });
      if (res.ok) {
        setMemoryResetStatus("Routing memory cleared.");
        setIntelligence(null);
        setTotalSamples(0);
      } else {
        setMemoryResetStatus("Failed to reset.");
      }
    } catch { setMemoryResetStatus("Error resetting memory."); }
    finally { setResettingMemory(false); }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) {
      setKeyStatus({ type: "error", message: "Name is required" });
      return;
    }
    
    setCreatingKey(true);
    setKeyStatus({ type: "", message: "" });
    setNewlyCreatedKey(null);
    
    try {
      const body = { name: newKeyName.trim() };
      if (newKeyExpiry) {
        body.expiresAt = new Date(newKeyExpiry).toISOString();
      }
      
      const res = await safeFetchJson("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      
      const data = res.data || {};
      
      if (res.ok) {
        setNewlyCreatedKey(data.key);
        setKeyStatus({ type: "success", message: "API key created. Copy it now - it won't be shown again!" });
        setNewKeyName("");
        setNewKeyExpiry("");
        fetchApiKeys();
      } else {
        setKeyStatus({ type: "error", message: data.error || "Failed to create key" });
      }
    } catch (err) {
      setKeyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeApiKey = async (id, name) => {
    if (!confirm(`Revoke API key "${name}"? This action cannot be undone.`)) return;
    
    try {
      const res = await safeFetchJson(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchApiKeys();
        setKeyStatus({ type: "success", message: "API key revoked" });
      } else {
        const data = res.data || {};
        setKeyStatus({ type: "error", message: data.error || "Failed to revoke key" });
      }
    } catch (err) {
      setKeyStatus({ type: "error", message: "An error occurred" });
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setKeyStatus({ type: "success", message: "Copied to clipboard" });
    } catch (err) {
      setKeyStatus({ type: "error", message: "Failed to copy" });
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "Passwords do not match" });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await safeFetchJson("/api/settings", {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      if (res.ok) {
        setPassStatus({ type: "success", message: "Password updated successfully" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        const data = res.data || {};
        setPassStatus({ type: "error", message: data.error || "Failed to update password" });
      }
    } catch (err) {
      setPassStatus({ type: "error", message: "An error occurred" });
    } finally {
      setPassLoading(false);
    }
  };

  const updateFallbackStrategy = async (strategy) => {
    try {
      const res = await safeFetchJson("/api/settings", {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallbackStrategy: strategy }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, fallbackStrategy: strategy }));
      }
    } catch (err) {
      console.error("Failed to update settings:", err);
    }
  };

  const updateSetting = async (key, value) => {
    try {
      const res = await safeFetchJson("/api/settings", {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, [key]: value }));
      }
    } catch (err) {
      console.error("Failed to update setting:", err);
    }
  };

  const updateStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await safeFetchJson("/api/settings", {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, stickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Failed to update sticky limit:", err);
    }
  };

  const updateRequireLogin = async (requireLogin) => {
    try {
      const res = await safeFetchJson("/api/settings", {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error("Failed to update require login:", err);
    }
  };

  const updateRequireApiKey = async (req) => {
    try {
      const res = await safeFetchJson("/api/settings", {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: req }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, requireApiKey: req }));
        setRequireApiKey(req);
      }
    } catch (err) {
      console.error("Failed to update requireApiKey:", err);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-col gap-6">
        {/* Local Mode Info */}
        <Card>
          <div className="flex items-center gap-4 mb-4">
            <div className="size-12 rounded-lg bg-green-500/10 text-green-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">computer</span>
            </div>
            <div>
              <h2 className="text-xl font-semibold">Local Mode</h2>
              <p className="text-text-muted">Running on your machine</p>
            </div>
          </div>
          <div className="pt-4 border-t border-border">
            <p className="text-sm text-text-muted">
              All data is stored locally in the <code className="bg-sidebar px-1 rounded">~/.zippymesh/db.json</code> file.
            </p>
          </div>
        </Card>

        {/* Security */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[20px]">shield</span>
            </div>
            <h3 className="text-lg font-semibold">Security</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Require login</p>
                <p className="text-sm text-text-muted">
                  When ON, dashboard requires password. When OFF, access without login.
                </p>
              </div>
              <Toggle
                checked={settings.requireLogin === true}
                onChange={() => updateRequireLogin(!settings.requireLogin)}
                disabled={loading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Require API key</p>
                <p className="text-sm text-text-muted">
                  When ON, external API endpoints (/v1/*) require a valid router API key.
                </p>
              </div>
              <Toggle
                checked={requireApiKey === true}
                onChange={() => updateRequireApiKey(!requireApiKey)}
                disabled={loading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Enforce device ID verification</p>
                <p className="text-sm text-text-muted">
                  When ON, only API keys created on this device are accepted. Get device ID from GET /api/setup/device-id.
                </p>
              </div>
              <Toggle
                checked={settings.enforceDeviceIdVerification === true}
                onChange={() => updateSetting("enforceDeviceIdVerification", !settings.enforceDeviceIdVerification)}
                disabled={loading}
              />
            </div>
            {settings.requireLogin === true && (
              <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 pt-4 border-t border-border/50">
                {settings.hasPassword && (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Current Password</label>
                    <Input
                      type="password"
                      placeholder="Enter current password"
                      value={passwords.current}
                      onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                      required
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">New Password</label>
                    <Input
                      type="password"
                      placeholder="Enter new password"
                      value={passwords.new}
                      onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Confirm New Password</label>
                    <Input
                      type="password"
                      placeholder="Confirm new password"
                      value={passwords.confirm}
                      onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {passStatus.message && (
                  <p className={`text-sm ${passStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
                    {passStatus.message}
                  </p>
                )}

                <div className="pt-2">
                  <Button type="submit" variant="primary" loading={passLoading}>
                    {settings.hasPassword ? "Update Password" : "Set Password"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Card>

        {/* API Keys Management */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500">
              <span className="material-symbols-outlined text-[20px]">key</span>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">Router API Keys</h3>
              <p className="text-sm text-text-muted">
                Manage API keys for external access to /v1/* endpoints
              </p>
            </div>
          </div>

          {/* Create New Key */}
          <div className="flex flex-col gap-3 pb-4 border-b border-border">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Input
                  type="text"
                  placeholder="Key name (e.g., Cursor, Claude Code)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
              </div>
              <div>
                <Input
                  type="date"
                  placeholder="Expiry (optional)"
                  value={newKeyExpiry}
                  onChange={(e) => setNewKeyExpiry(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={createApiKey}
                loading={creatingKey}
                disabled={!newKeyName.trim()}
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Create API Key
              </Button>
              {keyStatus.message && (
                <p className={`text-sm ${keyStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
                  {keyStatus.message}
                </p>
              )}
            </div>
          </div>

          {/* Newly Created Key Display */}
          {newlyCreatedKey && (
            <div className="mt-4 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-600 dark:text-green-400 mb-1">
                    New API Key Created - Copy it now!
                  </p>
                  <code className="block text-sm font-mono bg-black/10 dark:bg-white/10 px-2 py-1 rounded break-all">
                    {newlyCreatedKey}
                  </code>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => copyToClipboard(newlyCreatedKey)}
                >
                  <span className="material-symbols-outlined text-[18px]">content_copy</span>
                </Button>
              </div>
            </div>
          )}

          {/* Existing Keys List */}
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-muted">
                {apiKeys.filter(k => !k.revoked).length} active key{apiKeys.filter(k => !k.revoked).length !== 1 ? "s" : ""}
              </p>
              {keysLoading && (
                <span className="text-sm text-text-muted">Loading...</span>
              )}
            </div>

            {apiKeys.length === 0 && !keysLoading && (
              <p className="text-sm text-text-muted py-4 text-center">
                No API keys yet. Create one to allow external tools to access your router.
              </p>
            )}

            {apiKeys.map((key) => (
              <div
                key={key.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border",
                  key.revoked
                    ? "bg-red-500/5 border-red-500/20 opacity-60"
                    : "bg-bg border-border"
                )}
              >
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "material-symbols-outlined text-[20px]",
                    key.revoked ? "text-red-500" : "text-green-500"
                  )}>
                    {key.revoked ? "block" : "vpn_key"}
                  </span>
                  <div>
                    <p className="font-medium">{key.name || "Unnamed Key"}</p>
                    <p className="text-xs text-text-muted">
                      Created {new Date(key.createdAt).toLocaleDateString()}
                      {key.expiresAt && ` • Expires ${new Date(key.expiresAt).toLocaleDateString()}`}
                      {key.revoked && " • Revoked"}
                    </p>
                  </div>
                </div>
                {!key.revoked && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeApiKey(key.id, key.name)}
                    className="text-red-500 hover:bg-red-500/10"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </Button>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted italic pt-4 border-t border-border/50 mt-4">
            Use these keys as Bearer tokens: <code className="bg-sidebar px-1 rounded">Authorization: Bearer &lt;key&gt;</code>
          </p>
        </Card>

        {/* Monetization Settings */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-500">
              <span className="material-symbols-outlined text-[20px]">monetization_on</span>
            </div>
            <h3 className="text-lg font-semibold">Monetization</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Model Pricing</p>
                <p className="text-sm text-text-muted">
                  Price per 1,000 tokens (ZIP)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-muted">ZIP</span>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={settings.pricePer1k || 0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setSettings(prev => ({ ...prev, pricePer1k: val }));
                      void safeFetchJson("/api/settings", {
                        credentials: "include",
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ pricePer1k: val }),
                      }).catch((err) => {
                        console.error("Failed to update pricePer1k:", err);
                      });
                  }}
                  disabled={loading}
                  className="w-24 text-right"
                />
              </div>
            </div>
            <p className="text-xs text-text-muted italic pt-2 border-t border-border/50">
              This price will be advertised to the ZippyMesh network for all models you serve.
            </p>
          </div>
        </Card>

        {/* Routing Preferences */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <span className="material-symbols-outlined text-[20px]">route</span>
            </div>
            <h3 className="text-lg font-semibold">Routing Strategy</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Cross-provider failover</p>
                <p className="text-sm text-text-muted">
                  On 429, try equivalent models from other providers (e.g. gpt-4o-mini, gemini-flash)
                </p>
              </div>
              <Toggle
                checked={settings.enableCrossProviderFailover !== false}
                onChange={() => updateSetting("enableCrossProviderFailover", settings.enableCrossProviderFailover === false)}
                disabled={loading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Prefer local for simple tasks</p>
                <p className="text-sm text-text-muted">
                  Route generic tasks to Ollama/LM Studio when available
                </p>
              </div>
              <Toggle
                checked={settings.preferLocalForSimpleTasks !== false}
                onChange={() => updateSetting("preferLocalForSimpleTasks", settings.preferLocalForSimpleTasks === false)}
                disabled={loading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Free-tier last resort</p>
                <p className="text-sm text-text-muted">
                  When rate limited, also try free providers (Groq, Cerebras, etc.) at the end of the failover list
                </p>
              </div>
              <Toggle
                checked={settings.preferFreeOnRateLimit === true}
                onChange={() => updateSetting("preferFreeOnRateLimit", !settings.preferFreeOnRateLimit)}
                disabled={loading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Routing memory</p>
                <p className="text-sm text-text-muted">
                  Prefer models that worked recently for the same intent or client (optional bias)
                </p>
              </div>
              <Toggle
                checked={settings.enableRoutingMemory === true}
                onChange={() => updateSetting("enableRoutingMemory", !settings.enableRoutingMemory)}
                disabled={loading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Round Robin</p>
                <p className="text-sm text-text-muted">
                  Cycle through accounts to distribute load
                </p>
              </div>
              <Toggle
                checked={settings.fallbackStrategy === "round-robin"}
                onChange={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")}
                disabled={loading}
              />
            </div>

            {/* Sticky Round Robin Limit */}
            {settings.fallbackStrategy === "round-robin" && (
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <div>
                  <p className="font-medium">Sticky Limit</p>
                  <p className="text-sm text-text-muted">
                    Calls per account before switching
                  </p>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.stickyRoundRobinLimit || 3}
                  onChange={(e) => updateStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-20 text-center"
                />
              </div>
            )}

            <p className="text-xs text-text-muted italic pt-2 border-t border-border/50">
              {settings.fallbackStrategy === "round-robin"
                ? `Currently distributing requests across all available accounts with ${settings.stickyRoundRobinLimit || 3} calls per account.`
                : "Currently using accounts in priority order (Fill First)."}
            </p>
          </div>
        </Card>

        {/* ─── Webhooks (Task 3.5) ──────────────────────────────────── */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-violet-500/10 text-violet-500">
              <span className="material-symbols-outlined text-[20px]">webhook</span>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">Webhooks</h3>
              <p className="text-sm text-text-muted">Fire-and-forget event delivery to external URLs</p>
            </div>
            {webhooksLoading && <span className="text-xs text-text-muted">Loading...</span>}
          </div>

          {/* Add Form */}
          <div className="flex flex-col gap-3 pb-4 border-b border-border">
            <Input
              type="url"
              placeholder="https://your-server.com/webhook"
              value={newWebhookUrl}
              onChange={(e) => setNewWebhookUrl(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              {Object.entries(newWebhookEvents).map(([evt, checked]) => (
                <label key={evt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setNewWebhookEvents(prev => ({ ...prev, [evt]: !prev[evt] }))}
                    className="w-3.5 h-3.5 rounded"
                  />
                  <code className="text-xs">{evt}</code>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={addWebhook}
                loading={addingWebhook}
                disabled={!newWebhookUrl.trim()}
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add Webhook
              </Button>
              {webhookStatus.message && (
                <p className={`text-sm ${webhookStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
                  {webhookStatus.message}
                </p>
              )}
            </div>
          </div>

          {/* Webhook List */}
          <div className="mt-4 flex flex-col gap-2">
            {webhooks.length === 0 && !webhooksLoading && (
              <p className="text-sm text-text-muted py-4 text-center">No webhooks configured.</p>
            )}
            {webhooks.map(wh => (
              <div key={wh.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-bg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono truncate text-text-main">{wh.url}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(wh.events || []).map(e => (
                      <Badge key={e} variant="secondary" size="sm">{e}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Toggle
                    checked={wh.enabled !== false}
                    onChange={() => toggleWebhookEnabled(wh)}
                    size="sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testWebhookById(wh.id)}
                    loading={testingId === wh.id}
                  >
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteWebhook(wh.id)}
                    className="text-red-500 hover:bg-red-500/10"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Delivery History */}
          {deliveryHistory.length > 0 && (
            <details className="mt-4 border-t border-border pt-3">
              <summary className="text-sm text-text-muted cursor-pointer select-none">
                Recent deliveries ({deliveryHistory.length})
              </summary>
              <div className="mt-2 flex flex-col gap-1 max-h-48 overflow-y-auto">
                {deliveryHistory.map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-xs py-1 border-b border-border/50 last:border-0">
                    <span className={d.ok ? "text-green-500" : "text-red-500"}>
                      {d.ok ? "✓" : "✗"}
                    </span>
                    <code className="text-text-muted truncate flex-1">{d.url}</code>
                    <Badge variant={d.ok ? "success" : "danger"} size="sm">{d.event}</Badge>
                    <span className="text-text-muted whitespace-nowrap">{d.latencyMs}ms</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="text-xs text-text-muted italic pt-4 border-t border-border/50 mt-4">
            Webhooks are non-blocking. Payloads include event, timestamp, traceId, model, intent, and latencyMs.
          </p>
        </Card>

        {/* ─── Routing Intelligence (Task 3.6) ──────────────────────── */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <span className="material-symbols-outlined text-[20px]">psychology</span>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">Routing Intelligence</h3>
              <p className="text-sm text-text-muted">Local ML scoring learned from your request history</p>
            </div>
            <Badge variant="secondary">BETA</Badge>
          </div>

          <div className="flex flex-col gap-4">
            {totalSamples < 100 ? (
              <div className="p-4 rounded-lg bg-surface-secondary border border-border text-center">
                <p className="text-sm text-text-muted">
                  Routing intelligence activates after <strong>100 requests</strong>. Currently at <strong>{totalSamples}</strong>.
                </p>
                <div className="mt-3 bg-border rounded-full h-1.5 w-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, (totalSamples / 100) * 100)}%` }}
                  />
                </div>
              </div>
            ) : intelligence ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Top model per intent (learned from {totalSamples} requests)</p>
                {intelligence.topModels?.map(row => (
                  <div key={row.intent} className="flex items-center justify-between p-2.5 rounded-lg bg-bg border border-border">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{row.intent}</Badge>
                      <span className="text-sm font-mono text-text-main">{row.model?.split('/').pop()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted">{row.samples} samples</span>
                      <Badge variant={row.successRate >= 90 ? "success" : row.successRate >= 70 ? "warning" : "danger"}>
                        {row.successRate}%
                      </Badge>
                    </div>
                  </div>
                ))}
                {intelligence.penalties?.length > 0 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                    ⚠ {intelligence.penalties.length} model(s) receiving failure penalty in last 24h
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-text-muted">Analysis in progress…</p>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-border/50">
              <div>
                <p className="font-medium text-sm">Reset Routing Memory</p>
                <p className="text-xs text-text-muted">Clears all routing history. The router will relearn from scratch.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetRoutingMemory}
                loading={resettingMemory}
                className="text-red-500 hover:bg-red-500/10 flex-shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
                Reset
              </Button>
            </div>
            {memoryResetStatus && (
              <p className="text-sm text-text-muted text-center">{memoryResetStatus}</p>
            )}
          </div>
        </Card>

        {/* Theme Preferences */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <span className="material-symbols-outlined text-[20px]">palette</span>
            </div>
            <h3 className="text-lg font-semibold">Appearance</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Dark Mode</p>
                <p className="text-sm text-text-muted">
                  Switch between light and dark themes
                </p>
              </div>
              <Toggle
                checked={isDark}
                onChange={() => setTheme(isDark ? "light" : "dark")}
              />
            </div>

            {/* Theme Options */}
            <div className="pt-4 border-t border-border">
              <div className="inline-flex p-1 rounded-lg bg-black/5 dark:bg-white/5">
                {["light", "dark", "system"].map((option) => (
                  <button
                    key={option}
                    onClick={() => setTheme(option)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all",
                      theme === option
                        ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                        : "text-text-muted hover:text-text-main"
                    )}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {option === "light" ? "light_mode" : option === "dark" ? "dark_mode" : "contrast"}
                    </span>
                    <span className="capitalize">{option}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Data Management */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
              <span className="material-symbols-outlined text-[20px]">database</span>
            </div>
            <h3 className="text-lg font-semibold">Data</h3>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between p-4 rounded-lg bg-bg border border-border">
              <div>
                <p className="font-medium">Database Location</p>
                <p className="text-sm text-text-muted font-mono">~/.zippymesh/db.json</p>
              </div>
            </div>
          </div>
        </Card>

        {/* App Info */}
        <div className="text-center text-sm text-text-muted py-4">
          <p>{APP_CONFIG.name} v{APP_CONFIG.version}</p>
          <p className="mt-1">Local Mode - All data stored on your machine</p>
        </div>
      </div>
    </div>
  );
}
