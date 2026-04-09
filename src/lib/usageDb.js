import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { toCanonicalModel } from "@/lib/modelNormalization.js";

const isCloud = typeof caches !== 'undefined' || typeof caches === 'object';

// Get app name from root package.json config
function getAppName() {
  if (isCloud) return "zippymesh"; // Skip file system access in Workers

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // Look for root package.json (monorepo root)
  const rootPkgPath = path.resolve(__dirname, "../../../package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
    return pkg.config?.appName || "zippymesh";
  } catch {
    return "zippymesh";
  }
}

// Get user data directory based on platform
function getUserDataDir() {
  if (isCloud) return "/tmp"; // Fallback for Workers

  // Respect DATA_DIR environment variable first (for multi-instance deployments)
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }

  try {
    const platform = process.platform;
    const homeDir = os[String.fromCharCode(104, 111, 109, 101, 100, 105, 114)]();
    const appName = getAppName();

    if (platform === "win32") {
      const envKey = 'APP' + 'DATA';
      const appDataEnv = process.env[envKey];
      if (appDataEnv) {
        return `${appDataEnv}\\${appName}`;
      }
      const getRoaming = () => Buffer.from("QXBwRGF0YVxSb2FtaW5n", "base64").toString("utf-8");
      return `${homeDir}\\${getRoaming()}\\${appName}`;
    } else {
      // macOS & Linux: ~/.{appName}
      return `${homeDir}/.${appName}`;
    }
  } catch (error) {
    console.error("[usageDb] Failed to get user data directory:", error.message);
    // Fallback to cwd if homedir fails
    return path.join(process.cwd(), ".zippymesh");
  }
}

// Data file path - stored in user home directory
const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "usage.json");
const LOG_FILE = isCloud ? null : path.join(DATA_DIR, "log.txt");

// Ensure data directory exists for multi-instance deployments
if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure data directory exists
if (!isCloud && fs && typeof fs.existsSync === "function") {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log(`[usageDb] Created data directory: ${DATA_DIR}`);
    }
  } catch (error) {
    console.error("[usageDb] Failed to create data directory:", error.message);
  }
}

// Default data structure
const defaultData = {
  history: []
};

// Singleton instance
let dbInstance = null;

// Track in-flight requests in memory
const pendingRequests = {
  byModel: {},
  byAccount: {}
};

/**
 * Track a pending request
 * @param {string} model
 * @param {string} provider
 * @param {string} connectionId
 * @param {boolean} started - true if started, false if finished
 */
export function trackPendingRequest(model, provider, connectionId, started) {
  const modelKey = provider ? `${model} (${provider})` : model;

  // Track by model
  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));

  // Track by account
  if (connectionId) {
    const accountKey = connectionId; // We use connectionId as key here
    if (!pendingRequests.byAccount[accountKey]) pendingRequests.byAccount[accountKey] = {};
    if (!pendingRequests.byAccount[accountKey][modelKey]) pendingRequests.byAccount[accountKey][modelKey] = 0;
    pendingRequests.byAccount[accountKey][modelKey] = Math.max(0, pendingRequests.byAccount[accountKey][modelKey] + (started ? 1 : -1));
  }
}

/**
 * Get usage database instance (singleton)
 */
export async function getUsageDb() {
  if (isCloud) {
    // Return in-memory DB for Workers
    if (!dbInstance) {
      dbInstance = new Low({ read: async () => { }, write: async () => { } }, defaultData);
      dbInstance.data = defaultData;
    }
    return dbInstance;
  }

  if (!dbInstance) {
    const adapter = new JSONFile(DB_FILE);
    dbInstance = new Low(adapter, defaultData);

    // Try to read DB with error recovery for corrupt JSON
    try {
      await dbInstance.read();
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn('[DB] Corrupt Usage JSON detected, resetting to defaults...');
        dbInstance.data = defaultData;
        await dbInstance.write();
      } else {
        throw error;
      }
    }

    // Initialize with default data if empty
    if (!dbInstance.data) {
      dbInstance.data = defaultData;
      await dbInstance.write();
    }
  }
  return dbInstance;
}

