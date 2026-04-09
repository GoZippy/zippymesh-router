"use client";

import { useState, useEffect } from "react";
import { formatRequestError, safeFetchJson } from "@/shared/utils";

const ZIPPYMESH_URL = process.env.NEXT_PUBLIC_ZIPPYMESH_URL || "https://zippymesh.com";

export default function ZippyMeshAccountPage() {
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [permissions, setPermissions] = useState({
    telemetry: false,
    remoteCommands: false,
    autoSync: true,
    shareAggregated: false,
  });

  useEffect(() => {
    checkConnection();
  }, []);

  async function checkConnection() {
    try {
      const response = await safeFetchJson("/api/zippymesh/status");
      const data = response.data || {};
      setConnection(data.connected ? data : null);
    } catch (err) {
      console.error(formatRequestError("Failed to check connection", err));
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setError(null);

    try {
      // Generate device ID if not exists
      let deviceId = localStorage.getItem("zippymesh_device_id");
      if (!deviceId) {
        deviceId = `zmlr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem("zippymesh_device_id", deviceId);
      }

      // Open ZippyMesh.com connection flow in new window
      const returnUrl = encodeURIComponent(window.location.href);
      const connectUrl = `${ZIPPYMESH_URL}/dashboard/connect/oauth?` +
        `deviceId=${deviceId}&` +
        `type=zippymesh-llm-router&` +
        `version=${process.env.NEXT_PUBLIC_VERSION || "1.0.0"}&` +
        `returnUrl=${returnUrl}&` +
        `permissions=${encodeURIComponent(JSON.stringify(permissions))}`;

      // Open popup for OAuth
      const popup = window.open(connectUrl, "zippymesh_connect", "width=600,height=700");

      // Listen for message from popup
      const handleMessage = async (event) => {
        if (event.origin !== ZIPPYMESH_URL) return;

        if (event.data.type === "ZIPPYMESH_CONNECTED") {
          window.removeEventListener("message", handleMessage);
          popup?.close();

          // Store connection token
          const { connectionToken, connectionId, userId, displayName } = event.data;

          const response = await safeFetchJson("/api/zippymesh/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              connectionToken,
              connectionId,
              userId,
              displayName,
              permissions,
            }),
          });
          if (!response.ok) {
            throw new Error(formatRequestError("Failed to save connection", response, "Failed to save connection"));
          }

          await checkConnection();
          setConnecting(false);
        }
      };

      window.addEventListener("message", handleMessage);

      // Cleanup after timeout
      setTimeout(() => {
        window.removeEventListener("message", handleMessage);
        if (connecting) {
          setConnecting(false);
        }
      }, 300000); // 5 minute timeout
    } catch (err) {
      console.error("Connection error:", err);
      setError("Failed to connect. Please try again.");
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect from ZippyMesh.com?")) {
      return;
    }

    try {
      const response = await safeFetchJson("/api/zippymesh/disconnect", { method: "POST" });
      if (!response.ok) {
        throw new Error(formatRequestError("Failed to disconnect", response, "Failed to disconnect"));
      }
      setConnection(null);
    } catch (err) {
      console.error(formatRequestError("Failed to disconnect", err));
      setError("Failed to disconnect.");
    }
  }

  async function handleUpdatePermissions(newPermissions) {
    try {
      const response = await safeFetchJson("/api/zippymesh/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPermissions),
      });
      if (!response.ok) {
        throw new Error(formatRequestError("Failed to update permissions", response, "Failed to update permissions"));
      }
      setConnection((prev) => ({ ...prev, permissions: newPermissions }));
    } catch (err) {
      console.error(formatRequestError("Failed to update permissions", err));
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">ZippyMesh Account</h1>
        <p className="text-gray-400">
          Connect to your ZippyMesh.com account for centralized monitoring,
          TokenBuddy contributions, and cross-device sync.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {connection ? (
        <div className="space-y-6">
          {/* Connection Status */}
          <div className="bg-green-500/10 border border-green-500/50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 bg-green-500 rounded-full" />
              <span className="text-green-400 font-medium">Connected</span>
            </div>
            <div className="space-y-2 text-gray-300">
              <p>
                <span className="text-gray-500">Account:</span>{" "}
                {connection.displayName || connection.userId}
              </p>
              <p>
                <span className="text-gray-500">Connected:</span>{" "}
                {new Date(connection.connectedAt).toLocaleDateString()}
              </p>
              <p>
                <span className="text-gray-500">Last Sync:</span>{" "}
                {connection.lastSync
                  ? new Date(connection.lastSync).toLocaleString()
                  : "Never"}
              </p>
            </div>
          </div>

          {/* Permissions */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Permissions
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              Control what data is shared with your ZippyMesh.com dashboard.
            </p>
            <div className="space-y-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={connection.permissions?.telemetry || false}
                  onChange={(e) =>
                    handleUpdatePermissions({
                      ...connection.permissions,
                      telemetry: e.target.checked,
                    })
                  }
                  className="mt-1 w-4 h-4 rounded border-gray-600 bg-slate-700 text-purple-500 focus:ring-purple-500"
                />
                <div>
                  <div className="text-white font-medium">Usage Telemetry</div>
                  <div className="text-gray-400 text-sm">
                    Send usage statistics (request counts, model usage, costs)
                    to your dashboard
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={connection.permissions?.remoteCommands || false}
                  onChange={(e) =>
                    handleUpdatePermissions({
                      ...connection.permissions,
                      remoteCommands: e.target.checked,
                    })
                  }
                  className="mt-1 w-4 h-4 rounded border-gray-600 bg-slate-700 text-purple-500 focus:ring-purple-500"
                />
                <div>
                  <div className="text-white font-medium">Remote Commands</div>
                  <div className="text-gray-400 text-sm">
                    Allow switching playbooks and other commands from the web
                    dashboard
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={connection.permissions?.shareAggregated || false}
                  onChange={(e) =>
                    handleUpdatePermissions({
                      ...connection.permissions,
                      shareAggregated: e.target.checked,
                    })
                  }
                  className="mt-1 w-4 h-4 rounded border-gray-600 bg-slate-700 text-purple-500 focus:ring-purple-500"
                />
                <div>
                  <div className="text-white font-medium">
                    Community Statistics
                  </div>
                  <div className="text-gray-400 text-sm">
                    Contribute anonymized usage data to community leaderboards
                    (e.g., "most used models")
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Quick Links */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Quick Links
            </h2>
            <div className="flex flex-wrap gap-3">
              <a
                href={`${ZIPPYMESH_URL}/dashboard`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Open Web Dashboard →
              </a>
              <a
                href={`${ZIPPYMESH_URL}/tokenbuddy`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                TokenBuddy
              </a>
              <a
                href={`${ZIPPYMESH_URL}/dashboard/settings`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Account Settings
              </a>
            </div>
          </div>

          {/* Disconnect */}
          <div className="pt-6 border-t border-slate-700">
            <button
              onClick={handleDisconnect}
              className="text-red-400 hover:text-red-300 text-sm transition-colors"
            >
              Disconnect from ZippyMesh.com
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Connect Card */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
            <div className="text-5xl mb-4">🔗</div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Not Connected
            </h2>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              Connect your ZMLR to your ZippyMesh.com account to unlock web
              dashboard access, TokenBuddy contributions, and more.
            </p>

            {/* Permission Preview */}
            <div className="bg-slate-900/50 rounded-lg p-4 mb-6 text-left max-w-md mx-auto">
              <h3 className="text-sm font-medium text-white mb-3">
                Optional Permissions (configure after connecting):
              </h3>
              <div className="space-y-2 text-sm text-gray-400">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions.telemetry}
                    onChange={(e) =>
                      setPermissions((p) => ({
                        ...p,
                        telemetry: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-gray-600 bg-slate-700 text-purple-500"
                  />
                  Usage telemetry
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions.remoteCommands}
                    onChange={(e) =>
                      setPermissions((p) => ({
                        ...p,
                        remoteCommands: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-gray-600 bg-slate-700 text-purple-500"
                  />
                  Remote commands
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions.shareAggregated}
                    onChange={(e) =>
                      setPermissions((p) => ({
                        ...p,
                        shareAggregated: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-gray-600 bg-slate-700 text-purple-500"
                  />
                  Community statistics
                </label>
              </div>
            </div>

            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-8 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 text-white font-medium rounded-lg transition-colors"
            >
              {connecting ? "Connecting..." : "Connect to ZippyMesh.com"}
            </button>
          </div>

          {/* Benefits */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
              <div className="text-2xl mb-2">📊</div>
              <h3 className="font-medium text-white mb-1">Web Dashboard</h3>
              <p className="text-gray-400 text-sm">
                Monitor your router from any device via the web
              </p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
              <div className="text-2xl mb-2">⛽</div>
              <h3 className="font-medium text-white mb-1">TokenBuddy</h3>
              <p className="text-gray-400 text-sm">
                Earn points by contributing pricing data
              </p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
              <div className="text-2xl mb-2">🔄</div>
              <h3 className="font-medium text-white mb-1">Cross-Device Sync</h3>
              <p className="text-gray-400 text-sm">
                Sync settings across multiple ZMLR instances
              </p>
            </div>
          </div>

          {/* Privacy Note */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
            <h3 className="text-blue-400 font-medium mb-2">
              🔒 Your Data, Your Control
            </h3>
            <p className="text-gray-400 text-sm">
              Connection is optional. All telemetry and data sharing is opt-in.
              Your prompts and responses are never sent to ZippyMesh.com. You
              can disconnect at any time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
