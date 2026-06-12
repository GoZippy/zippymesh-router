/**
 * connectionKeepAlive.js
 *
 * Periodically tests provider connections that have not been checked recently
 * and auto-marks them active/error based on test results.
 *
 * This addresses the "failed or pending" requests problem — connections that
 * have never been tested or haven't been retested after a cooldown are
 * automatically tested on a background schedule so the routing table stays
 * healthy without requiring manual intervention.
 *
 * Schedule:
 *   - Runs every KEEP_ALIVE_INTERVAL_MS (default: 5 minutes)
 *   - Tests connections whose testStatus is "unknown" or haven't been tested
 *     in STALE_AFTER_MS (default: 30 minutes)
 *   - For errored connections, uses RETRY_INTERVAL_MS (default: 10 minutes)
 *   - Respects rate-limit cooldowns — skips connections that are rate-limited
 */

import { getLocalDb } from "@/lib/localDb.js";

const KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000;       // 5 min polling loop
const STALE_AFTER_MS = 30 * 60 * 1000;              // 30 min since last test → re-test
const ERROR_RETRY_INTERVAL_MS = 10 * 60 * 1000;     // re-test errored connections every 10 min

let _intervalHandle = null;
let _isRunning = false;

/**
 * Get the base URL of this ZMLR instance for internal API calls.
 * Uses the Next.js env or falls back to localhost.
 */
function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:20128";
}

/**
 * Test a single connection by calling the internal API.
 * @param {string} connectionId
 * @returns {Promise<{success: boolean, latencyMs?: number, error?: string}>}
 */
async function testConnection(connectionId) {
  const start = Date.now();
  const baseUrl = getBaseUrl();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout

    const res = await fetch(`${baseUrl}/api/providers/${connectionId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    return { success: res.ok, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout = err?.name === "AbortError";
    return {
      success: false,
      latencyMs,
      error: isTimeout ? "Connection timed out after 12s" : (err?.message ?? "Network error"),
    };
  }
}

/**
 * Determine which connections need to be health-checked right now.
 * Returns array of connection IDs sorted by priority (unknown first, then stale).
 */
function getConnectionsToCheck() {
  let db;
  try {
    db = getLocalDb();
  } catch {
    return [];
  }
  if (!db) return [];

  const now = Date.now();
  const staleThreshold = new Date(now - STALE_AFTER_MS).toISOString();
  const errorRetryThreshold = new Date(now - ERROR_RETRY_INTERVAL_MS).toISOString();

  try {
    const rows = db.prepare(`
      SELECT id, testStatus, lastTested, rateLimitedUntil, provider, isEnabled
      FROM provider_connections
      WHERE isEnabled IS NOT 0
        AND (
          testStatus IS NULL
          OR testStatus = 'unknown'
          OR (testStatus = 'active' AND (lastTested IS NULL OR lastTested < ?))
          OR (testStatus = 'error' AND (lastTested IS NULL OR lastTested < ?))
        )
        AND (rateLimitedUntil IS NULL OR rateLimitedUntil < ?)
      ORDER BY
        CASE testStatus
          WHEN 'unknown' THEN 0
          WHEN NULL      THEN 0
          WHEN 'error'   THEN 1
          ELSE 2
        END,
        lastTested ASC
      LIMIT 10
    `).all(staleThreshold, errorRetryThreshold, new Date(now).toISOString());

    return rows.map(r => ({ id: r.id, provider: r.provider, status: r.testStatus }));
  } catch (err) {
    console.warn("[KeepAlive] Failed to query connections:", err?.message);
    return [];
  }
}

/**
 * Run one keep-alive cycle: find stale/unknown connections, test them.
 */
async function runKeepAliveCycle() {
  if (_isRunning) return; // Prevent overlapping runs
  _isRunning = true;

  const toCheck = getConnectionsToCheck();
  if (toCheck.length === 0) {
    _isRunning = false;
    return;
  }

  console.log(`[KeepAlive] Testing ${toCheck.length} connection(s): ${toCheck.map(c => `${c.provider}(${c.id?.slice(0, 8)})`).join(", ")}`);

  const results = [];
  for (const conn of toCheck) {
    try {
      const result = await testConnection(conn.id);
      results.push({ ...conn, ...result });

      if (!result.success) {
        console.warn(
          `[KeepAlive] ❌ ${conn.provider} (${conn.id?.slice(0, 8)}) failed` +
          (result.error ? `: ${result.error}` : "") +
          (result.latencyMs ? ` [${result.latencyMs}ms]` : "")
        );
      } else {
        console.log(
          `[KeepAlive] ✓ ${conn.provider} (${conn.id?.slice(0, 8)}) active [${result.latencyMs}ms]`
        );
      }
    } catch (err) {
      console.warn("[KeepAlive] Unexpected error testing connection:", conn.id, err?.message);
    }

    // Small delay between tests to avoid hammering providers simultaneously
    await new Promise(r => setTimeout(r, 500));
  }

  _isRunning = false;

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  if (results.length > 0) {
    console.log(`[KeepAlive] Cycle complete: ${successCount} active, ${failCount} failed`);
  }
}

/**
 * Start the keep-alive scheduler.
 * Safe to call multiple times — will not create duplicate intervals.
 */
export function startConnectionKeepAlive() {
  if (_intervalHandle) return; // Already running

  console.log(
    `[KeepAlive] Starting connection health scheduler ` +
    `(interval: ${KEEP_ALIVE_INTERVAL_MS / 60000}min, ` +
    `stale threshold: ${STALE_AFTER_MS / 60000}min)`
  );

  // Initial run after 30 seconds to let the server fully start
  const initialTimeout = setTimeout(() => {
    runKeepAliveCycle().catch(err =>
      console.warn("[KeepAlive] Initial cycle error:", err?.message)
    );
  }, 30_000);

  // Keep a reference so we can clear if needed
  if (typeof initialTimeout?.unref === "function") initialTimeout.unref();

  _intervalHandle = setInterval(() => {
    runKeepAliveCycle().catch(err =>
      console.warn("[KeepAlive] Cycle error:", err?.message)
    );
  }, KEEP_ALIVE_INTERVAL_MS);

  // Allow Node.js to exit even if this interval is still pending
  if (typeof _intervalHandle?.unref === "function") _intervalHandle.unref();
}

/**
 * Stop the keep-alive scheduler.
 */
export function stopConnectionKeepAlive() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    console.log("[KeepAlive] Scheduler stopped.");
  }
}

/**
 * Force an immediate keep-alive cycle (e.g. after adding a new connection).
 */
export function triggerKeepAliveCycle() {
  runKeepAliveCycle().catch(err =>
    console.warn("[KeepAlive] Manual trigger error:", err?.message)
  );
}