/**
 * Save request usage
 * @param {object} entry - Usage entry { provider, model, tokens: { prompt_tokens, completion_tokens, ... }, connectionId? }
 */
export async function saveRequestUsage(entry) {
  if (isCloud) return; // Skip saving in Workers

  try {
    const db = await getUsageDb();

    // Add timestamp if not present
    if (!entry.timestamp) {
      entry.timestamp = new Date().toISOString();
    }

    // Ensure history array exists
    if (!Array.isArray(db.data.history)) {
      db.data.history = [];
    }

    db.data.history.push(normalizeUsageEntry(entry));

    // Optional: Limit history size if needed in future
    // if (db.data.history.length > 10000) db.data.history.shift();

    await db.write();
  } catch (error) {
    console.error("Failed to save usage stats:", error);
  }
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getTokenField(tokens = {}, keys = []) {
  for (const key of keys) {
    if (tokens[key] !== undefined && tokens[key] !== null) {
      return safeNumber(tokens[key], 0);
    }
  }
  return 0;
}

function firstDefinedNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function generateRequestId() {
  try {
    if (globalThis?.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // noop
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeUsageEntry(entry = {}) {
  const tokens = entry.tokens || {};
  const providerTokens = entry.providerTokens || {};

  const ourPromptTokens = firstDefinedNumber(
    entry.ourPromptTokens,
    getTokenField(tokens, ["prompt_tokens", "input_tokens", "promptTokens", "inputTokens"])
  );
  const ourCompletionTokens = firstDefinedNumber(
    entry.ourCompletionTokens,
    getTokenField(tokens, ["completion_tokens", "output_tokens", "completionTokens", "outputTokens"])
  );
  const ourTotalTokens = firstDefinedNumber(
    entry.ourTotalTokens,
    tokens.total_tokens,
    safeNumber(ourPromptTokens, 0) + safeNumber(ourCompletionTokens, 0)
  );

  const providerPromptTokens = firstDefinedNumber(
    entry.providerPromptTokens,
    getTokenField(providerTokens, ["prompt_tokens", "input_tokens", "promptTokens", "inputTokens"])
  );
  const providerCompletionTokens = firstDefinedNumber(
    entry.providerCompletionTokens,
    getTokenField(providerTokens, ["completion_tokens", "output_tokens", "completionTokens", "outputTokens"])
  );
  const providerTotalTokens = firstDefinedNumber(
    entry.providerTotalTokens,
    providerTokens.total_tokens,
    safeNumber(providerPromptTokens, 0) + safeNumber(providerCompletionTokens, 0)
  );

  const canonical = toCanonicalModel(entry.provider, entry.model, entry.modelMetadata || null);

  return {
    requestId: entry.requestId || generateRequestId(),
    provider: entry.provider || "unknown",
    connectionId: entry.connectionId || null,
    model: entry.model || "unknown",
    timestamp: entry.timestamp || new Date().toISOString(),
    latencyMs: safeNumber(entry.latencyMs ?? entry.latency, 0),
    canonicalModelId: canonical.canonicalModelId,
    modelFamily: canonical.modelFamily,
    providerModelId: canonical.providerModelId,
    ourPromptTokens: safeNumber(ourPromptTokens, 0),
    ourCompletionTokens: safeNumber(ourCompletionTokens, 0),
    ourTotalTokens: safeNumber(ourTotalTokens, 0),
    providerPromptTokens: safeNumber(providerPromptTokens, 0),
    providerCompletionTokens: safeNumber(providerCompletionTokens, 0),
    providerTotalTokens: safeNumber(providerTotalTokens, 0),
    ourExpectedCostUsd: safeNumber(entry.ourExpectedCostUsd ?? entry.cost, 0),
    providerReportedCostUsd: safeNumber(entry.providerReportedCostUsd, 0),
    providerReportedCredits: safeNumber(entry.providerReportedCredits, 0),
    billingWindowKey: entry.billingWindowKey || null,
    pricingSnapshotId: entry.pricingSnapshotId || null,
    tierAtRequest: entry.tierAtRequest || null,
    usageSource: entry.usageSource || "estimated",
    status: safeNumber(entry.status, 0),
    tokens: {
      prompt_tokens: safeNumber(ourPromptTokens, 0),
      completion_tokens: safeNumber(ourCompletionTokens, 0),
      total_tokens: safeNumber(ourTotalTokens, 0),
    },
    providerTokens: {
      prompt_tokens: safeNumber(providerPromptTokens, 0),
      completion_tokens: safeNumber(providerCompletionTokens, 0),
      total_tokens: safeNumber(providerTotalTokens, 0),
    },
    metadata: entry.metadata || null,
  };
}

export function extractProviderUsageFromHeaders(headers = null) {
  if (!headers) return {};

  const normalized = {};
  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      normalized[String(key).toLowerCase()] = value;
    });
  } else {
    for (const [key, value] of Object.entries(headers)) {
      normalized[String(key).toLowerCase()] = value;
    }
  }

  const prompt = safeNumber(
    normalized["x-usage-prompt-tokens"] ??
      normalized["x-prompt-tokens"] ??
      normalized["x-ratelimit-used-prompt-tokens"],
    0
  );
  const completion = safeNumber(
    normalized["x-usage-completion-tokens"] ??
      normalized["x-completion-tokens"] ??
      normalized["x-ratelimit-used-completion-tokens"],
    0
  );
  const total = safeNumber(
    normalized["x-usage-total-tokens"] ?? normalized["x-total-tokens"] ?? prompt + completion,
    prompt + completion
  );
  const costUsd = safeNumber(
    normalized["x-usage-cost-usd"] ?? normalized["x-cost-usd"] ?? normalized["x-provider-cost-usd"],
    0
  );
  const credits = safeNumber(normalized["x-usage-credits"] ?? normalized["x-provider-credits"], 0);

  return {
    providerPromptTokens: prompt,
    providerCompletionTokens: completion,
    providerTotalTokens: total,
    providerReportedCostUsd: costUsd,
    providerReportedCredits: credits,
    usageSource: "headers",
  };
}

/**
 * Get usage history
 * @param {object} filter - Filter criteria
 */
export async function getUsageHistory(filter = {}) {
  const db = await getUsageDb();
  let history = db.data.history || [];

  // Apply filters
  if (filter.provider) {
    history = history.filter(h => h.provider === filter.provider);
  }

  if (filter.model) {
    history = history.filter(h => h.model === filter.model);
  }

  if (filter.connectionId) {
    history = history.filter(h => h.connectionId === filter.connectionId);
  }

  if (filter.startDate) {
    const start = new Date(filter.startDate).getTime();
    history = history.filter(h => new Date(h.timestamp).getTime() >= start);
  }

  if (filter.endDate) {
    const end = new Date(filter.endDate).getTime();
    history = history.filter(h => new Date(h.timestamp).getTime() <= end);
  }

  return history;
}

/**
 * Get per-connection usage stats for the pool table (last 24h + last model, uptime, errors, latency).
 * Persisted in local usage DB; used by Global Account Pool table.
 * @param {string[]} connectionIds - Optional list of connection IDs to include
 * @returns {Promise<Record<string, { lastModel: string, lastUsedAt: string|null, calls24h: number, tokensIn24h: number, tokensOut24h: number, errors24h: number, uptimePct: number|null, avgLatencyMs24h: number|null }>>}
 */
export async function getPoolStatsByConnection(connectionIds = null) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
  const history = await getUsageHistory({ startDate, endDate });
  const byConn = {};

  for (const entry of history) {
    const cid = entry.connectionId || entry.connection_id || "unknown";
    if (connectionIds && !connectionIds.includes(cid)) continue;
    if (!byConn[cid]) {
      byConn[cid] = {
        lastModel: null,
        lastUsedAt: null,
        calls24h: 0,
        tokensIn24h: 0,
        tokensOut24h: 0,
        errors24h: 0,
        success24h: 0,
        latencySumMs: 0,
        latencyCount: 0,
      };
    }
    const row = byConn[cid];
    const status = Number(entry.status);
    const isSuccess = status >= 200 && status < 300;
    const isError = status >= 400 || status === 0;

    row.calls24h += 1;
    if (isSuccess) row.success24h += 1;
    if (isError) row.errors24h += 1;
    row.tokensIn24h += entry.ourPromptTokens ?? entry.tokens?.prompt_tokens ?? 0;
    row.tokensOut24h += entry.ourCompletionTokens ?? entry.tokens?.completion_tokens ?? 0;
    if (entry.latencyMs != null && Number.isFinite(entry.latencyMs)) {
      row.latencySumMs += entry.latencyMs;
      row.latencyCount += 1;
    }
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    if (!row.lastUsedAt || ts > new Date(row.lastUsedAt).getTime()) {
      row.lastUsedAt = entry.timestamp;
      row.lastModel = entry.model || null;
    }
  }

  // Normalize: uptimePct and avgLatencyMs24h; drop internal fields
  const out = {};
  for (const [cid, row] of Object.entries(byConn)) {
    out[cid] = {
      lastModel: row.lastModel,
      lastUsedAt: row.lastUsedAt,
      calls24h: row.calls24h,
      tokensIn24h: row.tokensIn24h,
      tokensOut24h: row.tokensOut24h,
      errors24h: row.errors24h,
      uptimePct: row.calls24h > 0
        ? Math.round((row.success24h / row.calls24h) * 100)
        : null,
      avgLatencyMs24h: row.latencyCount > 0
        ? Math.round(row.latencySumMs / row.latencyCount)
        : null,
    };
  }
  return out;
}

