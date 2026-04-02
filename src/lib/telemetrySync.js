/**
 * Telemetry Sync System
 * 
 * Collects anonymized usage data and syncs to ZippyMesh.com
 * when the user has opted-in via their account permissions.
 */

import { getDb } from "./localDb.js";

const ZIPPYMESH_URL = process.env.NEXT_PUBLIC_ZIPPYMESH_URL || "https://zippymesh.com";
const SYNC_INTERVAL = 60 * 1000; // 1 minute
const HEARTBEAT_INTERVAL = 30 * 1000; // 30 seconds

let syncInterval = null;
let heartbeatInterval = null;

/**
 * Initialize telemetry sync
 * Called on app startup
 */
export async function initTelemetrySync() {
  const db = await getDb();
  const connection = db.data.zippymeshConnection;

  if (!connection?.connectionToken) {
    console.log("[Telemetry] Not connected to ZippyMesh.com");
    return;
  }

  // Start heartbeat
  startHeartbeat();

  // Start telemetry sync if enabled
  if (connection.permissions?.telemetry) {
    startTelemetrySync();
  }

  console.log("[Telemetry] Sync initialized");
}

/**
 * Start heartbeat to maintain online status
 */
function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  // Initial heartbeat
  sendHeartbeat();

  // Regular heartbeat
  heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

/**
 * Send heartbeat to ZippyMesh.com
 */
async function sendHeartbeat() {
  try {
    const db = await getDb();
    const connection = db.data.zippymeshConnection;

    if (!connection?.connectionToken) return;

    const response = await fetch(`${ZIPPYMESH_URL}/api/connect/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionToken: connection.connectionToken,
        version: process.env.NEXT_PUBLIC_VERSION || "1.0.0",
        stats: connection.permissions?.telemetry ? await getQuickStats() : null,
      }),
    });

    if (!response.ok) {
      console.warn("[Telemetry] Heartbeat failed:", response.status);
      return;
    }

    const data = await response.json();

    // Process any pending commands
    if (data.pendingCommands?.length > 0) {
      for (const cmd of data.pendingCommands) {
        await processRemoteCommand(cmd);
      }
    }
  } catch (error) {
    console.warn("[Telemetry] Heartbeat error:", error.message);
  }
}

/**
 * Start telemetry data sync
 */
function startTelemetrySync() {
  if (syncInterval) clearInterval(syncInterval);

  // Initial sync
  syncTelemetry();

  // Regular sync
  syncInterval = setInterval(syncTelemetry, SYNC_INTERVAL);
}

/**
 * Stop telemetry sync
 */
export function stopTelemetrySync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  console.log("[Telemetry] Sync stopped");
}

/**
 * Sync telemetry data to ZippyMesh.com
 */
async function syncTelemetry() {
  try {
    const db = await getDb();
    const connection = db.data.zippymeshConnection;

    if (!connection?.connectionToken || !connection.permissions?.telemetry) {
      return;
    }

    const telemetryData = await collectTelemetry();

    const response = await fetch(`${ZIPPYMESH_URL}/api/telemetry/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionToken: connection.connectionToken,
        data: telemetryData,
      }),
    });

    if (response.ok) {
      // Update last sync time
      connection.lastSync = new Date().toISOString();
      await db.write();
    }
  } catch (error) {
    console.warn("[Telemetry] Sync error:", error.message);
  }
}

/**
 * Collect telemetry data from local database
 */
async function collectTelemetry() {
  const db = await getDb();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Get today's usage
  const usageHistory = db.data.usageHistory || [];
  const todayUsage = usageHistory.filter(
    (u) => new Date(u.timestamp) >= todayStart
  );

  // Aggregate by model
  const modelUsage = {};
  const providerUsage = {};
  let totalTokens = 0;
  let totalCost = 0;
  let requestCount = 0;

  for (const entry of todayUsage) {
    const modelId = entry.model || "unknown";
    const providerId = entry.provider || "unknown";

    modelUsage[modelId] = (modelUsage[modelId] || 0) + 1;
    providerUsage[providerId] = (providerUsage[providerId] || 0) + 1;

    totalTokens += (entry.inputTokens || 0) + (entry.outputTokens || 0);
    totalCost += entry.estimatedCost || 0;
    requestCount++;
  }

  return {
    timestamp: now.toISOString(),
    period: "today",
    requests: requestCount,
    tokens: totalTokens,
    estimatedCost: Math.round(totalCost * 10000) / 10000,
    modelUsage,
    providerUsage,
    activePlaybook: db.data.activePlaybook || null,
  };
}

/**
 * Get quick stats for heartbeat
 */
async function getQuickStats() {
  const db = await getDb();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const usageHistory = db.data.usageHistory || [];
  const todayUsage = usageHistory.filter(
    (u) => new Date(u.timestamp) >= todayStart
  );

  return {
    requestsToday: todayUsage.length,
    lastRequestAt: todayUsage.length > 0 
      ? todayUsage[todayUsage.length - 1].timestamp 
      : null,
  };
}

/**
 * Process a remote command from ZippyMesh.com
 */
async function processRemoteCommand(command) {
  const db = await getDb();
  const connection = db.data.zippymeshConnection;

  // Check if remote commands are enabled
  if (!connection?.permissions?.remoteCommands) {
    console.log("[Telemetry] Remote commands disabled, ignoring:", command.action);
    return;
  }

  console.log("[Telemetry] Processing command:", command.action);

  try {
    let result = { success: false };

    switch (command.action) {
      case "switch-playbook":
        if (command.payload?.playbookId) {
          db.data.activePlaybook = command.payload.playbookId;
          await db.write();
          result = { success: true, activePlaybook: command.payload.playbookId };
        }
        break;

      case "get-status":
        result = {
          success: true,
          status: {
            version: process.env.NEXT_PUBLIC_VERSION || "1.0.0",
            activePlaybook: db.data.activePlaybook,
            providers: Object.keys(db.data.providers || {}).length,
            uptime: process.uptime?.() || 0,
          },
        };
        break;

      case "clear-cache":
        // Clear any cached data
        db.data.cache = {};
        await db.write();
        result = { success: true };
        break;

      default:
        console.warn("[Telemetry] Unknown command:", command.action);
        result = { success: false, error: "Unknown command" };
    }

    // Report command result back to ZippyMesh.com
    await fetch(`${ZIPPYMESH_URL}/api/commands/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionToken: connection.connectionToken,
        commandId: command.id,
        result,
      }),
    });
  } catch (error) {
    console.error("[Telemetry] Command error:", error);
  }
}

/**
 * Get aggregated data for community sharing
 */
export async function getAggregatedData() {
  const db = await getDb();
  const connection = db.data.zippymeshConnection;

  if (!connection?.permissions?.shareAggregated) {
    return null;
  }

  const telemetry = await collectTelemetry();

  // Return only anonymized aggregate data
  return {
    modelUsage: telemetry.modelUsage,
    providerUsage: telemetry.providerUsage,
    // No costs, no specific counts that could identify usage patterns
  };
}
