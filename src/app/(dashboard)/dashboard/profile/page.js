"use client";

import { useState, useEffect } from "react";
import { Card, Button, Badge, Toggle, Input } from "@/shared/components";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";

export default function ProfilePage() {
  const { theme, setTheme, isDark } = useTheme();
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettings(data);
        if (data.requireApiKey !== undefined) setRequireApiKey(data.requireApiKey);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch settings:", err);
        setLoading(false);
      });
  }, []);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "Passwords do not match" });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setPassStatus({ type: "success", message: "Password updated successfully" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
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
      const res = await fetch("/api/settings", {
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
      const res = await fetch("/api/settings", {
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
      const res = await fetch("/api/settings", {
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
      const res = await fetch("/api/settings", {
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
      const res = await fetch("/api/settings", {
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
                    fetch("/api/settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ pricePer1k: val }),
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