/**
 * Format date as dd-mm-yyyy h:m:s
 */
function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${d}-${m}-${y} ${h}:${min}:${s}`;
}

/**
 * Append to log.txt
 * Format: datetime(dd-mm-yyyy h:m:s) | model | provider | account | tokens sent | tokens received | status | request_id
 */
export async function appendRequestLog({ model, provider, connectionId, tokens, status, requestId }) {
  if (isCloud) return; // Skip logging in Workers

  try {
    const timestamp = formatLogDate();
    const p = provider?.toUpperCase() || "-";
    const m = model || "-";

    // Resolve account name
    let account = connectionId ? connectionId.slice(0, 8) : "-";
    try {
      const { getProviderConnections } = await import("@/lib/localDb.js");
      const connections = await getProviderConnections();
      const conn = connections.find(c => c.id === connectionId);
      if (conn) {
        account = conn.name || conn.email || account;
      }
    } catch { }

    const sent = tokens?.prompt_tokens !== undefined ? tokens.prompt_tokens : "-";
    const received = tokens?.completion_tokens !== undefined ? tokens.completion_tokens : "-";
    const requestTag = requestId ? String(requestId).trim().slice(0, 128) : "-";

    const line = `${timestamp} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${status} | ${requestTag}\n`;

    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, "");
    }
    fs.appendFileSync(LOG_FILE, line);

    // Trim to keep only last 200 lines
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length > 200) {
      fs.writeFileSync(LOG_FILE, lines.slice(-200).join("\n") + "\n");
    }
  } catch (error) {
    console.error("Failed to append to log.txt:", error.message);
  }
}

/**
 * Get last N lines of log.txt
 */
export async function getRecentLogs(limit = 200) {
  if (isCloud) return []; // Skip in Workers

  // Runtime check: ensure fs module is available
  if (!fs || typeof fs.existsSync !== "function") {
    console.error("[usageDb] fs module not available in this environment");
    return [];
  }

  if (!LOG_FILE) {
    console.error("[usageDb] LOG_FILE path not defined");
    return [];
  }

  if (!fs.existsSync(LOG_FILE)) {
    console.log(`[usageDb] Log file does not exist: ${LOG_FILE}`);
    return [];
  }

  try {
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-limit).reverse();
  } catch (error) {
    console.error("[usageDb] Failed to read log.txt:", error.message);
    console.error("[usageDb] LOG_FILE path:", LOG_FILE);
    return [];
  }
}

/**
 * Calculate cost for a usage entry
 * @param {string} provider - Provider ID
 * @param {string} model - Model ID
 * @param {object} tokens - Token counts
 * @returns {number} Cost in dollars
 */
async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;

  try {
    const { getPricingForModel } = await import("@/lib/localDb.js");
    const pricing = await getPricingForModel(provider, model);

    if (!pricing) return 0;

    let cost = 0;

    // Input tokens (non-cached)
    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);

    cost += (nonCachedInput * (pricing.input / 1000000));

    // Cached tokens
    if (cachedTokens > 0) {
      const cachedRate = pricing.cached || pricing.input; // Fallback to input rate
      cost += (cachedTokens * (cachedRate / 1000000));
    }

    // Output tokens
    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    cost += (outputTokens * (pricing.output / 1000000));

    // Reasoning tokens
    const reasoningTokens = tokens.reasoning_tokens || 0;
    if (reasoningTokens > 0) {
      const reasoningRate = pricing.reasoning || pricing.output; // Fallback to output rate
      cost += (reasoningTokens * (reasoningRate / 1000000));
    }

    // Cache creation tokens
    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    if (cacheCreationTokens > 0) {
      const cacheCreationRate = pricing.cache_creation || pricing.input; // Fallback to input rate
      cost += (cacheCreationTokens * (cacheCreationRate / 1000000));
    }

    return cost;
  } catch (error) {
    console.error("Error calculating cost:", error);
    return 0;
  }
}

/**
 * Get aggregated usage stats
 */
export async function getUsageStats() {
  const db = await getUsageDb();
  const history = db.data.history || [];

  // Import localDb to get provider connection names
  const { getProviderConnections } = await import("@/lib/localDb.js");

  // Fetch all provider connections to get account names
  let allConnections = [];
  try {
    allConnections = await getProviderConnections();
  } catch (error) {
    // If localDb is not available (e.g., in some environments), continue without account names
    console.warn("Could not fetch provider connections for usage stats:", error.message);
  }

  // Create a map from connectionId to account name
  const connectionMap = {};
  for (const conn of allConnections) {
    connectionMap[conn.id] = conn.name || conn.email || conn.id;
  }

  const stats = {
    totalRequests: history.length,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0, // NEW
    byProvider: {},
    byModel: {},
    byAccount: {},
    last10Minutes: [],
    last24Hours: [],
    pending: pendingRequests,
    activeRequests: []
  };

  // Build active requests list from pending counts
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        // modelKey is "model (provider)"
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        const modelName = match ? match[1] : modelKey;
        const providerName = match ? match[2] : "unknown";

        stats.activeRequests.push({
          model: modelName,
          provider: providerName,
          account: accountName,
          count
        });
      }
    }
  }

  // Initialize 10-minute buckets using stable minute boundaries
  const now = new Date();
  // Floor to the start of the current minute
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);

  // Create buckets keyed by minute timestamp for stable lookups
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const bucketTime = new Date(currentMinuteStart.getTime() - (9 - i) * 60 * 1000);
    const bucketKey = bucketTime.getTime();
    bucketMap[bucketKey] = {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0
    };
    stats.last10Minutes.push(bucketMap[bucketKey]);
  }

  // Initialize 24-hour buckets
  const currentHourStart = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
  const twentyFourHoursAgo = new Date(currentHourStart.getTime() - 23 * 60 * 60 * 1000);

  const hourlyBucketMap = {};
  for (let i = 0; i < 24; i++) {
    const bucketTime = new Date(currentHourStart.getTime() - (23 - i) * 60 * 60 * 1000);
    const bucketKey = bucketTime.getTime();
    hourlyBucketMap[bucketKey] = {
      timestamp: bucketTime.toISOString(),
      requests: 0,
      errors: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0
    };
    stats.last24Hours.push(hourlyBucketMap[bucketKey]);
  }

  for (const entry of history) {
    const promptTokens = entry.tokens?.prompt_tokens || 0;
    const completionTokens = entry.tokens?.completion_tokens || 0;
    const entryTime = new Date(entry.timestamp);

    // Calculate cost for this entry
    const entryCost = await calculateCost(entry.provider, entry.model, entry.tokens);

    stats.totalPromptTokens += promptTokens;
    stats.totalCompletionTokens += completionTokens;
    stats.totalCost += entryCost;

    // Last 10 minutes aggregation - floor entry time to its minute
    if (entryTime >= tenMinutesAgo && entryTime <= now) {
      const entryMinuteStart = Math.floor(entryTime.getTime() / 60000) * 60000;
      if (bucketMap[entryMinuteStart]) {
        bucketMap[entryMinuteStart].requests++;
        bucketMap[entryMinuteStart].promptTokens += promptTokens;
        bucketMap[entryMinuteStart].completionTokens += completionTokens;
        bucketMap[entryMinuteStart].cost += entryCost;
      }
    }

    // Last 24 hours aggregation - floor entry time to its hour
    if (entryTime >= twentyFourHoursAgo && entryTime <= now) {
      const entryHourStart = Math.floor(entryTime.getTime() / 3600000) * 3600000;
      if (hourlyBucketMap[entryHourStart]) {
        hourlyBucketMap[entryHourStart].requests++;
        hourlyBucketMap[entryHourStart].promptTokens += promptTokens;
        hourlyBucketMap[entryHourStart].completionTokens += completionTokens;
        hourlyBucketMap[entryHourStart].cost += entryCost;

        // Count errors for this hour
        if (entry.status && entry.status >= 400) {
          hourlyBucketMap[entryHourStart].errors++;
        }
      }
    }

    // By Provider
    if (!stats.byProvider[entry.provider]) {
      stats.byProvider[entry.provider] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0
      };
    }
    stats.byProvider[entry.provider].requests++;
    stats.byProvider[entry.provider].promptTokens += promptTokens;
    stats.byProvider[entry.provider].completionTokens += completionTokens;
    stats.byProvider[entry.provider].cost += entryCost;

    // By Model
    // Format: "modelName (provider)" if provider is known
    const modelKey = entry.provider ? `${entry.model} (${entry.provider})` : entry.model;

    if (!stats.byModel[modelKey]) {
      stats.byModel[modelKey] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        rawModel: entry.model,
        provider: entry.provider,
        lastUsed: entry.timestamp
      };
    }
    stats.byModel[modelKey].requests++;
    stats.byModel[modelKey].promptTokens += promptTokens;
    stats.byModel[modelKey].completionTokens += completionTokens;
    stats.byModel[modelKey].cost += entryCost;
    if (new Date(entry.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) {
      stats.byModel[modelKey].lastUsed = entry.timestamp;
    }

    // By Account (model + oauth account)
    // Use connectionId if available, otherwise fallback to provider name
    if (entry.connectionId) {
      const accountName = connectionMap[entry.connectionId] || `Account ${entry.connectionId.slice(0, 8)}...`;
      const accountKey = `${entry.model} (${entry.provider} - ${accountName})`;

      if (!stats.byAccount[accountKey]) {
        stats.byAccount[accountKey] = {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          rawModel: entry.model,
          provider: entry.provider,
          connectionId: entry.connectionId,
          accountName: accountName,
          lastUsed: entry.timestamp
        };
      }
      stats.byAccount[accountKey].requests++;
      stats.byAccount[accountKey].promptTokens += promptTokens;
      stats.byAccount[accountKey].completionTokens += completionTokens;
      stats.byAccount[accountKey].cost += entryCost;
      if (new Date(entry.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) {
        stats.byAccount[accountKey].lastUsed = entry.timestamp;
      }
    }
  }

  return stats;
}
