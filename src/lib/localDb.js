import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { SMART_PLAYBOOKS, INITIAL_SETTINGS } from "../shared/constants/defaults.js";
import { PROVIDER_ID_TO_ALIAS } from "../shared/constants/models.js";
import { emitProviderLifecycleEvent } from "./lifecycleEvents.js";
import { blacklistIp as firewallBlacklistIp } from "./firewall.js";

// Detect environment: Cloud (Workers/Edge) vs Local (Node.js)
// Simple check: if process.versions.node exists, we're in Node.js (local)
const isCloud = typeof process === 'undefined' || !process.versions?.node;


// Get app name - fixed constant to avoid Windows path issues in standalone build
function getAppName() {
  return process.env.ZIPPY_APP_NAME || "zippy-mesh";
}

// Get user data directory based on platform
function getUserDataDir() {
  if (isCloud) return "/tmp"; // Fallback for Workers

  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const platform = process.platform;
  const homeDir = os[String.fromCharCode(104, 111, 109, 101, 100, 105, 114)]();
  const appName = getAppName();

  if (platform === "win32") {
    const appDataEnv = process.env.APPDATA;
    if (appDataEnv) {
      return `${appDataEnv}\\${appName}`;
    }
    // Fallback if APPDATA is missing
    return `${homeDir}\\AppData\\Roaming\\${appName}`;
  } else {
    // macOS & Linux: ~/.{appName}
    return `${homeDir}/.${appName}`;
  }
}

// Data file path - stored in user home directory
// Data file path - stored in user home directory
const DATA_DIR = getUserDataDir();

// Migration: check for legacy .zippymesh directory and move it to .zippy-mesh if needed
// This handles the transition from v0.3.2-alpha (.zippymesh) to v0.3.3+ (.zippy-mesh)
if (!isCloud && !process.env.DATA_DIR) {
  const homeDir = os.homedir();
  const legacyDir = path.join(homeDir, ".zippymesh");
  const newDir = DATA_DIR;

  if (fs.existsSync(legacyDir) && legacyDir !== newDir) {
    // Check if new directory is empty or contains a fresh/unconfigured install
    let isFreshInstall = !fs.existsSync(newDir);
    if (!isFreshInstall) {
      const dbPath = path.join(newDir, "db.json");
      if (fs.existsSync(dbPath)) {
        try {
          const content = fs.readFileSync(dbPath, "utf8");
          const data = JSON.parse(content);
          // If firstRun is true and no providers, we consider it a fresh install that can be overridden
          if (data.settings?.firstRun && (!data.providerConnections || data.providerConnections.length === 0)) {
            isFreshInstall = true;
          }
        } catch (e) {
          // If we can't parse it, assume it's corrupt/fresh
          isFreshInstall = true;
        }
      } else {
        isFreshInstall = true;
      }
    }

    if (isFreshInstall) {
      console.log(`[DB] Legacy data directory found at ${legacyDir}. Migrating to ${newDir}...`);
      try {
        // If newDir exists, back it up first just in case
        if (fs.existsSync(newDir)) {
          const backupDir = `${newDir}.fresh-backup-${Date.now()}`;
          fs.renameSync(newDir, backupDir);
        }
        fs.renameSync(legacyDir, newDir);
        console.log(`[DB] Successfully migrated legacy data: ${legacyDir} -> ${newDir}`);
      } catch (err) {
        console.error(`[DB] Failed to migrate legacy data directory: ${err.message}`);
      }
    }
  }
}

const DB_FILE = isCloud ? null : path.join(DATA_DIR, "db.json");
const SQLITE_DB_FILE = isCloud ? null : path.join(DATA_DIR, "zippymesh.db");

// Ensure data directory exists
if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============ SQLite Initializer ============

let sqliteDb = null;

function ensureWalletColumns(sqlite) {
  const connCols = sqlite.prepare("PRAGMA table_info(provider_connections)").all();
  const hasWalletIdConn = connCols.some((c) => c.name === "wallet_id");
  if (!hasWalletIdConn) {
    sqlite.exec("ALTER TABLE provider_connections ADD COLUMN wallet_id TEXT");
  }

  const nodeCols = sqlite.prepare("PRAGMA table_info(provider_nodes)").all();
  const hasWalletIdNode = nodeCols.some((c) => c.name === "wallet_id");
  if (!hasWalletIdNode) {
    sqlite.exec("ALTER TABLE provider_nodes ADD COLUMN wallet_id TEXT");
  }
}

function ensureModelRegistryColumns(sqlite) {
  const modelRegistryCols = sqlite.prepare("PRAGMA table_info(model_registry)").all();
  const hasFirstSeenAt = modelRegistryCols.some((c) => c.name === "first_seen_at");
  const hasLastSeenAt = modelRegistryCols.some((c) => c.name === "last_seen_at");
  const hasMissingSinceAt = modelRegistryCols.some((c) => c.name === "missing_since_at");
  const hasLifecycleState = modelRegistryCols.some((c) => c.name === "lifecycle_state");
  const hasReplacementMetadata = modelRegistryCols.some((c) => c.name === "replacement_metadata");

  if (!hasFirstSeenAt) {
    sqlite.exec("ALTER TABLE model_registry ADD COLUMN first_seen_at TEXT");
  }
  if (!hasLastSeenAt) {
    sqlite.exec("ALTER TABLE model_registry ADD COLUMN last_seen_at TEXT");
  }
  if (!hasMissingSinceAt) {
    sqlite.exec("ALTER TABLE model_registry ADD COLUMN missing_since_at TEXT");
  }
  if (!hasLifecycleState) {
    sqlite.exec("ALTER TABLE model_registry ADD COLUMN lifecycle_state TEXT DEFAULT 'active'");
  }
  if (!hasReplacementMetadata) {
    sqlite.exec("ALTER TABLE model_registry ADD COLUMN replacement_metadata TEXT");
  }
}

export function getSqliteDb() {
  if (isCloud) return null;
  if (sqliteDb) return sqliteDb;

  sqliteDb = new Database(SQLITE_DB_FILE);
  sqliteDb.pragma('journal_mode = WAL'); // Better concurrency

  // Initialize tables
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS provider_connections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      authType TEXT NOT NULL,
      name TEXT,
      wallet_id TEXT, -- Associated ZippyCoin wallet
      group_name TEXT DEFAULT 'default',
      priority INTEGER DEFAULT 1,
      isActive BOOLEAN DEFAULT 1,
      isEnabled BOOLEAN DEFAULT 1,
      email TEXT,
      accessToken TEXT,
      refreshToken TEXT,
      expiresAt TEXT,
      apiKey TEXT,
      testStatus TEXT DEFAULT 'unknown',
      lastTested TEXT,
      lastError TEXT,
      lastErrorAt TEXT,
      rateLimitedUntil TEXT,
      metadata TEXT, -- JSON blob for provider-specific data
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      wallet_id TEXT, -- Associated ZippyCoin wallet
      baseUrl TEXT,
      apiType TEXT,
      prefix TEXT,
      metadata TEXT, -- JSON blob
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS model_registry (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      name TEXT,
      description TEXT,
      input_price REAL DEFAULT 0,
      output_price REAL DEFAULT 0,
      request_price REAL DEFAULT 0,
      context_window INTEGER,
      is_free BOOLEAN DEFAULT 0,
      is_preview BOOLEAN DEFAULT 0,
      is_premium BOOLEAN DEFAULT 0,
      avg_latency REAL DEFAULT 0,
      avg_tps REAL DEFAULT 0,
      last_sync TEXT,
      metadata TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      missing_since_at TEXT,
      lifecycle_state TEXT DEFAULT 'active',
      replacement_metadata TEXT,
      UNIQUE(provider, model_id)
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT UNIQUE NOT NULL,
      encryptedPrivateKey TEXT,
      type TEXT NOT NULL, -- 'imported', 'created', 'derived'
      balance REAL DEFAULT 0,
      isDefault BOOLEAN DEFAULT 0,
      metadata TEXT, -- JSON blob
      createdAt TEXT,
      updatedAt TEXT
    );

    -- router API keys for clients of the local service
    CREATE TABLE IF NOT EXISTS router_api_keys (
      id TEXT PRIMARY KEY,
      name TEXT,
      keyHash TEXT NOT NULL,
      scopes TEXT, -- JSON array string
      createdAt TEXT,
      expiresAt TEXT,
      revoked BOOLEAN DEFAULT 0
    );

    -- blacklist entries for IPs or keys
    CREATE TABLE IF NOT EXISTS blacklist (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL, -- 'ip' | 'key'
      value TEXT NOT NULL,
      reason TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      type TEXT NOT NULL, -- 'send', 'receive'
      amount REAL NOT NULL,
      symbol TEXT DEFAULT 'ZIPc',
      status TEXT DEFAULT 'confirmed',
      counterparty TEXT,
      txHash TEXT,
      description TEXT,
      timestamp TEXT,
      metadata TEXT,
      FOREIGN KEY(wallet_id) REFERENCES wallets(id)
    );

    -- Routing filter rules for peer/provider filtering
    CREATE TABLE IF NOT EXISTS routing_filters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      filter_type TEXT NOT NULL, -- 'trust_score', 'ip_address', 'country', 'cost', 'latency'
      operator TEXT NOT NULL, -- 'gte', 'lte', 'eq', 'in_range', 'in_list', 'not_in_list'
      value TEXT NOT NULL, -- JSON-encoded value (number, string, array)
      action TEXT NOT NULL DEFAULT 'allow', -- 'allow' | 'block'
      isActive BOOLEAN DEFAULT 1,
      priority INTEGER DEFAULT 100, -- Lower = higher priority
      createdAt TEXT,
      updatedAt TEXT
    );

    -- Global routing control settings
    CREATE TABLE IF NOT EXISTS routing_controls (
      id TEXT PRIMARY KEY DEFAULT 'global',
      defaultAction TEXT DEFAULT 'allow', -- 'allow' | 'block' when no filter matches
      maxCostPer1k REAL, -- Maximum cost in ZIP per 1k tokens
      maxLatencyMs INTEGER, -- Maximum acceptable latency in ms
      minTrustScore INTEGER, -- Minimum trust score (0-100)
      allowedCountries TEXT, -- JSON array of ISO country codes
      blockedCountries TEXT, -- JSON array of ISO country codes
      allowedIpRanges TEXT, -- JSON array of CIDR ranges
      blockedIpRanges TEXT, -- JSON array of CIDR ranges
      updatedAt TEXT
    );

    -- Peer metadata cache for filtering
    CREATE TABLE IF NOT EXISTS peer_metadata (
      peerId TEXT PRIMARY KEY,
      ipAddress TEXT,
      countryCode TEXT, -- ISO country code
      region TEXT,
      isp TEXT,
      lastSeen TEXT,
      trustScore INTEGER,
      metadata TEXT -- JSON blob for additional data
    );

    -- Purchase records for license activation
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      walletAddress TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'ZIPc',
      status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'refunded'
      txHash TEXT,
      licenseKey TEXT,
      activatedAt TEXT,
      expiresAt TEXT,
      metadata TEXT, -- JSON blob for additional data
      createdAt TEXT,
      updatedAt TEXT
    );

    -- Routing decision history for analytics
    CREATE TABLE IF NOT EXISTS routing_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      intent TEXT,
      selected_model TEXT,
      used_model TEXT,
      score REAL DEFAULT 0,
      fallback_depth INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 0,
      constraints_json TEXT,
      reason TEXT
    );

    -- Model preferences per intent
    CREATE TABLE IF NOT EXISTS routing_preferences (
      intent TEXT NOT NULL,
      preferred_model TEXT NOT NULL,
      trust_score REAL DEFAULT 0.5,
      last_updated TEXT,
      PRIMARY KEY (intent, preferred_model)
    );

    -- Per-request trace log for debugging and history
    CREATE TABLE IF NOT EXISTS request_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      request_id TEXT,
      virtual_key_id TEXT,
      intent TEXT,
      selected_model TEXT,
      used_model TEXT,
      prompt_hash TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 0,
      cache_hit INTEGER DEFAULT 0,
      fallback_depth INTEGER DEFAULT 0,
      error_message TEXT,
      constraints_json TEXT,
      metadata_json TEXT,
      steps_json TEXT,
      flagged INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_request_traces_timestamp ON request_traces(timestamp);
    CREATE INDEX IF NOT EXISTS idx_request_traces_model ON request_traces(used_model);

    -- Exact-match prompt cache
    CREATE TABLE IF NOT EXISTS prompt_cache (
      hash TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      response_json TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      hit_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      last_hit_at TEXT,
      expires_at TEXT
    );

    -- Semantic cache embeddings (for cosine-similarity matching)
    CREATE TABLE IF NOT EXISTS cache_embeddings (
      hash TEXT NOT NULL,
      embed_model TEXT NOT NULL,
      embedding TEXT NOT NULL,
      PRIMARY KEY (hash, embed_model)
    );

    -- Virtual API keys for per-consumer budget and rate limit tracking
    CREATE TABLE IF NOT EXISTS virtual_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      owner TEXT DEFAULT 'default',
      team TEXT,
      project TEXT,
      monthly_token_budget INTEGER,
      monthly_dollar_budget REAL,
      tokens_used_this_month INTEGER DEFAULT 0,
      dollars_used_this_month REAL DEFAULT 0.0,
      rate_limit_rpm INTEGER,
      allowed_providers TEXT,
      allowed_models TEXT,
      is_active INTEGER DEFAULT 1,
      budget_reset_month TEXT,
      created_at TEXT,
      last_used_at TEXT,
      expires_at TEXT
    );

    -- Prompt template library
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      variables TEXT,
      model TEXT,
      is_favorite INTEGER DEFAULT 0,
      use_count INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    -- Multi-tenancy: organizations
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT DEFAULT 'community',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      settings_json TEXT
    );

    -- Multi-tenancy: teams within an org
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, slug),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    -- Multi-tenancy: team members with roles
    CREATE TABLE IF NOT EXISTS tenant_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_identifier TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      invited_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(team_id, user_identifier),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    -- Compliance: immutable append-only audit log
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      before_json TEXT,
      after_json TEXT,
      ip_address TEXT,
      user_agent TEXT
    );

    -- Compliance: dashboard access log
    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT,
      method TEXT,
      path TEXT,
      status_code INTEGER,
      duration_ms INTEGER,
      ip_address TEXT
    );

    -- SLA monitoring: per-provider health events
    CREATE TABLE IF NOT EXISTS sla_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      provider TEXT NOT NULL,
      latency_ms INTEGER,
      success INTEGER DEFAULT 1,
      error_code TEXT,
      model TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sla_events_provider ON sla_events(provider, timestamp);

    -- SLA monitoring: per-provider configuration and thresholds
    CREATE TABLE IF NOT EXISTS sla_config (
      provider TEXT PRIMARY KEY,
      target_uptime_pct REAL DEFAULT 99.5,
      target_p95_latency_ms INTEGER DEFAULT 2000,
      auto_disable_on_breach INTEGER DEFAULT 0,
      breach_window_minutes INTEGER DEFAULT 60,
      is_disabled INTEGER DEFAULT 0,
      disabled_at TEXT,
      disabled_reason TEXT
    );

    -- Community marketplace: shared playbooks registry
    CREATE TABLE IF NOT EXISTS marketplace_playbooks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      author TEXT DEFAULT 'anonymous',
      intent TEXT,
      tags TEXT,
      rules_json TEXT NOT NULL,
      downloads INTEGER DEFAULT 0,
      rating_sum INTEGER DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_featured INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_marketplace_intent ON marketplace_playbooks(intent);
    CREATE TABLE IF NOT EXISTS vault_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      label TEXT,
      category TEXT NOT NULL DEFAULT 'api-key',
      encrypted_value TEXT NOT NULL,
      salt TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vault_agent_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      entry_name TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `);

  // Migration: add wallet_id to provider_connections / provider_nodes and lifecycle columns to model_registry
  try {
    ensureWalletColumns(sqliteDb);
    ensureModelRegistryColumns(sqliteDb);
    sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_model_registry_provider_state ON model_registry(provider, lifecycle_state)");
  } catch (e) {
    // Log warning for unexpected errors, but continue - table may already have the column
    const message = String(e?.message || "");
    if (
      !message.includes("no column named wallet_id") &&
      !message.includes("duplicate column name") &&
      !message.includes("duplicate column")
    ) {
      console.warn("Migration warning: SQLite migration helper failed:", e.message);
    }
  }

  // Migrate request_traces: add steps_json, flagged, and virtual_key_id columns if missing
  try {
    const traceCols = sqliteDb.prepare("PRAGMA table_info(request_traces)").all();
    if (!traceCols.some(c => c.name === "steps_json")) {
      sqliteDb.exec("ALTER TABLE request_traces ADD COLUMN steps_json TEXT");
    }
    if (!traceCols.some(c => c.name === "flagged")) {
      sqliteDb.exec("ALTER TABLE request_traces ADD COLUMN flagged INTEGER DEFAULT 0");
    }
    if (!traceCols.some(c => c.name === "virtual_key_id")) {
      sqliteDb.exec("ALTER TABLE request_traces ADD COLUMN virtual_key_id TEXT");
    }
  } catch (e) {
    // Ignore if table doesn't exist yet
  }

  // Migrate virtual_keys: add team_id and org_id if missing
  try {
    const vkCols = sqliteDb.prepare("PRAGMA table_info(virtual_keys)").all();
    if (!vkCols.some(c => c.name === "team_id")) {
      sqliteDb.exec("ALTER TABLE virtual_keys ADD COLUMN team_id TEXT");
    }
    if (!vkCols.some(c => c.name === "org_id")) {
      sqliteDb.exec("ALTER TABLE virtual_keys ADD COLUMN org_id TEXT");
    }
  } catch (e) {
    console.warn("[DB] virtual_keys migration failed:", e.message);
  }

  return sqliteDb;
}

/**
 * Save a routing decision to the database (synchronous, uses better-sqlite3)
 */
export function saveRoutingDecision(decision) {
  const db = getSqliteDb();
  if (!db) return null;

  try {
    const stmt = db.prepare(`
      INSERT INTO routing_decisions
        (timestamp, intent, selected_model, used_model, score, fallback_depth, latency_ms, success, constraints_json, reason)
      VALUES
        (@timestamp, @intent, @selected_model, @used_model, @score, @fallback_depth, @latency_ms, @success, @constraints_json, @reason)
    `);

    return stmt.run(decision).lastInsertRowid;
  } catch (e) {
    console.error("[RoutingDB] Error saving decision:", e.message);
    return null;
  }
}

/**
 * Get routing statistics for a time window (synchronous)
 */
export function getRoutingStats({ hours = 24, intent = null, model = null } = {}) {
  const db = getSqliteDb();
  if (!db) return { totalRequests: 0 };

  try {
    const hours_clamped = Math.max(1, Math.min(hours, 720));
    const since = `datetime('now', '-${hours_clamped} hours')`;
    let where = `WHERE timestamp >= ${since}`;

    if (intent) {
      where += ` AND intent = '${intent.replace(/'/g, "''")}'`;
    }
    if (model) {
      where += ` AND (selected_model = '${model.replace(/'/g, "''")}' OR used_model = '${model.replace(/'/g, "''")}')`;
    }

    const agg = db.prepare(`
      SELECT
        COUNT(*) as total,
        AVG(latency_ms) as avgLatency,
        SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes
      FROM routing_decisions ${where}
    `).get();

    const byIntent = Object.fromEntries(
      db.prepare(`
        SELECT intent, COUNT(*) as c
        FROM routing_decisions ${where}
        GROUP BY intent
      `).all().map(r => [r.intent || 'default', r.c])
    );

    const byModel = Object.fromEntries(
      db.prepare(`
        SELECT used_model, COUNT(*) as c
        FROM routing_decisions ${where}
        GROUP BY used_model
      `).all().map(r => [r.used_model || 'unknown', r.c])
    );

    const byFallbackDepth = Object.fromEntries(
      db.prepare(`
        SELECT fallback_depth, COUNT(*) as c
        FROM routing_decisions ${where}
        GROUP BY fallback_depth
      `).all().map(r => [String(r.fallback_depth), r.c])
    );

    const topModels = db.prepare(`
      SELECT
        used_model as model,
        COUNT(*) as count,
        ROUND(SUM(CASE WHEN success=1 THEN 1.0 ELSE 0 END)*100/COUNT(*), 1) as successRate
      FROM routing_decisions ${where}
      GROUP BY used_model
      ORDER BY count DESC
      LIMIT 5
    `).all();

    return {
      totalRequests: agg.total ?? 0,
      successRate: agg.total > 0 ? Math.round((agg.successes / agg.total) * 1000) / 10 : 0,
      avgLatency: Math.round(agg.avgLatency ?? 0),
      byIntent,
      byModel,
      byFallbackDepth,
      topModels,
    };
  } catch (e) {
    console.error("[RoutingDB] Error getting stats:", e.message);
    return { totalRequests: 0 };
  }
}

/**
 * Get the preferred model for an intent (synchronous)
 */
export function getModelPreference(intent) {
  const db = getSqliteDb();
  if (!db) return null;

  try {
    return db.prepare(`
      SELECT * FROM routing_preferences
      WHERE intent = ?
      ORDER BY trust_score DESC
      LIMIT 1
    `).get(intent) ?? null;
  } catch (e) {
    console.error("[RoutingDB] Error getting preference:", e.message);
    return null;
  }
}

/**
 * Update or insert model preference for an intent (synchronous)
 */
export function updateModelPreference(intent, model, success) {
  const db = getSqliteDb();
  if (!db) return;

  try {
    const delta = success ? 0.05 : -0.1;
    db.prepare(`
      INSERT INTO routing_preferences (intent, preferred_model, trust_score, last_updated)
      VALUES (?, ?, 0.5, datetime('now'))
      ON CONFLICT(intent, preferred_model) DO UPDATE SET
        trust_score = MAX(0, MIN(1, trust_score + ?)),
        last_updated = datetime('now')
    `).run(intent, model, delta);
  } catch (e) {
    console.error("[RoutingDB] Error updating preference:", e.message);
  }
}

/**
 * Save a per-request trace (synchronous)
 */
export function saveRequestTrace(trace) {
  const db = getSqliteDb();
  if (!db) return null;
  try {
    return db.prepare(`
      INSERT INTO request_traces
        (timestamp, request_id, virtual_key_id, intent, selected_model, used_model, prompt_hash,
         input_tokens, output_tokens, latency_ms, success, cache_hit, fallback_depth,
         error_message, constraints_json, metadata_json)
      VALUES
        (@timestamp, @request_id, @virtual_key_id, @intent, @selected_model, @used_model, @prompt_hash,
         @input_tokens, @output_tokens, @latency_ms, @success, @cache_hit, @fallback_depth,
         @error_message, @constraints_json, @metadata_json)
    `).run({
      timestamp: trace.timestamp || new Date().toISOString(),
      request_id: trace.request_id || null,
      virtual_key_id: trace.virtual_key_id || null,
      intent: trace.intent || null,
      selected_model: trace.selected_model || null,
      used_model: trace.used_model || null,
      prompt_hash: trace.prompt_hash || null,
      input_tokens: trace.input_tokens || 0,
      output_tokens: trace.output_tokens || 0,
      latency_ms: trace.latency_ms || 0,
      success: trace.success ? 1 : 0,
      cache_hit: trace.cache_hit ? 1 : 0,
      fallback_depth: trace.fallback_depth || 0,
      error_message: trace.error_message || null,
      constraints_json: trace.constraints_json || null,
      metadata_json: trace.metadata_json || null,
    }).lastInsertRowid;
  } catch (e) {
    console.error("[TracesDB] Error saving trace:", e.message);
    return null;
  }
}

/**
 * Get request traces with optional filters (synchronous)
 */
export function getRequestTraces({ limit = 50, offset = 0, model = null, intent = null, hours = 24 } = {}) {
  const db = getSqliteDb();
  if (!db) return { traces: [], total: 0 };
  try {
    const hours_clamped = Math.max(1, Math.min(hours, 720));
    const since = `datetime('now', '-${hours_clamped} hours')`;
    let where = `WHERE timestamp >= ${since}`;
    if (model) where += ` AND used_model = '${model.replace(/'/g, "''")}'`;
    if (intent) where += ` AND intent = '${intent.replace(/'/g, "''")}'`;

    const total = db.prepare(`SELECT COUNT(*) as c FROM request_traces ${where}`).get()?.c ?? 0;
    const traces = db.prepare(`
      SELECT * FROM request_traces ${where}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { traces, total };
  } catch (e) {
    console.error("[TracesDB] Error getting traces:", e.message);
    return { traces: [], total: 0 };
  }
}

/**
 * Get a single trace by ID (synchronous)
 */
export function getRequestTraceById(id) {
  const db = getSqliteDb();
  if (!db) return null;
  try {
    return db.prepare(`SELECT * FROM request_traces WHERE id = ?`).get(id) ?? null;
  } catch (e) {
    return null;
  }
}

/**
 * Toggle flagged status on a trace (synchronous)
 */
export function flagRequestTrace(id, flagged = true) {
  const db = getSqliteDb();
  if (!db) return;
  try {
    db.prepare(`UPDATE request_traces SET flagged = ? WHERE id = ?`).run(flagged ? 1 : 0, id);
  } catch (e) {}
}

/**
 * Get prompt cache entry by hash (synchronous)
 */
export function getCacheEntry(hash) {
  const db = getSqliteDb();
  if (!db) return null;
  try {
    const entry = db.prepare(`
      SELECT * FROM prompt_cache
      WHERE hash = ?
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(hash);
    if (entry) {
      // Update hit count and last_hit_at
      db.prepare(`
        UPDATE prompt_cache SET hit_count = hit_count + 1, last_hit_at = datetime('now')
        WHERE hash = ?
      `).run(hash);
    }
    return entry ?? null;
  } catch (e) {
    console.error("[CacheDB] Error getting cache entry:", e.message);
    return null;
  }
}

/**
 * Store prompt cache entry (synchronous)
 */
export function setCacheEntry(hash, model, responseJson, inputTokens, outputTokens, ttlSeconds = 3600) {
  const db = getSqliteDb();
  if (!db) return;
  try {
    const expiresAt = ttlSeconds > 0
      ? `datetime('now', '+${ttlSeconds} seconds')`
      : null;
    db.prepare(`
      INSERT OR REPLACE INTO prompt_cache
        (hash, model, response_json, input_tokens, output_tokens, hit_count, created_at, last_hit_at, expires_at)
      VALUES
        (?, ?, ?, ?, ?, 0, datetime('now'), NULL, ${expiresAt ? expiresAt : 'NULL'})
    `).run(hash, model, responseJson, inputTokens || 0, outputTokens || 0);
  } catch (e) {
    console.error("[CacheDB] Error setting cache entry:", e.message);
  }
}

/**
 * Get prompt cache stats (synchronous)
 */
export function getCacheStats() {
  const db = getSqliteDb();
  if (!db) return { entries: 0, totalHits: 0, tokensSaved: 0 };
  try {
    const row = db.prepare(`
      SELECT
        COUNT(*) as entries,
        SUM(hit_count) as totalHits,
        SUM(hit_count * (input_tokens + output_tokens)) as tokensSaved
      FROM prompt_cache
      WHERE expires_at IS NULL OR expires_at > datetime('now')
    `).get();
    return {
      entries: row?.entries ?? 0,
      totalHits: row?.totalHits ?? 0,
      tokensSaved: row?.tokensSaved ?? 0,
    };
  } catch (e) {
    return { entries: 0, totalHits: 0, tokensSaved: 0 };
  }
}

/**
 * Purge expired cache entries (synchronous)
 */
export function purgeExpiredCache() {
  const db = getSqliteDb();
  if (!db) return 0;
  try {
    return db.prepare(`DELETE FROM prompt_cache WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')`).run().changes;
  } catch (e) {
    return 0;
  }
}

/**
 * Get a stored embedding for a cache hash + embed model (synchronous)
 */
export function getCacheEmbedding(hash, embedModel) {
  const db = getSqliteDb();
  if (!db) return null;
  try {
    return db.prepare(`SELECT * FROM cache_embeddings WHERE hash = ? AND embed_model = ?`).get(hash, embedModel) ?? null;
  } catch (e) {
    return null;
  }
}

/**
 * Store an embedding vector for a cache hash (synchronous)
 */
export function setCacheEmbedding(hash, embedModel, embeddingJson) {
  const db = getSqliteDb();
  if (!db) return;
  try {
    db.prepare(`
      INSERT OR REPLACE INTO cache_embeddings (hash, embed_model, embedding)
      VALUES (?, ?, ?)
    `).run(hash, embedModel, embeddingJson);
  } catch (e) {
    console.warn("[CacheDB] Failed to store embedding:", e.message);
  }
}

/**
 * Get all stored embeddings for a given embed model (synchronous).
 * Returns array of { hash, embedding (JSON string) }.
 */
export function getAllCacheEmbeddings(embedModel) {
  const db = getSqliteDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT ce.hash, ce.embedding
      FROM cache_embeddings ce
      INNER JOIN prompt_cache pc ON ce.hash = pc.hash
      WHERE ce.embed_model = ?
        AND (pc.expires_at IS NULL OR pc.expires_at > datetime('now'))
    `).all(embedModel);
  } catch (e) {
    return [];
  }
}

/**
 * Alias for getSqliteDb — used by routingIntelligence.js
 */
export function getLocalDb() {
  return getSqliteDb();
}

/**
 * Create a new virtual API key (synchronous)
 * Returns the generated key (only time it's available in plaintext)
 */
export function createVirtualKey({ name, owner = 'default', team = null, project = null, monthlyTokenBudget = null, monthlyDollarBudget = null, rateLimitRpm = null, allowedProviders = null, allowedModels = null }) {
  const db = getSqliteDb();
  if (!db) return null;
  try {
    const id = crypto.randomUUID();
    const rawKey = `zm_live_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 12);
    db.prepare(`
      INSERT INTO virtual_keys
        (id, name, key_hash, key_prefix, owner, team, project,
         monthly_token_budget, monthly_dollar_budget, rate_limit_rpm,
         allowed_providers, allowed_models, is_active, budget_reset_month, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
    `).run(id, name, keyHash, keyPrefix, owner, team, project,
      monthlyTokenBudget, monthlyDollarBudget, rateLimitRpm,
      allowedProviders ? JSON.stringify(allowedProviders) : null,
      allowedModels ? JSON.stringify(allowedModels) : null,
      new Date().toISOString().slice(0, 7)
    );
    return { id, rawKey, keyPrefix, name };
  } catch (e) {
    console.error('[VirtualKeys] Error creating key:', e.message);
    return null;
  }
}

/**
 * Look up a virtual key by SHA-256 hash (synchronous)
 */
export function getVirtualKeyByHash(keyHash) {
  const db = getSqliteDb();
  if (!db) return null;
  try {
    return db.prepare(`SELECT * FROM virtual_keys WHERE key_hash = ? AND is_active = 1`).get(keyHash) ?? null;
  } catch (e) {
    return null;
  }
}

/**
 * Check if a virtual key is within its budget (synchronous)
 * Returns { allowed: bool, reason: string|null }
 */
export function checkVirtualKeyBudget(keyId) {
  const db = getSqliteDb(); if (!db) return { allowed: true, reason: null };
  try {
    const vk = db.prepare(`SELECT * FROM virtual_keys WHERE id = ? AND is_active = 1`).get(keyId);
    if (!vk) return { allowed: false, reason: 'Key not found or inactive' };
    if (vk.expires_at && new Date(vk.expires_at) < new Date()) return { allowed: false, reason: 'Key expired' };
    if (vk.monthly_token_budget && vk.tokens_used_this_month >= vk.monthly_token_budget) return { allowed: false, reason: 'Monthly token budget exceeded' };
    if (vk.monthly_dollar_budget && vk.dollars_used_this_month >= vk.monthly_dollar_budget) return { allowed: false, reason: 'Monthly dollar budget exceeded' };
    return { allowed: true, reason: null };
  } catch (e) {
    return { allowed: true, reason: null }; // fail open on error
  }
}

/**
 * List all virtual keys (synchronous) — never returns key_hash
 */
export function listVirtualKeys() {
  const db = getSqliteDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, name, key_prefix, owner, team, project,
        monthly_token_budget, monthly_dollar_budget,
        tokens_used_this_month, dollars_used_this_month,
        rate_limit_rpm, is_active, created_at, last_used_at, expires_at
      FROM virtual_keys ORDER BY created_at DESC
    `).all();
  } catch (e) {
    return [];
  }
}

/**
 * Revoke (soft-delete) a virtual key (synchronous)
 */
export function revokeVirtualKey(id) {
  const db = getSqliteDb();
  if (!db) return false;
  try {
    db.prepare(`UPDATE virtual_keys SET is_active = 0 WHERE id = ?`).run(id);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Update usage for a virtual key and handle monthly reset (synchronous)
 */
export function updateVirtualKeyUsage(id, { tokensUsed = 0, dollarCost = 0 }) {
  const db = getSqliteDb();
  if (!db) return;
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const key = db.prepare(`SELECT budget_reset_month FROM virtual_keys WHERE id = ?`).get(id);
    if (!key) return;
    if (key.budget_reset_month !== currentMonth) {
      // Reset monthly counters
      db.prepare(`
        UPDATE virtual_keys SET
          tokens_used_this_month = ?, dollars_used_this_month = ?,
          budget_reset_month = ?, last_used_at = datetime('now')
        WHERE id = ?
      `).run(tokensUsed, dollarCost, currentMonth, id);
    } else {
      db.prepare(`
        UPDATE virtual_keys SET
          tokens_used_this_month = tokens_used_this_month + ?,
          dollars_used_this_month = dollars_used_this_month + ?,
          last_used_at = datetime('now')
        WHERE id = ?
      `).run(tokensUsed, dollarCost, id);
    }
  } catch (e) {
    console.error('[VirtualKeys] Error updating usage:', e.message);
  }
}

export function listPromptTemplates({ tag = null, search = null } = {}) {
  const db = getSqliteDb();
  if (!db) return [];
  try {
    let where = "WHERE 1=1";
    if (tag) where += ` AND (',' || tags || ',') LIKE '%,${tag.replace(/'/g,"''")},%'`;
    if (search) where += ` AND (title LIKE '%${search.replace(/'/g,"''")}%' OR content LIKE '%${search.replace(/'/g,"''")}%')`;
    return db.prepare(`SELECT * FROM prompt_templates ${where} ORDER BY is_favorite DESC, use_count DESC, created_at DESC`).all();
  } catch (e) { return []; }
}

export function getPromptTemplate(id) {
  const db = getSqliteDb();
  if (!db) return null;
  try { return db.prepare(`SELECT * FROM prompt_templates WHERE id = ?`).get(id) ?? null; } catch (e) { return null; }
}

export function createPromptTemplate({ title, content, description = '', tags = '', variables = '', model = null }) {
  const db = getSqliteDb();
  if (!db) return null;
  try {
    const id = uuidv4();
    db.prepare(`INSERT INTO prompt_templates (id,title,content,description,tags,variables,model,created_at,updated_at) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(id,title,content,description,tags,variables,model);
    return id;
  } catch (e) { console.error('[PromptDB]',e.message); return null; }
}

export function updatePromptTemplate(id, updates) {
  const db = getSqliteDb();
  if (!db) return;
  try {
    const fields = [];
    const vals = [];
    if (updates.title !== undefined) { fields.push("title=?"); vals.push(updates.title); }
    if (updates.content !== undefined) { fields.push("content=?"); vals.push(updates.content); }
    if (updates.description !== undefined) { fields.push("description=?"); vals.push(updates.description); }
    if (updates.tags !== undefined) { fields.push("tags=?"); vals.push(updates.tags); }
    if (updates.variables !== undefined) { fields.push("variables=?"); vals.push(updates.variables); }
    if (updates.model !== undefined) { fields.push("model=?"); vals.push(updates.model); }
    if (updates.is_favorite !== undefined) { fields.push("is_favorite=?"); vals.push(updates.is_favorite ? 1 : 0); }
    if (!fields.length) return;
    fields.push("updated_at=datetime('now')");
    db.prepare(`UPDATE prompt_templates SET ${fields.join(',')} WHERE id=?`).run(...vals, id);
  } catch (e) {}
}

export function deletePromptTemplate(id) {
  const db = getSqliteDb();
  if (!db) return;
  try { db.prepare(`DELETE FROM prompt_templates WHERE id=?`).run(id); } catch (e) {}
}

export function incrementPromptUseCount(id) {
  const db = getSqliteDb();
  if (!db) return;
  try { db.prepare(`UPDATE prompt_templates SET use_count=use_count+1 WHERE id=?`).run(id); } catch (e) {}
}

// ── Community Marketplace ─────────────────────────────────────────────────────

export function listMarketplacePlaybooks({ intent = null, tag = null, search = null, sort = 'downloads', limit = 20, offset = 0 } = {}) {
  const db = getSqliteDb(); if (!db) return { items: [], total: 0 };
  try {
    const conditions = [];
    if (intent) conditions.push(`intent = '${intent.replace(/'/g,"''")}' `);
    if (tag) conditions.push(`tags LIKE '%${tag.replace(/'/g,"''")}%'`);
    if (search) conditions.push(`(title LIKE '%${search.replace(/'/g,"''")}%' OR description LIKE '%${search.replace(/'/g,"''")}%')`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderCol = sort === 'rating' ? 'CASE WHEN rating_count>0 THEN CAST(rating_sum AS REAL)/rating_count ELSE 0 END' : sort === 'newest' ? 'created_at' : 'downloads';
    const total = db.prepare(`SELECT COUNT(*) as c FROM marketplace_playbooks ${where}`).get()?.c ?? 0;
    const items = db.prepare(`SELECT * FROM marketplace_playbooks ${where} ORDER BY is_featured DESC, ${orderCol} DESC LIMIT ? OFFSET ?`).all(limit, offset);
    return { items: items.map(p => ({ ...p, tags: p.tags ? p.tags.split(',') : [], avgRating: p.rating_count > 0 ? Math.round((p.rating_sum / p.rating_count) * 10) / 10 : null })), total };
  } catch (e) { return { items: [], total: 0 }; }
}

export function getMarketplacePlaybook(id) {
  const db = getSqliteDb(); if (!db) return null;
  try {
    const p = db.prepare(`SELECT * FROM marketplace_playbooks WHERE id = ?`).get(id);
    if (!p) return null;
    return { ...p, tags: p.tags ? p.tags.split(',') : [], avgRating: p.rating_count > 0 ? Math.round((p.rating_sum / p.rating_count) * 10) / 10 : null };
  } catch (e) { return null; }
}

export function publishMarketplacePlaybook({ title, description, author, intent, tags, rulesJson }) {
  const db = getSqliteDb(); if (!db) return null;
  const id = uuidv4();
  db.prepare(`INSERT INTO marketplace_playbooks (id, title, description, author, intent, tags, rules_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, title, description || null, author || 'anonymous', intent || null, Array.isArray(tags) ? tags.join(',') : (tags || null), rulesJson);
  return id;
}

export function incrementMarketplaceDownloads(id) {
  const db = getSqliteDb(); if (!db) return;
  db.prepare(`UPDATE marketplace_playbooks SET downloads = downloads + 1, updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function rateMarketplacePlaybook(id, rating) {
  const db = getSqliteDb(); if (!db) return;
  const r = Math.max(1, Math.min(5, Math.round(rating)));
  db.prepare(`UPDATE marketplace_playbooks SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?`).run(r, id);
}

// Default data structure
export const DEFAULT_RATE_LIMITS = {
  "groq": {
    "buckets": [
      {
        "name": "llama-3-1-8b-instant-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 30,
        "applies_to": "llama-3.1-8b-instant"
      },
      {
        "name": "llama-3-1-8b-instant-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 14400,
        "applies_to": "llama-3.1-8b-instant"
      },
      {
        "name": "llama-3-1-8b-instant-tpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "tokens",
        "value_hint": 6000,
        "applies_to": "llama-3.1-8b-instant"
      },
      {
        "name": "llama-3-1-8b-instant-tpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "tokens",
        "value_hint": 500000,
        "applies_to": "llama-3.1-8b-instant"
      },
      {
        "name": "llama-3-3-70b-versatile-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 30,
        "applies_to": "llama-3.3-70b-versatile"
      },
      {
        "name": "llama-3-3-70b-versatile-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 1000,
        "applies_to": "llama-3.3-70b-versatile"
      },
      {
        "name": "llama-3-3-70b-versatile-tpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "tokens",
        "value_hint": 12000,
        "applies_to": "llama-3.3-70b-versatile"
      },
      {
        "name": "llama-3-3-70b-versatile-tpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "tokens",
        "value_hint": 100000,
        "applies_to": "llama-3.3-70b-versatile"
      },
      {
        "name": "meta-llama-llama-4-scout-17b-16e-instruct-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 30,
        "applies_to": "meta-llama/llama-4-scout-17b-16e-instruct"
      },
      {
        "name": "meta-llama-llama-4-scout-17b-16e-instruct-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 1000,
        "applies_to": "meta-llama/llama-4-scout-17b-16e-instruct"
      },
      {
        "name": "meta-llama-llama-4-scout-17b-16e-instruct-tpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "tokens",
        "value_hint": 30000,
        "applies_to": "meta-llama/llama-4-scout-17b-16e-instruct"
      },
      {
        "name": "meta-llama-llama-4-scout-17b-16e-instruct-tpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "tokens",
        "value_hint": 500000,
        "applies_to": "meta-llama/llama-4-scout-17b-16e-instruct"
      },
      {
        "name": "meta-llama-llama-4-maverick-17b-128e-instruct-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 30,
        "applies_to": "meta-llama/llama-4-maverick-17b-128e-instruct"
      },
      {
        "name": "meta-llama-llama-4-maverick-17b-128e-instruct-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 1000,
        "applies_to": "meta-llama/llama-4-maverick-17b-128e-instruct"
      },
      {
        "name": "meta-llama-llama-4-maverick-17b-128e-instruct-tpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "tokens",
        "value_hint": 6000,
        "applies_to": "meta-llama/llama-4-maverick-17b-128e-instruct"
      },
      {
        "name": "meta-llama-llama-4-maverick-17b-128e-instruct-tpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "tokens",
        "value_hint": 500000,
        "applies_to": "meta-llama/llama-4-maverick-17b-128e-instruct"
      },
      {
        "name": "qwen-qwen3-32b-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 60,
        "applies_to": "qwen/qwen3-32b"
      },
      {
        "name": "qwen-qwen3-32b-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 1000,
        "applies_to": "qwen/qwen3-32b"
      },
      {
        "name": "qwen-qwen3-32b-tpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "tokens",
        "value_hint": 6000,
        "applies_to": "qwen/qwen3-32b"
      },
      {
        "name": "qwen-qwen3-32b-tpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "tokens",
        "value_hint": 500000,
        "applies_to": "qwen/qwen3-32b"
      },
      {
        "name": "openai-gpt-oss-120b-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 30,
        "applies_to": "openai/gpt-oss-120b"
      },
      {
        "name": "openai-gpt-oss-120b-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 1000,
        "applies_to": "openai/gpt-oss-120b"
      },
      {
        "name": "openai-gpt-oss-120b-tpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "tokens",
        "value_hint": 8000,
        "applies_to": "openai/gpt-oss-120b"
      },
      {
        "name": "openai-gpt-oss-120b-tpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "tokens",
        "value_hint": 200000,
        "applies_to": "openai/gpt-oss-120b"
      },
      {
        "name": "groq-compound-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 30,
        "applies_to": "groq/compound"
      },
      {
        "name": "groq-compound-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 250,
        "applies_to": "groq/compound"
      },
      {
        "name": "groq-compound-tpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "tokens",
        "value_hint": 70000,
        "applies_to": "groq/compound"
      },
      {
        "name": "whisper-large-v3-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 20,
        "applies_to": "whisper-large-v3"
      },
      {
        "name": "whisper-large-v3-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 2000,
        "applies_to": "whisper-large-v3"
      },
      {
        "name": "groq-default-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 30,
        "applies_to": "all"
      }
    ]
  },
  "cerebras": {
    "buckets": [
      {
        "name": "gpt-oss-120b-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 30,
        "applies_to": "gpt-oss-120b"
      },
      {
        "name": "gpt-oss-120b-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 14400,
        "applies_to": "gpt-oss-120b"
      },
      {
        "name": "gpt-oss-120b-tpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "tokens",
        "value_hint": 60000,
        "applies_to": "gpt-oss-120b"
      },
      {
        "name": "gpt-oss-120b-tpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "tokens",
        "value_hint": 1000000,
        "applies_to": "gpt-oss-120b"
      }
    ]
  },
  "cloudflare_workers_ai": {
    "buckets": [
      {
        "name": "-cf-microsoft-phi-2-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 720,
        "applies_to": "@cf/microsoft/phi-2"
      },
      {
        "name": "-cf-microsoft-phi-2-neurons",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "neurons",
        "value_hint": 10000,
        "applies_to": "@cf/microsoft/phi-2"
      },
      {
        "name": "global-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 300,
        "applies_to": "all"
      }
    ]
  },
  "github_models": {
    "buckets": [
      {
        "name": "tier-low-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 15,
        "applies_to": "tier:low"
      },
      {
        "name": "tier-low-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 150,
        "applies_to": "tier:low"
      }
    ]
  },
  "openrouter": {
    "buckets": [
      {
        "name": "openrouter-free-rpm",
        "window_type": "rolling",
        "window_seconds": 60,
        "unit": "requests",
        "value_hint": 20,
        "applies_to": "openrouter/free"
      },
      {
        "name": "openrouter-free-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 50,
        "applies_to": "openrouter/free"
      }
    ]
  },
  "github_copilot": {
    "buckets": [
      {
        "name": "copilot-free-requests_per_month",
        "window_type": "fixed_reset",
        "window_seconds": 2592000,
        "unit": "requests",
        "value_hint": 50,
        "applies_to": "copilot-free"
      }
    ]
  },
  "cursor": {
    "buckets": []
  },
  "amazon_q_developer": {
    "buckets": [
      {
        "name": "qdeveloper-free-requests_per_month",
        "window_type": "fixed_reset",
        "window_seconds": 2592000,
        "unit": "requests",
        "value_hint": 50,
        "applies_to": "qdeveloper-free"
      }
    ]
  },
  "kiro_ide": {
    "buckets": [
      {
        "name": "kiro-free-monthly_credits",
        "window_type": "fixed_reset",
        "window_seconds": 2592000,
        "unit": "credits",
        "value_hint": 50,
        "applies_to": "kiro-free"
      }
    ]
  },
  "vercel_v0": {
    "buckets": [
      {
        "name": "v0-free-rpd",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "requests",
        "value_hint": 7,
        "applies_to": "v0-free"
      },
      {
        "name": "v0-free-monthly_credits",
        "window_type": "fixed_reset",
        "window_seconds": 2592000,
        "unit": "credits",
        "value_hint": 5,
        "applies_to": "v0-free"
      }
    ]
  },
  "manus": {
    "buckets": [
      {
        "name": "manus-free-tokens",
        "window_type": "fixed_reset",
        "window_seconds": 86400,
        "unit": "tokens",
        "value_hint": 300,
        "applies_to": "manus-free"
      }
    ]
  },
  "antigravity_ide": {
    "buckets": []
  }
};
const defaultData = {
  providerConnections: [],
  providerNodes: [],
  modelAliases: {},
  combos: [],
  apiKeys: [],
  settings: { ...INITIAL_SETTINGS },

  pricing: {}, // pricing configuration
  routingPlaybooks: [], // NEW: routing playbooks
  rateLimitConfigs: DEFAULT_RATE_LIMITS, // NEW: rate limit configurations
  rateLimitState: {}, // NEW: persisted rate limit state
  p2pOffers: [], // NEW: marketplace offers from peers
  p2pSubscriptions: [], // NEW: active node-to-node subscriptions
  routingPools: [], // Named provider pools for grouped routing
  cachedModels: {},
  rateLimitSuggestions: [], // Recent 429 suggestions for auto-failover (last 20)
  communityPriceSubmissions: [], // Community-submitted pricing data (GasBuddy-style)
  priceHistory: [], // Historical pricing records for tracking price changes
  tokenBuddyContributors: {}, // Contributor profiles for TokenBuddy gamification
  pendingSubmissions: [], // Submissions awaiting community verification
  submissionVotes: {}, // Votes on pending submissions { submissionId: { upvotes: [], downvotes: [] } }
  previewModels: [], // Track preview/codename models that may become official
  rateLimitReports: [], // Community-reported rate limits per provider/model/tier
};

function cloneDefaultData() {
  return {
    providerConnections: [],
    providerNodes: [],
    modelAliases: {},
    combos: [],
    apiKeys: [],
    settings: { ...INITIAL_SETTINGS },
    pricing: {},
    routingPlaybooks: [...SMART_PLAYBOOKS],
    rateLimitConfigs: DEFAULT_RATE_LIMITS,
    rateLimitState: {},
    p2pOffers: [],
    p2pSubscriptions: [],
    routingPools: [],
    cachedModels: {},
    nodePricingConfig: {
      pricing_mode: "simple",
      margin_percent: 20,
      zip_usd_rate: 1,
      model_overrides: {},
    },
    meshExposedProviders: [],
    meshOfferedModels: [],
    nodeConnections: [],
    rateLimitSuggestions: [],
    serviceRegistryConfig: {
      enabled: false,
      node_id: "",
      region: "",
      rpc_url: "",
    },
    communityPriceSubmissions: [],
    priceHistory: [],
    tokenBuddyContributors: {},
    pendingSubmissions: [],
    submissionVotes: {},
    previewModels: [],
    rateLimitReports: [],
  };
}

function ensureDbShape(data) {
  const defaults = cloneDefaultData();
  const next = data && typeof data === "object" ? data : {};
  let changed = false;

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (next[key] === undefined || next[key] === null) {
      next[key] = defaultValue;
      changed = true;
      continue;
    }

    if (
      key === "settings" &&
      (typeof next.settings !== "object" || Array.isArray(next.settings))
    ) {
      next.settings = { ...defaultValue };
      changed = true;
      continue;
    }

    if (
      key === "settings" &&
      typeof next.settings === "object" &&
      !Array.isArray(next.settings)
    ) {
      for (const [settingKey, settingDefault] of Object.entries(defaultValue)) {
        if (next.settings[settingKey] === undefined) {
          next.settings[settingKey] = settingKey === "firstRun" ? false : settingDefault;
          changed = true;
        }
      }
    }
  }

  // Ensure default playbooks exist
  if (!next.routingPlaybooks) next.routingPlaybooks = [];

  for (const defaultPb of SMART_PLAYBOOKS) {
    if (!next.routingPlaybooks.find(p => p.id === defaultPb.id)) {
      next.routingPlaybooks.push({ ...defaultPb });
      changed = true;
    }
  }

  // Ensure P2P collections
  if (!next.p2pOffers) {
    next.p2pOffers = [];
    changed = true;
  }
  if (!next.p2pSubscriptions) {
    next.p2pSubscriptions = [];
    changed = true;
  }
  if (!next.routingPools) {
    next.routingPools = [];
    changed = true;
  }

  if (!next.nodePricingConfig || typeof next.nodePricingConfig !== "object") {
    next.nodePricingConfig = {
      pricing_mode: "simple",
      margin_percent: 20,
      zip_usd_rate: 1,
      model_overrides: {},
    };
    changed = true;
  }

  if (!Array.isArray(next.meshExposedProviders)) {
    next.meshExposedProviders = [];
    changed = true;
  }

  if (!Array.isArray(next.meshOfferedModels)) {
    next.meshOfferedModels = [];
    changed = true;
  }

  if (!Array.isArray(next.nodeConnections)) {
    next.nodeConnections = [];
    changed = true;
  }

  if (!next.serviceRegistryConfig || typeof next.serviceRegistryConfig !== "object") {
    next.serviceRegistryConfig = {
      enabled: false,
      node_id: "",
      region: "",
      rpc_url: "",
    };
    changed = true;
  }

  return { data: next, changed };
}

// Singleton instance
let dbInstance = null;

/**
 * Get database instance (singleton)
 */
export async function getDb() {
  if (isCloud) {
    // Return in-memory DB for Workers
    if (!dbInstance) {
      const data = cloneDefaultData();
      dbInstance = new Low({ read: async () => { }, write: async () => { } }, data);
      dbInstance.data = data;
    }
    return dbInstance;
  }

  if (!dbInstance) {
    const adapter = new JSONFile(DB_FILE);
    dbInstance = new Low(adapter, cloneDefaultData());
  }

  // Always read latest disk state to avoid stale singleton data across route workers.
  try {
    await dbInstance.read();
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn('[DB] Corrupt JSON detected, resetting to defaults...');
      dbInstance.data = cloneDefaultData();
      await dbInstance.write();
    } else {
      throw error;
    }
  }

  // Initialize/migrate missing keys for older DB schema versions.
  if (!dbInstance.data) {
    dbInstance.data = cloneDefaultData();
    await dbInstance.write();
  } else {
    const { data, changed } = ensureDbShape(dbInstance.data);
    dbInstance.data = data;
    if (changed) {
      await dbInstance.write();
    }
  }

  return dbInstance;
}

/**
 * Ensure SQLite is in sync with LowDB legacy data
 */
export async function ensureSqliteSync() {
  if (isCloud) return;
  const db = await getDb();
  const sqlite = getSqliteDb();

  // Check if we've already migrated
  const migratedKey = "sqlite_migrated_v1";
  if (db.data.settings[migratedKey]) return;

  console.log("[DB] Migrating Provider Connections to SQLite...");
  const insertConn = sqlite.prepare(`
    INSERT OR REPLACE INTO provider_connections (
      id, provider, authType, name, group_name, priority, isActive, isEnabled,
      email, accessToken, refreshToken, expiresAt, apiKey, testStatus,
      lastTested, lastError, lastErrorAt, rateLimitedUntil, metadata, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = sqlite.transaction((conns) => {
    for (const c of conns) {
      insertConn.run(
        c.id, c.provider, c.authType, c.name, c.group || 'default', c.priority || 1,
        c.isActive === false ? 0 : 1, c.isEnabled === false ? 0 : 1,
        c.email || null, c.accessToken || null, c.refreshToken || null, c.expiresAt || null,
        c.apiKey || null, c.testStatus || 'unknown', c.lastTested || null,
        c.lastError || null, c.lastErrorAt || null, c.rateLimitedUntil || null,
        c.metadata ? JSON.stringify(c.metadata) : (c.providerSpecificData ? JSON.stringify(c.providerSpecificData) : null),
        c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()
      );
    }
  });

  if (db.data.providerConnections && db.data.providerConnections.length > 0) {
    transaction(db.data.providerConnections);
  }

  console.log("[DB] Migrating Provider Nodes to SQLite...");
  const insertNode = sqlite.prepare(`
    INSERT OR REPLACE INTO provider_nodes (
      id, type, name, baseUrl, apiType, prefix, metadata, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const nodeTransaction = sqlite.transaction((nodes) => {
    for (const n of nodes) {
      insertNode.run(
        n.id, n.type, n.name || null, n.baseUrl || null, n.apiType || null, n.prefix || null,
        n.metadata ? JSON.stringify(n.metadata) : null,
        n.createdAt || new Date().toISOString(), n.updatedAt || new Date().toISOString()
      );
    }
  });

  if (db.data.providerNodes && db.data.providerNodes.length > 0) {
    nodeTransaction(db.data.providerNodes);
  }

  console.log("[DB] Migrating API Keys to SQLite...");
  const insertApiKey = sqlite.prepare(`
    INSERT OR REPLACE INTO router_api_keys (
      id, name, keyHash, scopes, createdAt, revoked
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const apiKeyTransaction = sqlite.transaction((keys) => {
    for (const k of keys) {
      // If we have a raw key but no hash, hash it. 
      // The old version stored raw keys as 'key'. The new version uses 'keyHash'.
      let hash = k.keyHash;
      if (!hash && k.key) {
        // Simple hash if bcrypt is not available synchronously in transaction, 
        // but here we can use bcrypt.hashSync since we imported it.
        try {
          const salt = bcrypt.genSaltSync(10);
          hash = bcrypt.hashSync(k.key, salt);
        } catch (e) {
          hash = k.key; // Fallback to raw if hashing fails (emergency only)
        }
      }

      insertApiKey.run(
        k.id || uuidv4(),
        k.name || "Legacy Key",
        hash || "missing-hash",
        k.scopes ? JSON.stringify(k.scopes) : "[]",
        k.createdAt || new Date().toISOString(),
        k.revoked ? 1 : 0
      );
    }
  });

  if (db.data.apiKeys && db.data.apiKeys.length > 0) {
    apiKeyTransaction(db.data.apiKeys);
  }

  // Mark as migrated
  db.data.settings[migratedKey] = true;
  await db.write();
  console.log("[DB] Migration to SQLite completed.");
}

// ============ Provider Connections ============

/**
 * Get all provider connections
 */
export async function getProviderConnections(filter = {}) {
  if (isCloud) {
    const db = await getDb();
    let connections = db.data.providerConnections || [];
    if (filter.provider) connections = connections.filter(c => c.provider === filter.provider);
    if (filter.group) connections = connections.filter(c => c.group === filter.group);
    if (filter.isActive !== undefined) connections = connections.filter(c => c.isActive === filter.isActive);
    connections.sort((a, b) => (a.priority || 999) - (b.priority || 999));
    return connections;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  let query = `SELECT * FROM provider_connections WHERE 1=1`;
  const params = [];

  if (filter.provider) {
    query += ` AND provider = ?`;
    params.push(filter.provider);
  }
  if (filter.group) {
    query += ` AND group_name = ?`;
    params.push(filter.group);
  }
  if (filter.isActive !== undefined) {
    query += ` AND isActive = ?`;
    params.push(filter.isActive ? 1 : 0);
  }
  if (filter.isEnabled !== undefined) {
    query += ` AND isEnabled = ?`;
    params.push(filter.isEnabled ? 1 : 0);
  }

  query += ` ORDER BY priority ASC`;

  const rows = sqlite.prepare(query).all(...params);

  const safeParse = (raw) => {
    if (raw == null || raw === "") return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  // Map back to JS objects
  return rows.map(r => ({
    ...r,
    group: r.group_name,
    isActive: r.isActive === 1,
    isEnabled: r.isEnabled === 1,
    metadata: safeParse(r.metadata),
    providerSpecificData: safeParse(r.metadata), // Backwards compatible
  }));
}

// ============ Provider Nodes ============

/**
 * Get provider nodes
 */
export async function getProviderNodes(filter = {}) {
  if (isCloud) {
    const db = await getDb();
    let nodes = db.data.providerNodes || [];
    if (filter.type) nodes = nodes.filter((node) => node.type === filter.type);
    return nodes;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  let query = `SELECT * FROM provider_nodes WHERE 1=1`;
  const params = [];

  if (filter.type) {
    query += ` AND type = ?`;
    params.push(filter.type);
  }

  const rows = sqlite.prepare(query).all(...params);
  return rows.map(r => ({
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));
}

/**
 * Get provider node by ID
 */
export async function getProviderNodeById(id) {
  if (isCloud) {
    const db = await getDb();
    return db.data.providerNodes.find((node) => node.id === id) || null;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const row = sqlite.prepare(`SELECT * FROM provider_nodes WHERE id = ?`).get(id);

  if (!row) return null;
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

/**
 * Create provider node
 */
export async function createProviderNode(data) {
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name || null,
    baseUrl: data.baseUrl || null,
    apiType: data.apiType || null,
    prefix: data.prefix || null,
    metadata: data.metadata || null,
    createdAt: now,
    updatedAt: now,
  };

  if (isCloud) {
    const db = await getDb();
    if (!db.data.providerNodes) db.data.providerNodes = [];
    db.data.providerNodes.push(node);
    await db.write();
    // Sync local provider connection for unified routing
    if (node.type === "local") {
      await syncLocalProviderConnection(node);
    }
    return node;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  sqlite.prepare(`
    INSERT INTO provider_nodes (id, type, name, wallet_id, baseUrl, apiType, prefix, metadata, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id, node.type, node.name, data.wallet_id || null, node.baseUrl, node.apiType, node.prefix,
    node.metadata ? JSON.stringify(node.metadata) : null,
    node.createdAt, node.updatedAt
  );

  // Sync local provider connection for unified routing
  if (node.type === "local") {
    await syncLocalProviderConnection(node);
  }

  return node;
}

/**
 * Update provider node
 */
export async function updateProviderNode(id, data) {
  const now = new Date().toISOString();

  if (isCloud) {
    const db = await getDb();
    if (!db.data.providerNodes) db.data.providerNodes = [];
    const index = db.data.providerNodes.findIndex((node) => node.id === id);
    if (index === -1) return null;
    db.data.providerNodes[index] = { ...db.data.providerNodes[index], ...data, updatedAt: now };
    await db.write();
    // Sync local provider connection if this is a local node
    const updatedNode = db.data.providerNodes[index];
    if (updatedNode.type === "local") {
      await syncLocalProviderConnection(updatedNode);
    }
    return updatedNode;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const existing = await getProviderNodeById(id);
  if (!existing) return null;

  const fields = [];
  const params = [];

  for (const [key, value] of Object.entries(data)) {
    if (key === "id") continue;
    fields.push(`${key} = ?`);
    params.push(key === "metadata" ? JSON.stringify(value) : value);
  }

  fields.push(`updatedAt = ?`);
  params.push(now);
  params.push(id);

  sqlite.prepare(`UPDATE provider_nodes SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  const updatedNode = await getProviderNodeById(id);
  // Sync local provider connection if this is a local node
  if (updatedNode && updatedNode.type === "local") {
    await syncLocalProviderConnection(updatedNode);
  }
  return updatedNode;
}

/**
 * Delete provider node
 */
export async function deleteProviderNode(id) {
  if (isCloud) {
    const db = await getDb();
    if (!db.data.providerNodes) db.data.providerNodes = [];
    const index = db.data.providerNodes.findIndex((node) => node.id === id);
    if (index === -1) return null;
    const removed = db.data.providerNodes.splice(index, 1);
    // Clean up auto-managed connections for local nodes
    if (removed[0] && removed[0].type === "local") {
      await removeLocalProviderConnections(id);
    }
    await db.write();
    return removed[0];
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const existing = await getProviderNodeById(id);
  if (!existing) return null;

  // Clean up auto-managed connections for local nodes
  if (existing.type === "local") {
    await removeLocalProviderConnections(id);
  }

  sqlite.prepare(`DELETE FROM provider_connections WHERE provider = ?`).run(id);
  sqlite.prepare(`DELETE FROM provider_nodes WHERE id = ?`).run(id);

  return existing;
}

// ============ Wallets ============

/**
 * Get all wallets
 */
export async function getWallets() {
  if (isCloud) return [];

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const rows = sqlite.prepare(`SELECT * FROM wallets ORDER BY createdAt DESC`).all();

  return rows.map(r => ({
    ...r,
    isDefault: r.isDefault === 1,
    metadata: r.metadata ? JSON.parse(r.metadata) : null
  }));
}

/**
 * Get wallet by ID
 */
export async function getWalletById(id) {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const row = sqlite.prepare(`SELECT * FROM wallets WHERE id = ?`).get(id);

  if (!row) return null;
  return {
    ...row,
    isDefault: row.isDefault === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : null
  };
}

/**
 * Get wallet by address
 */
export async function getWalletByAddress(address) {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const row = sqlite.prepare(`SELECT * FROM wallets WHERE address = ?`).get(address);

  if (!row) return null;
  return {
    ...row,
    isDefault: row.isDefault === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : null
  };
}

/**
 * Create a new wallet
 */
export async function createWallet(data) {
  const now = new Date().toISOString();
  const wallet = {
    id: data.id || uuidv4(),
    name: data.name,
    address: data.address,
    encryptedPrivateKey: data.encryptedPrivateKey || null,
    type: data.type || 'imported',
    balance: data.balance || 0,
    isDefault: data.isDefault ? 1 : 0,
    metadata: data.metadata || null,
    createdAt: now,
    updatedAt: now
  };

  if (isCloud) return wallet;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  // Handle default flag
  if (wallet.isDefault) {
    sqlite.prepare(`UPDATE wallets SET isDefault = 0`).run();
  }

  sqlite.prepare(`
    INSERT INTO wallets (id, name, address, encryptedPrivateKey, type, balance, isDefault, metadata, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wallet.id, wallet.name, wallet.address, wallet.encryptedPrivateKey,
    wallet.type, wallet.balance, wallet.isDefault,
    wallet.metadata ? JSON.stringify(wallet.metadata) : null,
    wallet.createdAt, wallet.updatedAt
  );

  return { ...wallet, isDefault: wallet.isDefault === 1 };
}

/**
 * Update wallet
 */
export async function updateWallet(id, data) {
  const now = new Date().toISOString();

  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const existing = await getWalletById(id);
  if (!existing) return null;

  if (data.isDefault) {
    sqlite.prepare(`UPDATE wallets SET isDefault = 0`).run();
  }

  const fields = [];
  const params = [];

  for (const [key, value] of Object.entries(data)) {
    if (key === "id") continue;
    fields.push(`${key} = ?`);
    params.push(key === "metadata" || key === "isDefault" ?
      (key === "metadata" ? JSON.stringify(value) : (value ? 1 : 0)) : value);
  }

  fields.push(`updatedAt = ?`);
  params.push(now);
  params.push(id);

  sqlite.prepare(`UPDATE wallets SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return await getWalletById(id);
}

/**
 * Delete wallet
 */
export async function deleteWallet(id) {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const existing = await getWalletById(id);
  if (!existing) return null;

  sqlite.prepare(`DELETE FROM wallet_transactions WHERE wallet_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM wallets WHERE id = ?`).run(id);

  return existing;
}

/**
 * Get wallet transactions
 */
export async function getWalletTransactions(walletId) {
  if (isCloud) return [];

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const rows = sqlite.prepare(`SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY timestamp DESC`).all(walletId);

  return rows.map(r => ({
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : null
  }));
}

/**
 * Add wallet transaction
 */
export async function addWalletTransaction(data) {
  const now = new Date().toISOString();
  const tx = {
    id: data.id || uuidv4(),
    wallet_id: data.wallet_id,
    type: data.type,
    amount: data.amount,
    symbol: data.symbol || 'ZIPc',
    status: data.status || 'confirmed',
    counterparty: data.counterparty || null,
    txHash: data.txHash || null,
    description: data.description || "",
    timestamp: data.timestamp || now,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null
  };

  if (isCloud) return tx;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  sqlite.prepare(`
    INSERT INTO wallet_transactions (id, wallet_id, type, amount, symbol, status, counterparty, txHash, description, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tx.id, tx.wallet_id, tx.type, tx.amount, tx.symbol, tx.status,
    tx.counterparty, tx.txHash, tx.description, tx.timestamp, tx.metadata
  );

  return tx;
}

/**
 * Delete all provider connections by provider ID
 */
export async function deleteProviderConnectionsByProvider(providerId) {
  if (isCloud) {
    const db = await getDb();
    const beforeCount = db.data.providerConnections.length;
    db.data.providerConnections = db.data.providerConnections.filter(
      (connection) => connection.provider !== providerId
    );
    const deletedCount = beforeCount - db.data.providerConnections.length;
    await db.write();
    return deletedCount;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const result = sqlite.prepare(`DELETE FROM provider_connections WHERE provider = ?`).run(providerId);
  return result.changes;
}

/**
 * Get provider connection by ID
 */
export async function getProviderConnectionById(id) {
  if (isCloud) {
    const db = await getDb();
    return db.data.providerConnections.find(c => c.id === id) || null;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const row = sqlite.prepare(`SELECT * FROM provider_connections WHERE id = ?`).get(id);

  if (!row) return null;
  return {
    ...row,
    group: row.group_name,
    isActive: row.isActive === 1,
    isEnabled: row.isEnabled === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    providerSpecificData: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

/**
 * Create or update provider connection (upsert by provider + email/name)
 */
export async function createProviderConnection(data) {
  const now = new Date().toISOString();

  if (isCloud) {
    const db = await getDb();
    // Simplified logic for Cloud
    let existingIndex = -1;
    if (data.connectionId) {
      existingIndex = db.data.providerConnections.findIndex(c => c.id === data.connectionId);
    }
    if (existingIndex !== -1) {
      db.data.providerConnections[existingIndex] = { ...db.data.providerConnections[existingIndex], ...data, updatedAt: now };
    } else {
      const conn = { id: uuidv4(), ...data, createdAt: now, updatedAt: now };
      db.data.providerConnections.push(conn);
    }
    await db.write();
    return data;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  // Check for existing connection
  let existing = null;
  if (data.connectionId) {
    existing = await getProviderConnectionById(data.connectionId);
  } else if (data.authType === "oauth" && data.email) {
    existing = sqlite.prepare(`SELECT * FROM provider_connections WHERE provider = ? AND authType = 'oauth' AND email = ?`).get(data.provider, data.email);
  } else if (data.authType === "apikey" && data.name) {
    existing = sqlite.prepare(`SELECT * FROM provider_connections WHERE provider = ? AND authType = 'apikey' AND name = ?`).get(data.provider, data.name);
  }

  if (existing) {
    return await updateProviderConnection(existing.id, data);
  }

  // Create new
  let name = data.name || (data.email ? data.email : null);
  if (!name && data.authType === "oauth") {
    const count = sqlite.prepare(`SELECT COUNT(*) as count FROM provider_connections WHERE provider = ?`).get(data.provider).count;
    name = `Account ${count + 1}`;
  }

  let priority = data.priority;
  if (!priority) {
    const max = sqlite.prepare(`SELECT MAX(priority) as max FROM provider_connections WHERE provider = ?`).get(data.provider).max;
    priority = (max || 0) + 1;
  }

  const id = uuidv4();
  const metadata = data.metadata || data.providerSpecificData || {};

  const insertConnection = () => sqlite.prepare(`
    INSERT INTO provider_connections (
      id, provider, authType, name, wallet_id, group_name, priority, isActive, isEnabled,
      email, accessToken, refreshToken, expiresAt, apiKey, createdAt, updatedAt, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.provider, data.authType || "oauth", name, data.wallet_id || null, data.group || "default",
    priority, data.isActive === false ? 0 : 1, data.isEnabled === false ? 0 : 1,
    data.email || null, data.accessToken || null, data.refreshToken || null,
    data.expiresAt || null, data.apiKey || null, now, now, JSON.stringify(metadata)
  );

  try {
    insertConnection();
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("no column named wallet_id")) {
      throw error;
    }
    // Defensive self-heal for legacy tables created before wallet_id migration.
    ensureWalletColumns(sqlite);
    insertConnection();
  }

  await reorderProviderConnections(data.provider);
  const created = await getProviderConnectionById(id);
  await emitProviderLifecycleEvent("provider.connect", {
    provider: created?.provider || data.provider || "unknown",
    connectionId: created?.id || id,
    detail: {
      authType: created?.authType || data.authType || "oauth",
      isActive: created?.isActive !== false,
      isEnabled: created?.isEnabled !== false,
    },
  });
  return created;
}

/**
 * Update provider connection
 */
export async function updateProviderConnection(id, data) {
  const now = new Date().toISOString();

  if (isCloud) {
    const db = await getDb();
    const index = db.data.providerConnections.findIndex(c => c.id === id);
    if (index === -1) return null;
    db.data.providerConnections[index] = { ...db.data.providerConnections[index], ...data, updatedAt: now };
    await db.write();
    return db.data.providerConnections[index];
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const existing = await getProviderConnectionById(id);
  if (!existing) return null;

  const fields = [];
  const params = [];

  const mapping = {
    group: "group_name",
    isActive: "isActive",
    isEnabled: "isEnabled",
    metadata: "metadata",
    providerSpecificData: "metadata"
  };

  for (const [key, value] of Object.entries(data)) {
    if (key === "id" || key === "connectionId") continue;

    const dbKey = mapping[key] || key;

    // Skip fields that aren't in the schema
    const validFields = [
      "provider", "authType", "name", "wallet_id", "group_name", "priority", "isActive", "isEnabled",
      "email", "accessToken", "refreshToken", "expiresAt", "apiKey", "testStatus",
      "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "metadata", "updatedAt"
    ];

    if (!validFields.includes(dbKey)) continue;

    fields.push(`${dbKey} = ?`);

    if (dbKey === "isActive" || dbKey === "isEnabled") {
      params.push(value ? 1 : 0);
    } else if (dbKey === "metadata") {
      params.push(JSON.stringify(value));
    } else {
      params.push(value);
    }
  }

  if (fields.length === 0) return existing;

  fields.push(`updatedAt = ?`);
  params.push(now);
  params.push(id);

  sqlite.prepare(`UPDATE provider_connections SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  if (data.priority !== undefined) {
    await reorderProviderConnections(existing.provider);
  }

  const updated = await getProviderConnectionById(id);
  const hadError = !!(existing?.lastError || existing?.testStatus === "error");
  const hasError = !!(updated?.lastError || updated?.testStatus === "error");
  const touchedCredential =
    data.accessToken !== undefined ||
    data.refreshToken !== undefined ||
    data.apiKey !== undefined ||
    data.expiresAt !== undefined;

  if (touchedCredential) {
    await emitProviderLifecycleEvent("provider.refresh", {
      provider: updated?.provider || existing?.provider || "unknown",
      connectionId: updated?.id || id,
      detail: { source: "connection_update" },
    });
  }
  if (!hadError && hasError) {
    await emitProviderLifecycleEvent("provider.fail", {
      provider: updated?.provider || existing?.provider || "unknown",
      connectionId: updated?.id || id,
      status: 500,
      detail: {
        lastError: updated?.lastError || data.lastError || "connection error",
      },
    });
  }
  if (hadError && !hasError) {
    await emitProviderLifecycleEvent("provider.recover", {
      provider: updated?.provider || existing?.provider || "unknown",
      connectionId: updated?.id || id,
      status: 200,
      detail: { source: "connection_update" },
    });
  }

  return updated;
}

/**
 * Delete provider connection
 */
export async function deleteProviderConnection(id) {
  if (isCloud) {
    const db = await getDb();
    const index = db.data.providerConnections.findIndex(c => c.id === id);
    if (index === -1) return false;
    const providerId = db.data.providerConnections[index].provider;
    db.data.providerConnections.splice(index, 1);
    await db.write();
    return true;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const existing = await getProviderConnectionById(id);
  if (!existing) return false;

  sqlite.prepare(`DELETE FROM provider_connections WHERE id = ?`).run(id);
  await reorderProviderConnections(existing.provider);
  await emitProviderLifecycleEvent("provider.disconnect", {
    provider: existing.provider || "unknown",
    connectionId: existing.id || id,
  });

  return true;
}

/**
 * Reorder provider connections to ensure unique, sequential priorities
 */
export async function reorderProviderConnections(providerId) {
  if (isCloud) {
    const db = await getDb();
    if (!db.data.providerConnections) return;
    const providerConnections = db.data.providerConnections
      .filter(c => c.provider === providerId)
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    providerConnections.forEach((conn, index) => { conn.priority = index + 1; });
    await db.write();
    return;
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const connections = await getProviderConnections({ provider: providerId });

  const update = sqlite.prepare(`UPDATE provider_connections SET priority = ? WHERE id = ?`);
  const transaction = sqlite.transaction((conns) => {
    conns.forEach((c, i) => {
      update.run(i + 1, c.id);
    });
  });

  transaction(connections);
}

// ============ Model Aliases ============

/**
 * Get all model aliases
 */
export async function getModelAliases() {
  const db = await getDb();
  return db.data.modelAliases || {};
}

/**
 * Set model alias
 */
export async function setModelAlias(alias, model) {
  const db = await getDb();
  db.data.modelAliases[alias] = model;
  await db.write();
}

/**
 * Delete model alias
 */
export async function deleteModelAlias(alias) {
  const db = await getDb();
  delete db.data.modelAliases[alias];
  await db.write();
}

// ============ Combos ============

/**
 * Get all combos
 */
export async function getCombos() {
  const db = await getDb();
  return db.data.combos || [];
}

/**
 * Get combo by ID
 */
export async function getComboById(id) {
  const db = await getDb();
  return (db.data.combos || []).find(c => c.id === id) || null;
}

/**
 * Get combo by name
 */
export async function getComboByName(name) {
  const db = await getDb();
  return (db.data.combos || []).find(c => c.name === name) || null;
}

/**
 * Create combo
 */
export async function createCombo(data) {
  const db = await getDb();
  if (!db.data.combos) db.data.combos = [];

  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };

  db.data.combos.push(combo);
  await db.write();
  return combo;
}

/**
 * Update combo
 */
export async function updateCombo(id, data) {
  const db = await getDb();
  if (!db.data.combos) db.data.combos = [];

  const index = db.data.combos.findIndex(c => c.id === id);
  if (index === -1) return null;

  db.data.combos[index] = {
    ...db.data.combos[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await db.write();
  return db.data.combos[index];
}

/**
 * Delete combo
 */
export async function deleteCombo(id) {
  const db = await getDb();
  if (!db.data.combos) return false;

  const index = db.data.combos.findIndex(c => c.id === id);
  if (index === -1) return false;

  db.data.combos.splice(index, 1);
  await db.write();
  return true;
}

// ============ API Keys ============

/**
 * Get all API keys
 */
export async function getApiKeys() {
  const db = await getDb();
  return db.data.apiKeys || [];
}

/**
 * Generate short random key (8 chars)
 */
function generateShortKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create API key
 * @param {string} name - Key name
 * @param {string} machineId - MachineId (required)
 */
export async function createApiKey(name, machineId) {
  if (!machineId) {
    throw new Error("machineId is required");
  }

  const db = await getDb();
  const now = new Date().toISOString();

  // Always use new format: sk-{machineId}-{keyId}-{crc8}
  const { generateApiKeyWithMachine } = await import("../shared/utils/apiKey.js");
  const result = generateApiKeyWithMachine(machineId);

  const apiKey = {
    id: uuidv4(),
    name: name,
    key: result.key,
    machineId: machineId,
    createdAt: now,
  };

  db.data.apiKeys.push(apiKey);
  await db.write();

  return apiKey;
}

/**
 * Delete API key
 */
export async function deleteApiKey(id) {
  const db = await getDb();
  const index = db.data.apiKeys.findIndex(k => k.id === id);

  if (index === -1) return false;

  db.data.apiKeys.splice(index, 1);
  await db.write();

  return true;
}

/**
 * Validate API key
 */
export async function validateApiKey(key) {
  const db = await getDb();
  return db.data.apiKeys.some(k => k.key === key);
}

// ============ Data Cleanup ============

/**
 * Remove null/empty fields from all provider connections to reduce db size
 */
export async function cleanupProviderConnections() {
  const db = await getDb();
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "idToken", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount"
  ];

  let cleaned = 0;
  for (const connection of db.data.providerConnections) {
    for (const field of fieldsToCheck) {
      if (connection[field] === null || connection[field] === undefined) {
        delete connection[field];
        cleaned++;
      }
    }
    // Remove empty providerSpecificData
    if (connection.providerSpecificData && Object.keys(connection.providerSpecificData).length === 0) {
      delete connection.providerSpecificData;
      cleaned++;
    }
  }

  if (cleaned > 0) {
    await db.write();
  }
  return cleaned;
}

// ============ Settings ============

/**
 * Get settings
 */
export async function getSettings() {
  await ensureSqliteSync(); // Ensure migration has run
  const db = await getDb();
  return db.data.settings || { cloudEnabled: false };
}

/**
 * Update settings
 */
export async function updateSettings(updates) {
  const db = await getDb();
  db.data.settings = {
    ...db.data.settings,
    ...updates
  };
  await db.write();
  return db.data.settings;
}



/**
 * Get first-run flag (true = setup wizard not yet completed)
 */
export async function getFirstRun() {
  const settings = await getSettings();
  return settings.firstRun === true;
}

/**
 * Mark setup wizard as completed
 */
export async function setFirstRunCompleted() {
  return updateSettings({ firstRun: false });
}

// ============ Router API Keys ============

/**
 * Create a new router API key
 * @param {{name?:string, scopes?:string[], expiresAt?:string}} opts
 * @returns {{id:string, rawKey:string}}
 */
export async function createRouterApiKey(opts = {}) {
  const db = await getDb();
  const id = uuidv4();
  let machineId = null;
  try {
    const { getConsistentMachineId } = await import("../shared/utils/machineId.js");
    machineId = await getConsistentMachineId();
  } catch (_) { /* optional */ }
  const rawKey = Buffer.from(uuidv4() + uuidv4()).toString("base64");
  const salt = await bcrypt.genSalt(10);
  const keyHash = await bcrypt.hash(rawKey, salt);

  const record = {
    id,
    name: opts.name || null,
    keyHash,
    machineId: machineId || undefined,
    scopes: opts.scopes ? JSON.stringify(opts.scopes) : null,
    createdAt: new Date().toISOString(),
    expiresAt: opts.expiresAt || null,
    revoked: false
  };
  if (!db.data.routerApiKeys) db.data.routerApiKeys = [];
  db.data.routerApiKeys.push(record);
  await db.write();
  return { id, rawKey };
}

export async function listRouterApiKeys() {
  const db = await getDb();
  return db.data.routerApiKeys || [];
}

export async function getRouterApiKey(id) {
  const db = await getDb();
  return (db.data.routerApiKeys || []).find(k => k.id === id) || null;
}

export async function revokeRouterApiKey(id) {
  const db = await getDb();
  const keys = db.data.routerApiKeys || [];
  const idx = keys.findIndex(k => k.id === id);
  if (idx === -1) return false;
  keys[idx].revoked = true;
  await db.write();
  return true;
}

export async function verifyRouterApiKey(rawKey) {
  if (!rawKey) return { valid: false };
  const db = await getDb();
  const settings = db.data.settings || {};
  const enforceDevice = settings.enforceDeviceIdVerification === true;
  let currentMachineId = null;
  if (enforceDevice) {
    try {
      const { getConsistentMachineId } = await import("../shared/utils/machineId.js");
      currentMachineId = await getConsistentMachineId();
    } catch (_) { /* skip device check on error */ }
  }
  const keys = db.data.routerApiKeys || [];
  const now = Date.now();

  for (const rec of keys) {
    if (rec.revoked) continue;
    if (rec.expiresAt && new Date(rec.expiresAt).getTime() < now) continue;
    if (enforceDevice && currentMachineId && rec.machineId && rec.machineId !== currentMachineId) continue;
    const match = await bcrypt.compare(rawKey, rec.keyHash);
    if (match) {
      return { valid: true, scopes: rec.scopes ? JSON.parse(rec.scopes) : [] };
    }
  }
  return { valid: false };
}

// ============ Blacklist ============

export async function addBlacklistEntry(type, value, reason = null) {
  const db = await getDb();
  const entry = {
    id: uuidv4(),
    type,
    value,
    reason,
    createdAt: new Date().toISOString()
  };
  if (!db.data.blacklist) db.data.blacklist = [];
  db.data.blacklist.push(entry);
  await db.write();

  // if we're blacklisting an IP on the host, also update firewall
  if (type === "ip") {
    try {
      await firewallBlacklistIp(value);
    } catch (e) {
      console.error("Failed to update host firewall for blacklisted IP", e);
    }
  }

  return entry;
}

export async function isBlacklisted(type, value) {
  const db = await getDb();
  const list = db.data.blacklist || [];
  return list.some(e => e.type === type && e.value === value);
}

/**
 * Check if cloud is enabled
 */
export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

/**
 * Get node identity keys (generate if not existing)
 */
export async function getNodeIdentity() {
  const db = await getDb();
  let identity = db.data.settings?.nodeIdentity;

  if (!identity) {
    // Generate new key pair
    const { generateKeyPair } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const generate = promisify(generateKeyPair);

    const { publicKey, privateKey } = await generate("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    identity = {
      publicKey,
      privateKey,
      createdAt: new Date().toISOString()
    };

    db.data.settings.nodeIdentity = identity;
    await db.write();
  }

  // Include the default wallet address if available
  const defaultWallet = await getNodeWallet();
  if (defaultWallet) {
    identity = { ...identity, walletAddress: defaultWallet.address, walletId: defaultWallet.id };
  }

  return identity;
}

/**
 * Get the default/primary wallet for this node
 */
export async function getNodeWallet() {
  if (isCloud) return null;
  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  // Try to find the default wallet first
  let wallet = sqlite.prepare(`SELECT * FROM wallets WHERE isDefault = 1`).get();

  // If no default, take the first one created
  if (!wallet) {
    wallet = sqlite.prepare(`SELECT * FROM wallets ORDER BY createdAt ASC LIMIT 1`).get();
  }

  if (!wallet) return null;

  return {
    ...wallet,
    isDefault: wallet.isDefault === 1,
    metadata: wallet.metadata ? JSON.parse(wallet.metadata) : null
  };
}

// ============ Pricing ============

/**
 * Get pricing configuration
 * Returns merged user pricing with defaults
 */
export async function getPricing() {
  const db = await getDb();
  const userPricing = db.data.pricing || {};

  // Import default pricing
  const { getDefaultPricing } = await import("../shared/constants/pricing.js");
  const defaultPricing = getDefaultPricing();

  // Merge user pricing with defaults
  // User pricing overrides defaults for specific provider/model combinations
  const mergedPricing = {};

  for (const [provider, models] of Object.entries(defaultPricing)) {
    mergedPricing[provider] = { ...models };

    // Apply user overrides if they exist
    if (userPricing[provider]) {
      for (const [model, pricing] of Object.entries(userPricing[provider])) {
        if (mergedPricing[provider][model]) {
          mergedPricing[provider][model] = { ...mergedPricing[provider][model], ...pricing };
        } else {
          mergedPricing[provider][model] = pricing;
        }
      }
    }
  }

  // Add any user-only pricing entries
  for (const [provider, models] of Object.entries(userPricing)) {
    if (!mergedPricing[provider]) {
      mergedPricing[provider] = { ...models };
    } else {
      for (const [model, pricing] of Object.entries(models)) {
        if (!mergedPricing[provider][model]) {
          mergedPricing[provider][model] = pricing;
        }
      }
    }
  }

  return mergedPricing;
}

/**
 * Get node pricing config (mode, margin, model overrides)
 */
export async function getNodePricingConfig() {
  const db = await getDb();
  return db.data.nodePricingConfig || {
    pricing_mode: "simple",
    margin_percent: 20,
    zip_usd_rate: 1,
    model_overrides: {},
  };
}

/**
 * Set node pricing config
 */
export async function setNodePricingConfig(config) {
  const db = await getDb();
  db.data.nodePricingConfig = {
    ...(db.data.nodePricingConfig || {}),
    ...config,
    model_overrides: config.model_overrides ?? db.data.nodePricingConfig?.model_overrides ?? {},
  };
  await db.write();
  return db.data.nodePricingConfig;
}

/**
 * Get mesh-exposed providers (provider node IDs and local runtime IDs)
 */
export async function getMeshExposedProviders() {
  const db = await getDb();
  return db.data.meshExposedProviders || [];
}

/**
 * Set mesh-exposed providers
 */
export async function setMeshExposedProviders(providers) {
  const db = await getDb();
  db.data.meshExposedProviders = Array.isArray(providers) ? providers : [];
  await db.write();
  return db.data.meshExposedProviders;
}

/**
 * Get mesh-offered models (per-model monetization config; provider not exposed to mesh)
 */
export async function getMeshOfferedModels() {
  const db = await getDb();
  return db.data.meshOfferedModels || [];
}

/**
 * Set mesh-offered models
 */
export async function setMeshOfferedModels(models) {
  const db = await getDb();
  db.data.meshOfferedModels = Array.isArray(models) ? models : [];
  await db.write();
  return db.data.meshOfferedModels;
}

/**
 * Get node-to-node connections (peer_id, wallet_ids, contract_terms)
 */
export async function getNodeConnections() {
  const db = await getDb();
  return db.data.nodeConnections || [];
}

/**
 * Set node connections
 */
export async function setNodeConnections(connections) {
  const db = await getDb();
  db.data.nodeConnections = Array.isArray(connections) ? connections : [];
  await db.write();
  return db.data.nodeConnections;
}

/**
 * Update a single node connection
 */
export async function updateNodeConnection(peerId, updates) {
  const db = await getDb();
  const conns = db.data.nodeConnections || [];
  const idx = conns.findIndex((c) => c.peer_id === peerId);
  if (idx >= 0) {
    conns[idx] = { ...conns[idx], ...updates };
  } else {
    conns.push({ peer_id: peerId, wallet_ids: [], contract_terms: null, ...updates });
  }
  db.data.nodeConnections = conns;
  await db.write();
  return db.data.nodeConnections.find((c) => c.peer_id === peerId);
}

/**
 * Get ServiceRegistry config (for ZippyCoin integration)
 */
export async function getServiceRegistryConfig() {
  const db = await getDb();
  return db.data.serviceRegistryConfig || {
    enabled: false,
    node_id: "",
    region: "",
    rpc_url: "",
  };
}

/**
 * Set ServiceRegistry config
 */
export async function setServiceRegistryConfig(config) {
  const db = await getDb();
  db.data.serviceRegistryConfig = { ...(db.data.serviceRegistryConfig || {}), ...config };
  await db.write();
  return db.data.serviceRegistryConfig;
}

/**
 * Get pricing for a specific provider and model, optionally by tier.
 * Lookup order:
 *   1. pricing[provider][model:tier] (if tier provided)
 *   2. pricing[provider][model]
 *   3. pricing[alias][model:tier] (if alias exists and tier provided)
 *   4. pricing[alias][model] (if alias exists)
 * @param {string} provider - Provider ID
 * @param {string} model - Model ID
 * @param {string|null} tier - Optional subscription tier (e.g. "free", "pro")
 */
export async function getPricingForModel(provider, model, tier = null) {
  const pricing = await getPricing();

  // Helper to check tier-specific then fallback to base
  const findPricing = (providerKey) => {
    if (!pricing[providerKey]) return null;
    if (tier) {
      const tierKey = `${model}:${tier}`;
      if (pricing[providerKey][tierKey]) {
        return pricing[providerKey][tierKey];
      }
    }
    return pricing[providerKey][model] || null;
  };

  // Try direct lookup
  const direct = findPricing(provider);
  if (direct) return direct;

  // Try mapping provider ID to alias
  const alias = PROVIDER_ID_TO_ALIAS[provider];
  if (alias) {
    return findPricing(alias);
  }

  return null;
}

/**
 * Update pricing configuration
 * @param {object} pricingData - New pricing data to merge
 */
export async function updatePricing(pricingData) {
  const db = await getDb();

  // Ensure pricing object exists
  if (!db.data.pricing) {
    db.data.pricing = {};
  }

  // Merge new pricing data
  for (const [provider, models] of Object.entries(pricingData)) {
    if (!db.data.pricing[provider]) {
      db.data.pricing[provider] = {};
    }

    for (const [model, pricing] of Object.entries(models)) {
      db.data.pricing[provider][model] = pricing;
    }
  }

  await db.write();
  return db.data.pricing;
}

/**
 * Reset pricing to defaults for specific provider/model
 * @param {string} provider - Provider ID
 * @param {string} model - Model ID (optional, if not provided resets entire provider)
 */
export async function resetPricing(provider, model) {
  const db = await getDb();

  if (!db.data.pricing) {
    db.data.pricing = {};
  }

  if (model) {
    // Reset specific model
    if (db.data.pricing[provider]) {
      delete db.data.pricing[provider][model];
      // Clean up empty provider objects
      if (Object.keys(db.data.pricing[provider]).length === 0) {
        delete db.data.pricing[provider];
      }
    }
  } else {
    // Reset entire provider
    delete db.data.pricing[provider];
  }

  await db.write();
  return db.data.pricing;
}

/**
 * Reset all pricing to defaults
 */
export async function resetAllPricing() {
  const db = await getDb();
  db.data.pricing = {};
  await db.write();
  return db.data.pricing;
}

// ============ Routing Playbooks ============

/**
 * Get all routing playbooks
 */
export async function getRoutingPlaybooks() {
  const db = await getDb();
  return db.data.routingPlaybooks || [];
}

/**
 * Get routing playbook by ID
 */
export async function getRoutingPlaybookById(id) {
  const db = await getDb();
  return (db.data.routingPlaybooks || []).find(p => p.id === id) || null;
}

/**
 * Create routing playbook
 */
export async function createRoutingPlaybook(data) {
  const db = await getDb();
  if (!db.data.routingPlaybooks) db.data.routingPlaybooks = [];

  const now = new Date().toISOString();
  const playbook = {
    id: uuidv4(),
    name: data.name,
    description: data.description || "",
    trigger: data.trigger || null,
    intent: data.intent || null,
    rules: data.rules || [], // Array of rule objects
    isActive: data.isActive !== undefined ? data.isActive : true,
    priority: data.priority || 0,
    metadata: data.metadata || null,
    createdAt: now,
    updatedAt: now,
  };

  db.data.routingPlaybooks.push(playbook);
  await db.write();
  return playbook;
}

/**
 * Update routing playbook
 */
export async function updateRoutingPlaybook(id, data) {
  const db = await getDb();
  if (!db.data.routingPlaybooks) db.data.routingPlaybooks = [];

  const index = db.data.routingPlaybooks.findIndex(p => p.id === id);
  if (index === -1) return null;

  db.data.routingPlaybooks[index] = {
    ...db.data.routingPlaybooks[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await db.write();
  return db.data.routingPlaybooks[index];
}

/**
 * Delete routing playbook
 */
export async function deleteRoutingPlaybook(id) {
  const db = await getDb();
  if (!db.data.routingPlaybooks) return false;

  const index = db.data.routingPlaybooks.findIndex(p => p.id === id);
  if (index === -1) return false;

  db.data.routingPlaybooks.splice(index, 1);
  await db.write();
  return true;
}

// ============ Rate Limit Configs ============

/**
 * Get all rate limit configs
 */
export async function getRateLimitConfigs() {
  const db = await getDb();
  return db.data.rateLimitConfigs || {};
}

/**
 * Get rate limit config for a provider
 */
export async function getRateLimitConfig(providerId) {
  const db = await getDb();
  return (db.data.rateLimitConfigs || {})[providerId] || null;
}

/**
 * Update rate limit config for a provider
 * @param {string} providerId
 * @param {object} config - The config object (can match the user's JSON structure)
 */
export async function updateRateLimitConfig(providerId, config) {
  const db = await getDb();
  if (!db.data.rateLimitConfigs) db.data.rateLimitConfigs = {};

  db.data.rateLimitConfigs[providerId] = config;
  await db.write();
  return config;
}




// ============ Rate Limit State ============

// Get persisted rate limit state
export async function getRateLimitState() {
  const db = await getDb();
  await db.read();
  return db.data.rateLimitState || { windows: {} };
}

// Save rate limit state
export async function saveRateLimitState(state) {
  const db = await getDb();
  await db.read();
  db.data.rateLimitState = state;
  await db.write();
}

// ============ Rate Limit Suggestions (429 auto-failover) ============

const MAX_SUGGESTIONS = 20;

export async function getRateLimitSuggestions() {
  const db = await getDb();
  return db.data.rateLimitSuggestions || [];
}

export async function addRateLimitSuggestion(model, alternatives) {
  const db = await getDb();
  if (!db.data.rateLimitSuggestions) db.data.rateLimitSuggestions = [];
  db.data.rateLimitSuggestions.unshift({
    model,
    alternatives: Array.isArray(alternatives) ? alternatives : [],
    at: new Date().toISOString()
  });
  db.data.rateLimitSuggestions = db.data.rateLimitSuggestions.slice(0, MAX_SUGGESTIONS);
  await db.write();
}

// ============ P2P Marketplace ============

/**
 * Get all P2P offers
 */
export async function getP2pOffers() {
  const db = await getDb();
  return db.data.p2pOffers || [];
}

/**
 * Update P2P offers from discovered nodes
 */
export async function updateP2pOffers(nodes) {
  const db = await getDb();
  db.data.p2pOffers = nodes.map(node => ({
    id: node.id,
    name: node.name,
    baseUrl: node.baseUrl,
    provider: node.provider || node.name,
    models: node.models || [],
    latency: node.avgLatency || 0,
    tps: node.avgTps || 0,
    lastSeen: new Date().toISOString()
  }));
  await db.write();
  return db.data.p2pOffers;
}

/**
 * Get all active P2P subscriptions
 */
export async function getP2pSubscriptions() {
  const db = await getDb();
  return db.data.p2pSubscriptions || [];
}

/**
 * Create a P2P subscription
 */
export async function createP2pSubscription(offerId, name) {
  const db = await getDb();
  const { signPayload } = await import("./security.js");
  const sub = {
    id: uuidv4(),
    offerId,
    name,
    status: "active",
    createdAt: new Date().toISOString()
  };

  // Sign the subscription to prevent tampering
  sub.signature = await signPayload(sub);

  db.data.p2pSubscriptions.push(sub);
  await db.write();
  return sub;
}

// ============ P2P Billing & Wallet ============

/**
 * Get node wallet balance from sidecar instead of local mock db
 */
export async function getWalletBalance() {
  // Try to use the sidecar API, or return 0 if failed
  try {
    const res = await fetch("http://localhost:9480/wallet/balance");
    if (!res.ok) return 0;
    const data = await res.json();
    return data.balance || 0;
  } catch (error) {
    return 0; // fallback to 0 instead of mock 1000
  }
}

/**
 * Record a P2P transaction by sending it to the sidecar
 */
export async function recordP2pTransaction(transaction) {
  try {
    const res = await fetch("http://localhost:9480/wallet/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(transaction)
    });
    return res.ok;
  } catch (error) {
    console.error("Failed to record P2P transaction via sidecar:", error);
    return false;
  }
}

// ============ Routing Filters & Controls ============

/**
 * Get all routing filters
 */
export async function getRoutingFilters(activeOnly = false) {
  if (isCloud) return [];

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const query = activeOnly
    ? `SELECT * FROM routing_filters WHERE isActive = 1 ORDER BY priority ASC, createdAt DESC`
    : `SELECT * FROM routing_filters ORDER BY priority ASC, createdAt DESC`;

  const rows = sqlite.prepare(query).all();

  return rows.map(r => ({
    ...r,
    isActive: r.isActive === 1,
    value: (() => {
      if (!r.value) return null;
      try {
        return JSON.parse(r.value);
      } catch {
        console.warn(`[localDb] Failed to parse routing filter value for ${r.id}`);
        return null;
      }
    })()
  }));
}

/**
 * Get routing filter by ID
 */
export async function getRoutingFilterById(id) {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const row = sqlite.prepare(`SELECT * FROM routing_filters WHERE id = ?`).get(id);

  if (!row) return null;
  return {
    ...row,
    isActive: row.isActive === 1,
    value: (() => {
      if (!row.value) return null;
      try {
        return JSON.parse(row.value);
      } catch {
        console.warn(`[localDb] Failed to parse routing filter value for ${row.id}`);
        return null;
      }
    })()
  };
}

/**
 * Create a new routing filter
 */
export async function createRoutingFilter(data) {
  const now = new Date().toISOString();
  const filter = {
    id: data.id || uuidv4(),
    name: data.name,
    description: data.description || null,
    filter_type: data.filter_type,
    operator: data.operator,
    value: JSON.stringify(data.value),
    action: data.action || 'allow',
    isActive: data.isActive !== false ? 1 : 0,
    priority: data.priority || 100,
    createdAt: now,
    updatedAt: now
  };

  if (isCloud) return { ...filter, isActive: filter.isActive === 1, value: data.value };

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  sqlite.prepare(`
    INSERT INTO routing_filters (id, name, description, filter_type, operator, value, action, isActive, priority, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    filter.id, filter.name, filter.description, filter.filter_type, filter.operator,
    filter.value, filter.action, filter.isActive, filter.priority, filter.createdAt, filter.updatedAt
  );

  return { ...filter, isActive: filter.isActive === 1, value: data.value };
}

/**
 * Update routing filter
 */
export async function updateRoutingFilter(id, data) {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const existing = await getRoutingFilterById(id);
  if (!existing) return null;

  const fields = [];
  const params = [];

  // Whitelist of allowed fields to prevent SQL injection
  const ALLOWED_FIELDS = ['name', 'description', 'filter_type', 'operator', 'value', 'action', 'isActive', 'priority'];

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue;
    if (!ALLOWED_FIELDS.includes(key)) continue; // Skip non-whitelisted fields
    fields.push(`${key} = ?`);
    if (key === 'value') {
      params.push(JSON.stringify(value));
    } else if (key === 'isActive') {
      params.push(value ? 1 : 0);
    } else {
      params.push(value);
    }
  }

  if (fields.length === 0) {
    return await getRoutingFilterById(id); // Nothing to update
  }

  fields.push(`updatedAt = ?`);
  params.push(new Date().toISOString());
  params.push(id);

  sqlite.prepare(`UPDATE routing_filters SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return await getRoutingFilterById(id);
}

/**
 * Delete routing filter
 */
export async function deleteRoutingFilter(id) {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const existing = await getRoutingFilterById(id);
  if (!existing) return null;

  sqlite.prepare(`DELETE FROM routing_filters WHERE id = ?`).run(id);
  return existing;
}

/**
 * Get routing controls (global settings)
 */
export async function getRoutingControls() {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const row = sqlite.prepare(`SELECT * FROM routing_controls WHERE id = 'global'`).get();

  if (!row) {
    // Create default entry
    const defaultControls = {
      id: 'global',
      defaultAction: 'allow',
      maxCostPer1k: null,
      maxLatencyMs: null,
      minTrustScore: null,
      allowedCountries: null,
      blockedCountries: null,
      allowedIpRanges: null,
      blockedIpRanges: null,
      updatedAt: new Date().toISOString()
    };

    sqlite.prepare(`
      INSERT INTO routing_controls (id, defaultAction, maxCostPer1k, maxLatencyMs, minTrustScore,
        allowedCountries, blockedCountries, allowedIpRanges, blockedIpRanges, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      defaultControls.id, defaultControls.defaultAction, defaultControls.maxCostPer1k,
      defaultControls.maxLatencyMs, defaultControls.minTrustScore, defaultControls.allowedCountries,
      defaultControls.blockedCountries, defaultControls.allowedIpRanges, defaultControls.blockedIpRanges,
      defaultControls.updatedAt
    );

    return {
      ...defaultControls,
      allowedCountries: null,
      blockedCountries: null,
      allowedIpRanges: null,
      blockedIpRanges: null
    };
  }

  const safeParse = (json) => {
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      console.warn(`[localDb] Failed to parse routing controls JSON`);
      return null;
    }
  };

  return {
    ...row,
    allowedCountries: safeParse(row.allowedCountries),
    blockedCountries: safeParse(row.blockedCountries),
    allowedIpRanges: safeParse(row.allowedIpRanges),
    blockedIpRanges: safeParse(row.blockedIpRanges)
  };
}

/**
 * Update routing controls
 */
export async function updateRoutingControls(data) {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const existing = await getRoutingControls();
  if (!existing) return null;

  const fields = [];
  const params = [];

  // Whitelist of allowed fields to prevent SQL injection
  const ALLOWED_FIELDS = ['defaultAction', 'maxCostPer1k', 'maxLatencyMs', 'minTrustScore', 'allowedCountries', 'blockedCountries', 'allowedIpRanges', 'blockedIpRanges'];

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue;
    if (!ALLOWED_FIELDS.includes(key)) continue; // Skip non-whitelisted fields
    fields.push(`${key} = ?`);
    if (['allowedCountries', 'blockedCountries', 'allowedIpRanges', 'blockedIpRanges'].includes(key)) {
      params.push(value ? JSON.stringify(value) : null);
    } else {
      params.push(value);
    }
  }

  if (fields.length === 0) {
    return await getRoutingControls(); // Nothing to update
  }

  fields.push(`updatedAt = ?`);
  params.push(new Date().toISOString());
  params.push('global');

  sqlite.prepare(`UPDATE routing_controls SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return await getRoutingControls();
}

/**
 * Get peer metadata
 */
export async function getPeerMetadata(peerId) {
  if (isCloud) return null;

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const row = sqlite.prepare(`SELECT * FROM peer_metadata WHERE peerId = ?`).get(peerId);

  if (!row) return null;
  return {
    ...row,
    metadata: (() => {
      if (!row.metadata) return null;
      try {
        return JSON.parse(row.metadata);
      } catch {
        console.warn(`[localDb] Failed to parse peer metadata for ${row.peerId}`);
        return null;
      }
    })()
  };
}

/**
 * Get peer metadata for multiple peers in a single query
 * @param {string[]} peerIds - Array of peer IDs
 * @returns {Promise<Map<string, object>>} Map of peerId to metadata
 */
export async function getPeerMetadataBatch(peerIds) {
  if (isCloud || !peerIds?.length) return new Map();

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  // Create placeholders for the IN clause
  const placeholders = peerIds.map(() => '?').join(',');
  const rows = sqlite.prepare(`SELECT * FROM peer_metadata WHERE peerId IN (${placeholders})`).all(...peerIds);

  const metadataMap = new Map();
  for (const row of rows) {
    metadataMap.set(row.peerId, {
      ...row,
      metadata: (() => {
        if (!row.metadata) return null;
        try {
          return JSON.parse(row.metadata);
        } catch {
          // Security: peerId is from database, not user input - safe for logging
          // nosemgrep: ai.node_sqli_injection (false positive - this is just console.warn, not SQL)
          console.warn("[localDb] Failed to parse peer metadata for peer:", row.peerId);
          return null;
        }
      })()
    });
  }

  return metadataMap;
}

/**
 * Set peer metadata
 */
export async function setPeerMetadata(peerId, data) {
  const now = new Date().toISOString();

  if (isCloud) return { peerId, ...data, lastSeen: now };

  await ensureSqliteSync();
  const sqlite = getSqliteDb();

  const existing = await getPeerMetadata(peerId);

  if (existing) {
    sqlite.prepare(`
      UPDATE peer_metadata SET
        ipAddress = COALESCE(?, ipAddress),
        countryCode = COALESCE(?, countryCode),
        region = COALESCE(?, region),
        isp = COALESCE(?, isp),
        lastSeen = ?,
        trustScore = COALESCE(?, trustScore),
        metadata = COALESCE(?, metadata)
      WHERE peerId = ?
    `).run(
      data.ipAddress || null, data.countryCode || null, data.region || null,
      data.isp || null, now, data.trustScore || null,
      data.metadata ? JSON.stringify(data.metadata) : null, peerId
    );
  } else {
    sqlite.prepare(`
      INSERT INTO peer_metadata (peerId, ipAddress, countryCode, region, isp, lastSeen, trustScore, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      peerId, data.ipAddress || null, data.countryCode || null, data.region || null,
      data.isp || null, now, data.trustScore || null,
      data.metadata ? JSON.stringify(data.metadata) : null
    );
  }

  return await getPeerMetadata(peerId);
}

// ============ Community Pricing (GasBuddy-style) ============

/**
 * Submit a community price report
 * @param {object} submission - Price submission data
 * @returns {Promise<object>} The created submission with ID
 */
export async function submitCommunityPrice(submission) {
  const db = await getDb();

  if (!db.data.communityPriceSubmissions) {
    db.data.communityPriceSubmissions = [];
  }

  const newSubmission = {
    id: uuidv4(),
    providerId: submission.providerId,
    modelId: submission.modelId,
    canonicalModelId: submission.canonicalModelId || null,
    tier: submission.tier || null,
    inputPerMUsd: Number(submission.inputPerMUsd) || 0,
    outputPerMUsd: Number(submission.outputPerMUsd) || 0,
    source: submission.source || "user_submitted",
    submittedBy: submission.submittedBy || "anonymous",
    submittedAt: new Date().toISOString(),
    validatedAt: null,
    sampleSize: submission.sampleSize || null,
    notes: submission.notes || null,
    isFree: submission.isFree || false,
    freeLimit: submission.freeLimit || null,
  };

  db.data.communityPriceSubmissions.push(newSubmission);
  await db.write();
  return newSubmission;
}

/**
 * Get all community price submissions
 * @param {object} filter - Optional filter criteria
 * @returns {Promise<object[]>} Array of submissions
 */
export async function getCommunityPriceSubmissions(filter = {}) {
  const db = await getDb();
  let submissions = db.data.communityPriceSubmissions || [];

  if (filter.providerId) {
    submissions = submissions.filter(s => s.providerId === filter.providerId);
  }
  if (filter.modelId) {
    submissions = submissions.filter(s => s.modelId === filter.modelId);
  }
  if (filter.source) {
    submissions = submissions.filter(s => s.source === filter.source);
  }
  if (filter.validated !== undefined) {
    submissions = submissions.filter(s => filter.validated ? s.validatedAt : !s.validatedAt);
  }

  return submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

/**
 * Record a price change in history
 * @param {object} priceRecord - Price record to add to history
 * @returns {Promise<object>} The created history record
 */
export async function recordPriceHistory(priceRecord) {
  const db = await getDb();

  if (!db.data.priceHistory) {
    db.data.priceHistory = [];
  }

  // Close any existing active record for this provider/model/tier
  const now = new Date().toISOString();
  for (const record of db.data.priceHistory) {
    if (
      record.providerId === priceRecord.providerId &&
      record.modelId === priceRecord.modelId &&
      record.tier === (priceRecord.tier || null) &&
      record.isActive
    ) {
      record.validTo = now;
      record.isActive = false;
    }
  }

  const newRecord = {
    id: uuidv4(),
    providerId: priceRecord.providerId,
    modelId: priceRecord.modelId,
    tier: priceRecord.tier || null,
    inputPerMUsd: Number(priceRecord.inputPerMUsd) || 0,
    outputPerMUsd: Number(priceRecord.outputPerMUsd) || 0,
    validFrom: now,
    validTo: null,
    isActive: true,
    isFree: priceRecord.isFree || false,
    freeLimit: priceRecord.freeLimit || null,
    freeExpiresAt: priceRecord.freeExpiresAt || null,
    source: priceRecord.source || "official",
  };

  db.data.priceHistory.push(newRecord);
  await db.write();
  return newRecord;
}

/**
 * Get price history for a provider/model
 * @param {string} providerId - Provider ID
 * @param {string} modelId - Optional model ID
 * @param {boolean} activeOnly - If true, only return active records
 * @returns {Promise<object[]>} Array of price history records
 */
export async function getPriceHistory(providerId, modelId = null, activeOnly = false) {
  const db = await getDb();
  let history = db.data.priceHistory || [];

  history = history.filter(h => h.providerId === providerId);
  if (modelId) {
    history = history.filter(h => h.modelId === modelId);
  }
  if (activeOnly) {
    history = history.filter(h => h.isActive);
  }

  return history.sort((a, b) => new Date(b.validFrom) - new Date(a.validFrom));
}

/**
 * Get all free models currently tracked
 * @returns {Promise<object[]>} Array of free model records
 */
export async function getFreeModels() {
  const db = await getDb();
  const history = db.data.priceHistory || [];

  return history.filter(h => h.isActive && h.isFree);
}

// ============ TokenBuddy Contributor System ============

const CONTRIBUTION_TYPES = {
  PRICE_SUBMISSION: { points: 5, label: "Price Submission", dailyCap: null },
  PRICE_VERIFICATION: { points: 1, label: "Price Verification", dailyCap: 10 },
  NEW_MODEL_ADDED: { points: 15, label: "New Model Added", dailyCap: null },
  FREE_MODEL_REPORTED: { points: 12, label: "Free Model Reported", dailyCap: null },
  PRICE_UPDATE: { points: 8, label: "Price Update (Verified)", dailyCap: null },
  DAILY_CHECKIN: { points: 1, label: "Daily Check-in", dailyCap: 1 },
  VOTE_ACCURATE: { points: 1, label: "Accurate Vote", dailyCap: 20 },
  SUBMISSION_VERIFIED: { points: 3, label: "Your Submission Verified", dailyCap: null },
};

const TRUST_LEVELS = {
  NEW: { minPoints: 0, canSubmit: true, canVote: false, votesRequired: 5 },
  MEMBER: { minPoints: 50, canSubmit: true, canVote: true, votesRequired: 3 },
  TRUSTED: { minPoints: 500, canSubmit: true, canVote: true, votesRequired: 2 },
  VERIFIED: { minPoints: 2000, canSubmit: true, canVote: true, votesRequired: 1, autoVerify: true },
};

const MODERATION_CONFIG = {
  TIMEOUT_THRESHOLDS: [
    { downvotes: 3, duration: 24 * 60 * 60 * 1000 }, // 24 hours
    { downvotes: 5, duration: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    { downvotes: 10, duration: 30 * 24 * 60 * 60 * 1000 }, // 30 days
  ],
  POINTS_PENALTY_PER_REJECTION: 5,
  VOTES_TO_VERIFY: 3,
  VOTES_TO_REJECT: 3,
};

const BADGES = {
  FIRST_CONTRIBUTION: { id: "first_contribution", name: "First Steps", description: "Made your first contribution", icon: "🌱" },
  VERIFIED_10: { id: "verified_10", name: "Fact Checker", description: "Verified 10 prices", icon: "✓" },
  VERIFIED_50: { id: "verified_50", name: "Verification Pro", description: "Verified 50 prices", icon: "✓✓" },
  MODELS_5: { id: "models_5", name: "Model Scout", description: "Added 5 new models", icon: "🔍" },
  MODELS_25: { id: "models_25", name: "Model Hunter", description: "Added 25 new models", icon: "🎯" },
  STREAK_7: { id: "streak_7", name: "Week Warrior", description: "7-day check-in streak", icon: "🔥" },
  STREAK_30: { id: "streak_30", name: "Monthly Champion", description: "30-day check-in streak", icon: "💎" },
  FREE_FINDER: { id: "free_finder", name: "Free Finder", description: "Reported 10 free models", icon: "🆓" },
  TOP_CONTRIBUTOR: { id: "top_contributor", name: "Top Contributor", description: "Ranked in top 10 all-time", icon: "🏆" },
  PRICE_PIONEER: { id: "price_pioneer", name: "Price Pioneer", description: "First to report a price for a model", icon: "⭐" },
};

/**
 * Get trust level for a given point total
 */
function getTrustLevelForPoints(points) {
  if (points >= TRUST_LEVELS.VERIFIED.minPoints) return "VERIFIED";
  if (points >= TRUST_LEVELS.TRUSTED.minPoints) return "TRUSTED";
  if (points >= TRUST_LEVELS.MEMBER.minPoints) return "MEMBER";
  return "NEW";
}

/**
 * Check if contributor is in timeout
 */
function isInTimeout(contributor) {
  if (!contributor.moderation?.timeoutUntil) return false;
  return new Date(contributor.moderation.timeoutUntil) > new Date();
}

/**
 * Get daily points earned for a specific type
 */
function getDailyPointsForType(contributor, type) {
  const today = new Date().toISOString().split("T")[0];
  if (!contributor.dailyPointsEarned[today]) return 0;
  return contributor.dailyPointsEarned[today][type] || 0;
}

/**
 * Get or create a contributor profile
 * @param {string} contributorId - User ID or "anonymous"
 * @returns {Promise<object>} Contributor profile
 */
export async function getContributor(contributorId) {
  const db = await getDb();
  if (!db.data.tokenBuddyContributors) {
    db.data.tokenBuddyContributors = {};
  }

  if (!db.data.tokenBuddyContributors[contributorId]) {
    db.data.tokenBuddyContributors[contributorId] = {
      id: contributorId,
      displayName: contributorId === "anonymous" ? "Anonymous" : `Contributor-${contributorId.slice(0, 8)}`,
      totalPoints: 0,
      contributions: {
        priceSubmissions: 0,
        priceVerifications: 0,
        newModelsAdded: 0,
        freeModelsReported: 0,
        priceUpdates: 0,
        dailyCheckins: 0,
        accurateVotes: 0,
        submissionsVerified: 0,
      },
      badges: [],
      currentStreak: 0,
      longestStreak: 0,
      lastCheckinDate: null,
      joinedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      trustLevel: "NEW",
      moderation: {
        warnings: 0,
        rejectedSubmissions: 0,
        timeoutUntil: null,
        timeoutReason: null,
      },
      dailyPointsEarned: {},
    };
    await db.write();
  }
  
  // Migrate existing profiles
  const profile = db.data.tokenBuddyContributors[contributorId];
  if (!profile.moderation) {
    profile.moderation = { warnings: 0, rejectedSubmissions: 0, timeoutUntil: null, timeoutReason: null };
  }
  if (!profile.dailyPointsEarned) {
    profile.dailyPointsEarned = {};
  }
  if (!profile.trustLevel) {
    profile.trustLevel = getTrustLevelForPoints(profile.totalPoints);
  }

  return db.data.tokenBuddyContributors[contributorId];
}

/**
 * Record a contribution and award points
 * @param {string} contributorId - User ID
 * @param {string} type - Contribution type (PRICE_SUBMISSION, PRICE_VERIFICATION, etc.)
 * @param {object} metadata - Optional metadata about the contribution
 * @returns {Promise<object>} Updated contributor profile with any new badges
 */
export async function recordContribution(contributorId, type, metadata = {}) {
  const db = await getDb();
  const contributor = await getContributor(contributorId);
  const typeConfig = CONTRIBUTION_TYPES[type];

  if (!typeConfig) {
    throw new Error(`Unknown contribution type: ${type}`);
  }

  // Check if contributor is in timeout
  if (isInTimeout(contributor)) {
    return {
      contributor,
      newBadges: [],
      pointsAwarded: 0,
      error: `Account is in timeout until ${contributor.moderation.timeoutUntil}`,
    };
  }

  // Check daily cap
  const today = new Date().toISOString().split("T")[0];
  if (!contributor.dailyPointsEarned[today]) {
    contributor.dailyPointsEarned[today] = {};
  }

  let pointsToAward = typeConfig.points;
  if (typeConfig.dailyCap !== null) {
    const earnedToday = getDailyPointsForType(contributor, type);
    if (earnedToday >= typeConfig.dailyCap * typeConfig.points) {
      pointsToAward = 0; // Cap reached
    } else {
      const remaining = (typeConfig.dailyCap * typeConfig.points) - earnedToday;
      pointsToAward = Math.min(pointsToAward, remaining);
    }
  }

  contributor.totalPoints += pointsToAward;
  contributor.dailyPointsEarned[today][type] = (contributor.dailyPointsEarned[today][type] || 0) + pointsToAward;
  contributor.lastActiveAt = new Date().toISOString();

  // Update trust level
  contributor.trustLevel = getTrustLevelForPoints(contributor.totalPoints);

  // Update specific counters
  switch (type) {
    case "PRICE_SUBMISSION":
      contributor.contributions.priceSubmissions++;
      break;
    case "PRICE_VERIFICATION":
      contributor.contributions.priceVerifications++;
      break;
    case "NEW_MODEL_ADDED":
      contributor.contributions.newModelsAdded++;
      break;
    case "FREE_MODEL_REPORTED":
      contributor.contributions.freeModelsReported++;
      break;
    case "PRICE_UPDATE":
      contributor.contributions.priceUpdates++;
      break;
    case "VOTE_ACCURATE":
      contributor.contributions.accurateVotes = (contributor.contributions.accurateVotes || 0) + 1;
      break;
    case "SUBMISSION_VERIFIED":
      contributor.contributions.submissionsVerified = (contributor.contributions.submissionsVerified || 0) + 1;
      break;
    case "DAILY_CHECKIN":
      contributor.contributions.dailyCheckins++;
      // Handle streak
      const checkinToday = new Date().toISOString().split("T")[0];
      const lastCheckin = contributor.lastCheckinDate;
      if (lastCheckin) {
        const lastDate = new Date(lastCheckin);
        const todayDate = new Date(checkinToday);
        const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          contributor.currentStreak++;
        } else if (diffDays > 1) {
          contributor.currentStreak = 1;
        }
      } else {
        contributor.currentStreak = 1;
      }
      contributor.longestStreak = Math.max(contributor.longestStreak, contributor.currentStreak);
      contributor.lastCheckinDate = checkinToday;
      break;
  }

  // Check for new badges
  const newBadges = checkForNewBadges(contributor);

  db.data.tokenBuddyContributors[contributorId] = contributor;
  await db.write();

  return { contributor, newBadges };
}

/**
 * Check if contributor has earned new badges
 */
function checkForNewBadges(contributor) {
  const newBadges = [];
  const hasBadge = (id) => contributor.badges.some(b => b.id === id);

  // First contribution
  if (!hasBadge("first_contribution") && contributor.totalPoints > 0) {
    const badge = { ...BADGES.FIRST_CONTRIBUTION, earnedAt: new Date().toISOString() };
    contributor.badges.push(badge);
    newBadges.push(badge);
  }

  // Verification badges
  if (!hasBadge("verified_10") && contributor.contributions.priceVerifications >= 10) {
    const badge = { ...BADGES.VERIFIED_10, earnedAt: new Date().toISOString() };
    contributor.badges.push(badge);
    newBadges.push(badge);
  }
  if (!hasBadge("verified_50") && contributor.contributions.priceVerifications >= 50) {
    const badge = { ...BADGES.VERIFIED_50, earnedAt: new Date().toISOString() };
    contributor.badges.push(badge);
    newBadges.push(badge);
  }

  // Model badges
  if (!hasBadge("models_5") && contributor.contributions.newModelsAdded >= 5) {
    const badge = { ...BADGES.MODELS_5, earnedAt: new Date().toISOString() };
    contributor.badges.push(badge);
    newBadges.push(badge);
  }
  if (!hasBadge("models_25") && contributor.contributions.newModelsAdded >= 25) {
    const badge = { ...BADGES.MODELS_25, earnedAt: new Date().toISOString() };
    contributor.badges.push(badge);
    newBadges.push(badge);
  }

  // Streak badges
  if (!hasBadge("streak_7") && contributor.currentStreak >= 7) {
    const badge = { ...BADGES.STREAK_7, earnedAt: new Date().toISOString() };
    contributor.badges.push(badge);
    newBadges.push(badge);
  }
  if (!hasBadge("streak_30") && contributor.currentStreak >= 30) {
    const badge = { ...BADGES.STREAK_30, earnedAt: new Date().toISOString() };
    contributor.badges.push(badge);
    newBadges.push(badge);
  }

  // Free finder badge
  if (!hasBadge("free_finder") && contributor.contributions.freeModelsReported >= 10) {
    const badge = { ...BADGES.FREE_FINDER, earnedAt: new Date().toISOString() };
    contributor.badges.push(badge);
    newBadges.push(badge);
  }

  return newBadges;
}

/**
 * Get contributor leaderboards
 * @param {string} type - Leaderboard type: "total" | "verifications" | "models" | "streak" | "weekly"
 * @param {number} limit - Max results
 * @returns {Promise<object[]>} Sorted contributors
 */
export async function getContributorLeaderboard(type = "total", limit = 10) {
  const db = await getDb();
  const contributors = Object.values(db.data.tokenBuddyContributors || {});

  let sorted;
  switch (type) {
    case "verifications":
      sorted = contributors.sort((a, b) => b.contributions.priceVerifications - a.contributions.priceVerifications);
      break;
    case "models":
      sorted = contributors.sort((a, b) => b.contributions.newModelsAdded - a.contributions.newModelsAdded);
      break;
    case "streak":
      sorted = contributors.sort((a, b) => b.longestStreak - a.longestStreak);
      break;
    case "weekly":
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      sorted = contributors
        .filter(c => new Date(c.lastActiveAt) > weekAgo)
        .sort((a, b) => b.totalPoints - a.totalPoints);
      break;
    case "total":
    default:
      sorted = contributors.sort((a, b) => b.totalPoints - a.totalPoints);
  }

  return sorted.slice(0, limit).map((c, idx) => ({
    rank: idx + 1,
    id: c.id,
    displayName: c.displayName,
    totalPoints: c.totalPoints,
    contributions: c.contributions,
    badges: c.badges,
    currentStreak: c.currentStreak,
    longestStreak: c.longestStreak,
  }));
}

/**
 * Daily check-in for a contributor
 * @param {string} contributorId - User ID
 * @returns {Promise<object>} Check-in result with streak info
 */
export async function dailyCheckin(contributorId) {
  const contributor = await getContributor(contributorId);
  const today = new Date().toISOString().split("T")[0];

  // Check if already checked in today
  if (contributor.lastCheckinDate === today) {
    return {
      success: false,
      message: "Already checked in today",
      currentStreak: contributor.currentStreak,
    };
  }

  const result = await recordContribution(contributorId, "DAILY_CHECKIN");
  return {
    success: true,
    message: "Check-in successful!",
    pointsEarned: CONTRIBUTION_TYPES.DAILY_CHECKIN.points,
    currentStreak: result.contributor.currentStreak,
    newBadges: result.newBadges,
  };
}

// ============ Pending Submission & Voting System ============

/**
 * Create a pending submission for community verification
 * @param {object} submission - The price submission data
 * @param {string} submitterId - The contributor who submitted it
 * @returns {Promise<object>} The pending submission record
 */
export async function createPendingSubmission(submission, submitterId) {
  const db = await getDb();
  const contributor = await getContributor(submitterId);

  // Check timeout
  if (isInTimeout(contributor)) {
    throw new Error(`Account is in timeout until ${contributor.moderation.timeoutUntil}`);
  }

  const trustLevel = TRUST_LEVELS[contributor.trustLevel] || TRUST_LEVELS.NEW;

  // Check if VERIFIED users can auto-verify
  const autoVerify = trustLevel.autoVerify === true;

  const pendingSubmission = {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...submission,
    submittedBy: submitterId,
    submittedAt: new Date().toISOString(),
    status: autoVerify ? "verified" : "pending",
    votesRequired: trustLevel.votesRequired,
    upvotes: autoVerify ? [submitterId] : [],
    downvotes: [],
    verifiedAt: autoVerify ? new Date().toISOString() : null,
    verifiedBy: autoVerify ? [submitterId] : [],
    rejectedAt: null,
    rejectionReason: null,
  };

  if (!db.data.pendingSubmissions) {
    db.data.pendingSubmissions = [];
  }

  db.data.pendingSubmissions.push(pendingSubmission);

  // If auto-verified, also add to communityPriceSubmissions
  if (autoVerify) {
    if (!db.data.communityPriceSubmissions) {
      db.data.communityPriceSubmissions = [];
    }
    db.data.communityPriceSubmissions.push({
      ...submission,
      id: pendingSubmission.id,
      submittedBy: submitterId,
      submittedAt: pendingSubmission.submittedAt,
      verified: true,
      verifiedAt: pendingSubmission.verifiedAt,
    });
  }

  await db.write();
  return pendingSubmission;
}

/**
 * Get pending submissions for community review
 * @param {object} filter - Optional filters
 * @returns {Promise<object[]>} Array of pending submissions
 */
export async function getPendingSubmissions(filter = {}) {
  const db = await getDb();
  let pending = db.data.pendingSubmissions || [];

  if (filter.status) {
    pending = pending.filter(s => s.status === filter.status);
  }
  if (filter.providerId) {
    pending = pending.filter(s => s.providerId === filter.providerId);
  }
  if (filter.modelId) {
    pending = pending.filter(s => s.modelId === filter.modelId);
  }

  return pending.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

/**
 * Vote on a pending submission
 * @param {string} submissionId - The submission to vote on
 * @param {string} voterId - The contributor voting
 * @param {string} vote - "up" or "down"
 * @param {string} reason - Optional reason for downvote
 * @returns {Promise<object>} Updated submission with voting result
 */
export async function voteOnSubmission(submissionId, voterId, vote, reason = null) {
  const db = await getDb();
  const voter = await getContributor(voterId);
  const trustLevel = TRUST_LEVELS[voter.trustLevel] || TRUST_LEVELS.NEW;

  // Check if voter can vote
  if (!trustLevel.canVote) {
    throw new Error(`You need at least ${TRUST_LEVELS.MEMBER.minPoints} points to vote`);
  }

  // Check timeout
  if (isInTimeout(voter)) {
    throw new Error(`Account is in timeout until ${voter.moderation.timeoutUntil}`);
  }

  const submission = (db.data.pendingSubmissions || []).find(s => s.id === submissionId);
  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.status !== "pending") {
    throw new Error(`Submission is already ${submission.status}`);
  }

  // Can't vote on own submission
  if (submission.submittedBy === voterId) {
    throw new Error("Cannot vote on your own submission");
  }

  // Check if already voted
  if (submission.upvotes.includes(voterId) || submission.downvotes.includes(voterId)) {
    throw new Error("You have already voted on this submission");
  }

  // Record vote
  if (vote === "up") {
    submission.upvotes.push(voterId);
  } else if (vote === "down") {
    submission.downvotes.push(voterId);
    if (reason) {
      submission.downvoteReasons = submission.downvoteReasons || [];
      submission.downvoteReasons.push({ voterId, reason, at: new Date().toISOString() });
    }
  } else {
    throw new Error("Vote must be 'up' or 'down'");
  }

  let result = { status: "pending", message: "Vote recorded" };

  // Check if verified
  if (submission.upvotes.length >= submission.votesRequired) {
    submission.status = "verified";
    submission.verifiedAt = new Date().toISOString();
    submission.verifiedBy = submission.upvotes;

    // Add to verified submissions
    if (!db.data.communityPriceSubmissions) {
      db.data.communityPriceSubmissions = [];
    }
    db.data.communityPriceSubmissions.push({
      id: submission.id,
      providerId: submission.providerId,
      modelId: submission.modelId,
      canonicalModelId: submission.canonicalModelId,
      tier: submission.tier,
      inputPerMUsd: submission.inputPerMUsd,
      outputPerMUsd: submission.outputPerMUsd,
      source: "community_verified",
      submittedBy: submission.submittedBy,
      submittedAt: submission.submittedAt,
      verified: true,
      verifiedAt: submission.verifiedAt,
      verifiedBy: submission.verifiedBy,
      isFree: submission.isFree,
      freeLimit: submission.freeLimit,
    });

    // Award points to submitter
    await recordContribution(submission.submittedBy, "SUBMISSION_VERIFIED");

    // Award points to voters who voted correctly
    for (const upvoter of submission.upvotes) {
      if (upvoter !== submission.submittedBy) {
        await recordContribution(upvoter, "VOTE_ACCURATE");
      }
    }

    result = { status: "verified", message: "Submission verified by community!" };
  }

  // Check if rejected
  if (submission.downvotes.length >= MODERATION_CONFIG.VOTES_TO_REJECT) {
    submission.status = "rejected";
    submission.rejectedAt = new Date().toISOString();
    submission.rejectionReason = submission.downvoteReasons?.map(r => r.reason).join("; ") || "Community rejected";

    // Handle submitter moderation
    const submitter = await getContributor(submission.submittedBy);
    submitter.moderation.rejectedSubmissions++;

    // Check for timeout thresholds
    const rejections = submitter.moderation.rejectedSubmissions;
    for (const threshold of MODERATION_CONFIG.TIMEOUT_THRESHOLDS) {
      if (rejections >= threshold.downvotes && !submitter.moderation.timeoutUntil) {
        submitter.moderation.timeoutUntil = new Date(Date.now() + threshold.duration).toISOString();
        submitter.moderation.timeoutReason = `${rejections} rejected submissions`;
        submitter.moderation.warnings++;
        break;
      }
    }

    // Deduct points
    submitter.totalPoints = Math.max(0, submitter.totalPoints - MODERATION_CONFIG.POINTS_PENALTY_PER_REJECTION);
    db.data.tokenBuddyContributors[submission.submittedBy] = submitter;

    result = { status: "rejected", message: "Submission rejected by community" };
  }

  await db.write();
  return { submission, result };
}

/**
 * Get contributor trust level info
 * @param {string} contributorId - Contributor ID
 * @returns {Promise<object>} Trust level details
 */
export async function getContributorTrustInfo(contributorId) {
  const contributor = await getContributor(contributorId);
  const trustLevel = TRUST_LEVELS[contributor.trustLevel] || TRUST_LEVELS.NEW;

  const nextLevel = contributor.trustLevel === "NEW" ? "MEMBER" :
                    contributor.trustLevel === "MEMBER" ? "TRUSTED" :
                    contributor.trustLevel === "TRUSTED" ? "VERIFIED" : null;

  return {
    currentLevel: contributor.trustLevel,
    currentLevelInfo: trustLevel,
    nextLevel,
    nextLevelInfo: nextLevel ? TRUST_LEVELS[nextLevel] : null,
    pointsToNextLevel: nextLevel ? TRUST_LEVELS[nextLevel].minPoints - contributor.totalPoints : 0,
    isInTimeout: isInTimeout(contributor),
    timeoutUntil: contributor.moderation?.timeoutUntil,
    timeoutReason: contributor.moderation?.timeoutReason,
    warnings: contributor.moderation?.warnings || 0,
  };
}

/**
 * Get community activity feed
 * @param {number} limit - Max items to return
 * @returns {Promise<object[]>} Recent activity
 */
export async function getCommunityActivityFeed(limit = 20) {
  const db = await getDb();
  const activities = [];

  // Recent verified submissions
  const verified = (db.data.communityPriceSubmissions || [])
    .filter(s => s.verified)
    .slice(-limit)
    .map(s => ({
      type: "verified",
      submission: s,
      timestamp: s.verifiedAt || s.submittedAt,
    }));
  activities.push(...verified);

  // Recent pending submissions
  const pending = (db.data.pendingSubmissions || [])
    .filter(s => s.status === "pending")
    .slice(-limit)
    .map(s => ({
      type: "pending",
      submission: s,
      timestamp: s.submittedAt,
    }));
  activities.push(...pending);

  return activities
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

// ============ Preview Models & Rate Limits ============

/**
 * Report a preview/codename model
 * @param {object} model - Preview model details
 * @param {string} reportedBy - Contributor ID
 * @returns {Promise<object>} The preview model record
 */
export async function reportPreviewModel(model, reportedBy) {
  const db = await getDb();
  if (!db.data.previewModels) {
    db.data.previewModels = [];
  }

  const previewModel = {
    id: `prev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    providerId: model.providerId,
    codename: model.codename,
    displayName: model.displayName || model.codename,
    description: model.description || null,
    isFree: model.isFree || false,
    limitations: model.limitations || [],
    expirationDate: model.expirationDate || null,
    linkedOfficialModel: model.linkedOfficialModel || null,
    reportedBy,
    reportedAt: new Date().toISOString(),
    status: "active",
    confirmations: [reportedBy],
    lastConfirmedAt: new Date().toISOString(),
  };

  db.data.previewModels.push(previewModel);

  // Award points
  if (reportedBy !== "anonymous") {
    await recordContribution(reportedBy, "NEW_MODEL_ADDED", { isPreview: true });
  }

  await db.write();
  return previewModel;
}

/**
 * Get active preview models
 * @param {object} filter - Optional filters
 * @returns {Promise<object[]>} Array of preview models
 */
export async function getPreviewModels(filter = {}) {
  const db = await getDb();
  let models = db.data.previewModels || [];

  if (filter.providerId) {
    models = models.filter(m => m.providerId === filter.providerId);
  }
  if (filter.status) {
    models = models.filter(m => m.status === filter.status);
  }
  if (filter.isFree !== undefined) {
    models = models.filter(m => m.isFree === filter.isFree);
  }

  // Filter out expired previews
  const now = new Date();
  models = models.filter(m => {
    if (!m.expirationDate) return true;
    return new Date(m.expirationDate) > now;
  });

  return models.sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
}

/**
 * Report rate limits for a provider/model
 * @param {object} report - Rate limit details
 * @param {string} reportedBy - Contributor ID
 * @returns {Promise<object>} The rate limit record
 */
export async function reportRateLimit(report, reportedBy) {
  const db = await getDb();
  if (!db.data.rateLimitReports) {
    db.data.rateLimitReports = [];
  }

  const rateLimitReport = {
    id: `rl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    providerId: report.providerId,
    modelId: report.modelId,
    tier: report.tier || "default",
    limits: {
      requestsPerMinute: report.requestsPerMinute || null,
      requestsPerDay: report.requestsPerDay || null,
      tokensPerMinute: report.tokensPerMinute || null,
      tokensPerDay: report.tokensPerDay || null,
      contextWindow: report.contextWindow || null,
      maxOutputTokens: report.maxOutputTokens || null,
    },
    notes: report.notes || null,
    sourceUrl: report.sourceUrl || null,
    reportedBy,
    reportedAt: new Date().toISOString(),
    confirmations: [reportedBy],
    lastConfirmedAt: new Date().toISOString(),
  };

  // Check if updating existing report
  const existingIdx = db.data.rateLimitReports.findIndex(
    r => r.providerId === report.providerId && r.modelId === report.modelId && r.tier === (report.tier || "default")
  );

  if (existingIdx >= 0) {
    // Update existing
    const existing = db.data.rateLimitReports[existingIdx];
    existing.limits = { ...existing.limits, ...rateLimitReport.limits };
    existing.lastConfirmedAt = new Date().toISOString();
    if (!existing.confirmations.includes(reportedBy)) {
      existing.confirmations.push(reportedBy);
    }
    rateLimitReport.id = existing.id;
    db.data.rateLimitReports[existingIdx] = existing;
  } else {
    db.data.rateLimitReports.push(rateLimitReport);
  }

  // Award points for update
  if (reportedBy !== "anonymous") {
    await recordContribution(reportedBy, "PRICE_UPDATE", { isRateLimit: true });
  }

  await db.write();
  return rateLimitReport;
}

/**
 * Get rate limits for a provider/model
 * @param {string} providerId - Provider ID
 * @param {string} modelId - Optional model ID
 * @returns {Promise<object[]>} Array of rate limit reports
 */
export async function getRateLimits(providerId, modelId = null) {
  const db = await getDb();
  let reports = db.data.rateLimitReports || [];

  reports = reports.filter(r => r.providerId === providerId);
  if (modelId) {
    reports = reports.filter(r => r.modelId === modelId);
  }

  return reports.sort((a, b) => b.confirmations.length - a.confirmations.length);
}

/**
 * Get all rate limits grouped by provider
 * @returns {Promise<object>} Rate limits grouped by provider
 */
export async function getAllRateLimits() {
  const db = await getDb();
  const reports = db.data.rateLimitReports || [];

  const grouped = {};
  for (const r of reports) {
    if (!grouped[r.providerId]) {
      grouped[r.providerId] = {};
    }
    const key = r.modelId + (r.tier !== "default" ? `:${r.tier}` : "");
    grouped[r.providerId][key] = r;
  }

  return grouped;
}

// ============================================================================
// LOCAL PROVIDER CONNECTION SYNC
// Ensures local providers (Ollama, LM Studio) have matching provider_connections
// entries for unified routing with cloud providers.
// ============================================================================

/**
 * Sync a local provider node to create/update a matching provider_connection.
 * This normalizes local providers to use the same routing path as cloud providers.
 * @param {object} node - The provider_node object
 * @returns {Promise<object|null>} The synced connection or null if not a local node
 */
export async function syncLocalProviderConnection(node) {
  if (!node || node.type !== "local") return null;

  // Determine canonical provider ID from apiType
  const providerId = node.apiType === "ollama" ? "ollama" : "lmstudio";
  const connectionName = `${providerId}-local-${node.id}`;

  // Check if auto-managed connection already exists
  const existing = await getProviderConnections({
    provider: providerId,
    name: connectionName,
  });

  if (existing.length > 0) {
    // Update existing connection with current node info
    return await updateProviderConnection(existing[0].id, {
      metadata: {
        nodeId: node.id,
        baseUrl: node.baseUrl,
        autoManaged: true,
      },
    });
  }

  // Create new auto-managed connection
  return await createProviderConnection({
    provider: providerId,
    authType: "none",
    name: connectionName,
    apiKey: null,
    isActive: true,
    isEnabled: true,
    group: "local",
    metadata: {
      nodeId: node.id,
      baseUrl: node.baseUrl,
      autoManaged: true,
    },
  });
}

/**
 * Remove auto-managed connections for a local provider node.
 * Called when a local node is deleted.
 * @param {string} nodeId - The provider_node ID being deleted
 * @returns {Promise<number>} Number of connections removed
 */
export async function removeLocalProviderConnections(nodeId) {
  const allConnections = await getProviderConnections({});
  let removed = 0;

  for (const conn of allConnections) {
    const metadata = typeof conn.metadata === "string"
      ? JSON.parse(conn.metadata || "{}")
      : conn.metadata || {};

    if (metadata.autoManaged && metadata.nodeId === nodeId) {
      await deleteProviderConnection(conn.id);
      removed++;
    }
  }

  return removed;
}

/**
 * Get local provider connection for routing.
 * Returns the active connection for a local provider (ollama/lmstudio).
 * @param {string} providerId - "ollama" or "lmstudio"
 * @returns {Promise<object|null>} The connection or null
 */
export async function getLocalProviderConnection(providerId) {
  const connections = await getProviderConnections({
    provider: providerId,
    isActive: true,
    isEnabled: true,
  });

  return connections.length > 0 ? connections[0] : null;
}

/**
 * Initialize local provider connections for existing nodes.
 * Call this on startup to ensure all existing local nodes have
 * corresponding provider_connections for unified routing.
 * @returns {Promise<number>} Number of connections synced
 */
export async function initLocalProviderConnections() {
  const nodes = await getProviderNodes();
  const localNodes = nodes.filter(n => n.type === "local");
  let synced = 0;

  for (const node of localNodes) {
    const result = await syncLocalProviderConnection(node);
    if (result) synced++;
  }

  return synced;
}

/**
 * Create a new purchase record.
 * @param {object} data - Purchase data
 * @returns {Promise<object>} The created purchase record
 */
export async function createPurchase(data) {
  const db = getSqliteDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const licenseKey = `ZMLR-${crypto.randomUUID().split("-").slice(0, 3).join("-").toUpperCase()}`;

  db.prepare(`
    INSERT INTO purchases (id, productId, walletAddress, amount, currency, status, txHash, licenseKey, metadata, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.productId,
    data.walletAddress,
    data.amount,
    data.currency || "ZIPc",
    data.status || "pending",
    data.txHash || null,
    licenseKey,
    JSON.stringify(data.metadata || {}),
    now,
    now
  );

  return getPurchaseById(id);
}

/**
 * Get a purchase by ID.
 * @param {string} id - Purchase ID
 * @returns {Promise<object|null>} The purchase or null
 */
export async function getPurchaseById(id) {
  const db = getSqliteDb();
  const row = db.prepare("SELECT * FROM purchases WHERE id = ?").get(id);
  if (!row) return null;
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

/**
 * Get purchases by wallet address.
 * @param {string} walletAddress - Wallet address
 * @returns {Promise<object[]>} List of purchases
 */
export async function getPurchasesByWallet(walletAddress) {
  const db = getSqliteDb();
  const rows = db.prepare("SELECT * FROM purchases WHERE walletAddress = ? ORDER BY createdAt DESC").all(walletAddress);
  return rows.map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  }));
}

/**
 * Update a purchase record.
 * @param {string} id - Purchase ID
 * @param {object} data - Data to update
 * @returns {Promise<object|null>} The updated purchase or null
 */
export async function updatePurchase(id, data) {
  const db = getSqliteDb();
  const now = new Date().toISOString();

  const updates = [];
  const values = [];

  if (data.status !== undefined) {
    updates.push("status = ?");
    values.push(data.status);
  }
  if (data.txHash !== undefined) {
    updates.push("txHash = ?");
    values.push(data.txHash);
  }
  if (data.activatedAt !== undefined) {
    updates.push("activatedAt = ?");
    values.push(data.activatedAt);
  }
  if (data.expiresAt !== undefined) {
    updates.push("expiresAt = ?");
    values.push(data.expiresAt);
  }
  if (data.metadata !== undefined) {
    updates.push("metadata = ?");
    values.push(JSON.stringify(data.metadata));
  }

  updates.push("updatedAt = ?");
  values.push(now);
  values.push(id);

  if (updates.length > 1) {
    db.prepare(`UPDATE purchases SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  return getPurchaseById(id);
}

/**
 * Check if a wallet has an active license for a product.
 * @param {string} walletAddress - Wallet address
 * @param {string} productId - Product ID (optional, checks any product if not provided)
 * @returns {Promise<object|null>} The active purchase or null
 */
export async function getActiveLicense(walletAddress, productId = null) {
  const db = getSqliteDb();
  let query = "SELECT * FROM purchases WHERE walletAddress = ? AND status = 'completed'";
  const params = [walletAddress];

  if (productId) {
    query += " AND productId = ?";
    params.push(productId);
  }

  query += " ORDER BY createdAt DESC LIMIT 1";

  const row = db.prepare(query).get(...params);
  if (!row) return null;

  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}


// ============ Routing Pools ============

/**
 * Get all named routing pools
 */
export async function getRoutingPools() {
  const db = await getDb();
  return db.data.routingPools || [];
}

/**
 * Get a named routing pool by ID
 */
export async function getRoutingPool(id) {
  const db = await getDb();
  return (db.data.routingPools || []).find(p => p.id === id) || null;
}

/**
 * Create a named routing pool (group of provider connections)
 */
export async function createRoutingPool(data) {
  const db = await getDb();
  if (!db.data.routingPools) db.data.routingPools = [];

  const now = new Date().toISOString();
  const pool = {
    id: uuidv4(),
    name: data.name,
    description: data.description || "",
    providerIds: data.providerIds || [],
    tags: data.tags || [],
    isActive: data.isActive !== undefined ? data.isActive : true,
    priority: data.priority || 0,
    createdAt: now,
    updatedAt: now,
  };

  db.data.routingPools.push(pool);
  await db.write();
  return pool;
}

/**
 * Update a named routing pool
 */
export async function updateRoutingPool(id, data) {
  const db = await getDb();
  if (!db.data.routingPools) db.data.routingPools = [];

  const index = db.data.routingPools.findIndex(p => p.id === id);
  if (index === -1) return null;

  db.data.routingPools[index] = {
    ...db.data.routingPools[index],
    ...data,
    id,
    updatedAt: new Date().toISOString(),
  };

  await db.write();
  return db.data.routingPools[index];
}

/**
 * Delete a named routing pool
 */
export async function deleteRoutingPool(id) {
  const db = await getDb();
  if (!db.data.routingPools) return false;

  const index = db.data.routingPools.findIndex(p => p.id === id);
  if (index === -1) return false;

  db.data.routingPools.splice(index, 1);
  await db.write();
  return true;
}

// ── Multi-Tenancy ─────────────────────────────────────────────────────────────

export function createOrganization({ name, slug, plan = 'community' }) {
  const db = getSqliteDb(); if (!db) return null;
  const id = uuidv4();
  db.prepare(`INSERT INTO organizations (id, name, slug, plan, created_at) VALUES (?, ?, ?, ?, datetime('now'))`).run(id, name, slug, plan);
  return id;
}

export function getOrganization(idOrSlug) {
  const db = getSqliteDb(); if (!db) return null;
  return db.prepare(`SELECT * FROM organizations WHERE id = ? OR slug = ?`).get(idOrSlug, idOrSlug) ?? null;
}

export function listOrganizations() {
  const db = getSqliteDb(); if (!db) return [];
  return db.prepare(`SELECT * FROM organizations ORDER BY created_at DESC`).all();
}

export function createTeam({ orgId, name, slug }) {
  const db = getSqliteDb(); if (!db) return null;
  const id = uuidv4();
  db.prepare(`INSERT INTO teams (id, org_id, name, slug, created_at) VALUES (?, ?, ?, ?, datetime('now'))`).run(id, orgId, name, slug);
  return id;
}

export function listTeams(orgId) {
  const db = getSqliteDb(); if (!db) return [];
  return db.prepare(`SELECT * FROM teams WHERE org_id = ? ORDER BY name`).all(orgId);
}

export function addTeamMember({ teamId, userIdentifier, role = 'viewer' }) {
  const db = getSqliteDb(); if (!db) return;
  const id = uuidv4();
  db.prepare(`INSERT OR REPLACE INTO tenant_members (id, team_id, user_identifier, role, invited_at) VALUES (?, ?, ?, ?, datetime('now'))`).run(id, teamId, userIdentifier, role);
}

export function getTeamMember(teamId, userIdentifier) {
  const db = getSqliteDb(); if (!db) return null;
  return db.prepare(`SELECT * FROM tenant_members WHERE team_id = ? AND user_identifier = ?`).get(teamId, userIdentifier) ?? null;
}

export function listTeamMembers(teamId) {
  const db = getSqliteDb(); if (!db) return [];
  return db.prepare(`SELECT * FROM tenant_members WHERE team_id = ? ORDER BY invited_at DESC`).all(teamId);
}

export function removeTeamMember(teamId, userIdentifier) {
  const db = getSqliteDb(); if (!db) return;
  db.prepare(`DELETE FROM tenant_members WHERE team_id = ? AND user_identifier = ?`).run(teamId, userIdentifier);
}

export function getVirtualKeysByTeam(teamId) {
  const db = getSqliteDb(); if (!db) return [];
  return db.prepare(`SELECT * FROM virtual_keys WHERE team_id = ? AND is_active = 1 ORDER BY created_at DESC`).all(teamId);
}

// ── Compliance ────────────────────────────────────────────────────────────────

export function writeAuditLog({ actor, action, resourceType, resourceId, beforeJson, afterJson, ipAddress, userAgent } = {}) {
  const db = getSqliteDb(); if (!db) return;
  try {
    db.prepare(`INSERT INTO audit_log (actor, action, resource_type, resource_id, before_json, after_json, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(actor || null, action, resourceType || null, resourceId || null,
      beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson ? JSON.stringify(afterJson) : null,
      ipAddress || null, userAgent || null);
  } catch (e) { /* non-fatal */ }
}

export function getAuditLog({ limit = 100, offset = 0, actor = null, action = null, hours = 24 * 7 } = {}) {
  const db = getSqliteDb(); if (!db) return { entries: [], total: 0 };
  try {
    let where = `WHERE timestamp >= datetime('now', '-${Math.max(1, Math.min(hours, 8760))} hours')`;
    if (actor) where += ` AND actor = '${actor.replace(/'/g, "''")}'`;
    if (action) where += ` AND action LIKE '%${action.replace(/'/g, "''")}%'`;
    const total = db.prepare(`SELECT COUNT(*) as c FROM audit_log ${where}`).get()?.c ?? 0;
    const entries = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(limit, offset);
    return { entries, total };
  } catch (e) { return { entries: [], total: 0 }; }
}

export function writeAccessLog({ actor, method, path, statusCode, durationMs, ipAddress } = {}) {
  const db = getSqliteDb(); if (!db) return;
  try {
    db.prepare(`INSERT INTO access_log (actor, method, path, status_code, duration_ms, ip_address) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(actor || null, method || null, path || null, statusCode || null, durationMs || null, ipAddress || null);
  } catch (e) { /* non-fatal */ }
}

export function purgeOldTraces(retentionDays = 30) {
  const db = getSqliteDb(); if (!db) return 0;
  try {
    const { changes } = db.prepare(`DELETE FROM request_traces WHERE timestamp < datetime('now', '-${Math.max(1, Math.min(retentionDays, 3650))} days')`).run();
    return changes;
  } catch (e) { return 0; }
}

export function purgeVirtualKeyData(keyId) {
  const db = getSqliteDb(); if (!db) return;
  try {
    const key = db.prepare(`SELECT * FROM virtual_keys WHERE id = ?`).get(keyId);
    if (!key) return;
    // Delete all request traces linked to this virtual key
    db.prepare(`DELETE FROM request_traces WHERE virtual_key_id = ?`).run(keyId);
    // Delete any routing decisions that may reference this key via metadata
    // (no direct link — best-effort; routing_decisions are anonymized by design)
    // Hard-delete the virtual key record itself (GDPR: right to erasure)
    db.prepare(`DELETE FROM virtual_keys WHERE id = ?`).run(keyId);
    writeAuditLog({ action: 'gdpr_deletion', resourceType: 'virtual_key', resourceId: keyId });
  } catch (e) { /* non-fatal */ }
}

// ── SLA Monitoring ────────────────────────────────────────────────────────────

export function recordSlaEvent({ provider, latencyMs, success, errorCode, model } = {}) {
  const db = getSqliteDb(); if (!db) return;
  try {
    db.prepare(`INSERT INTO sla_events (provider, latency_ms, success, error_code, model) VALUES (?, ?, ?, ?, ?)`)
      .run(provider, latencyMs ?? null, success ? 1 : 0, errorCode ?? null, model ?? null);
  } catch (e) { /* non-fatal */ }
}

export function getSlaStats({ provider = null, hours = 24 } = {}) {
  const db = getSqliteDb(); if (!db) return [];
  try {
    const since = `datetime('now', '-${Math.max(1, Math.min(hours, 720))} hours')`;
    const where = `WHERE timestamp >= ${since}${provider ? ` AND provider = '${provider.replace(/'/g,"''")}' ` : ''}`;
    return db.prepare(`
      SELECT
        provider,
        COUNT(*) as total_requests,
        SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes,
        ROUND(SUM(CASE WHEN success=1 THEN 1.0 ELSE 0 END)*100.0/COUNT(*), 2) as uptime_pct,
        ROUND(AVG(CASE WHEN success=1 THEN latency_ms END), 0) as avg_latency_ms,
        MAX(latency_ms) as max_latency_ms,
        MIN(CASE WHEN success=1 THEN latency_ms END) as min_latency_ms
      FROM sla_events ${where}
      GROUP BY provider
      ORDER BY total_requests DESC
    `).all();
  } catch (e) { return []; }
}

export function getSlaPctLatency({ provider, pct = 95, hours = 24 } = {}) {
  const db = getSqliteDb(); if (!db) return null;
  try {
    const since = `datetime('now', '-${Math.max(1, Math.min(hours, 720))} hours')`;
    const rows = db.prepare(
      `SELECT latency_ms FROM sla_events WHERE timestamp >= ${since} AND provider = ? AND success = 1 AND latency_ms IS NOT NULL ORDER BY latency_ms`
    ).all(provider);
    if (!rows.length) return null;
    const idx = Math.ceil(rows.length * pct / 100) - 1;
    return rows[Math.min(idx, rows.length - 1)]?.latency_ms ?? null;
  } catch (e) { return null; }
}

export function getSlaConfig(provider) {
  const db = getSqliteDb(); if (!db) return null;
  return db.prepare(`SELECT * FROM sla_config WHERE provider = ?`).get(provider) ?? null;
}

export function upsertSlaConfig({ provider, targetUptimePct, targetP95LatencyMs, autoDisable, breachWindowMinutes } = {}) {
  const db = getSqliteDb(); if (!db) return;
  db.prepare(`
    INSERT INTO sla_config (provider, target_uptime_pct, target_p95_latency_ms, auto_disable_on_breach, breach_window_minutes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      target_uptime_pct = excluded.target_uptime_pct,
      target_p95_latency_ms = excluded.target_p95_latency_ms,
      auto_disable_on_breach = excluded.auto_disable_on_breach,
      breach_window_minutes = excluded.breach_window_minutes
  `).run(provider, targetUptimePct ?? 99.5, targetP95LatencyMs ?? 2000, autoDisable ? 1 : 0, breachWindowMinutes ?? 60);
}

export function disableProviderSla(provider, reason) {
  const db = getSqliteDb(); if (!db) return;
  db.prepare(`
    INSERT INTO sla_config (provider, is_disabled, disabled_at, disabled_reason)
    VALUES (?, 1, datetime('now'), ?)
    ON CONFLICT(provider) DO UPDATE SET is_disabled=1, disabled_at=datetime('now'), disabled_reason=excluded.disabled_reason
  `).run(provider, reason || 'SLA breach');
}

export function enableProviderSla(provider) {
  const db = getSqliteDb(); if (!db) return;
  db.prepare(`UPDATE sla_config SET is_disabled=0, disabled_at=NULL, disabled_reason=NULL WHERE provider=?`).run(provider);
}

export function getDisabledProviders() {
  const db = getSqliteDb(); if (!db) return [];
  return db.prepare(`SELECT provider FROM sla_config WHERE is_disabled=1`).all().map(r => r.provider);
}

// ── ZippyVault — local encrypted credential store ─────────────────────────────

export function vaultListEntries() {
  const db = getSqliteDb(); if (!db) return [];
  return db.prepare(`SELECT id, name, label, category, tags, created_at, updated_at FROM vault_entries ORDER BY name ASC`).all();
}

export function vaultStoreEntry({ name, label, category, encrypted_value, salt, iv, tag, tags }) {
  const db = getSqliteDb(); if (!db) return null;
  return db.prepare(`INSERT INTO vault_entries (name, label, category, encrypted_value, salt, iv, tag, tags, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET
      label=excluded.label, category=excluded.category,
      encrypted_value=excluded.encrypted_value, salt=excluded.salt,
      iv=excluded.iv, tag=excluded.tag, tags=excluded.tags,
      updated_at=datetime('now')`
  ).run(name, label || name, category || 'api-key', encrypted_value, salt, iv, tag, tags || null).lastInsertRowid;
}

export function vaultGetEntry(name) {
  const db = getSqliteDb(); if (!db) return null;
  return db.prepare(`SELECT * FROM vault_entries WHERE name = ?`).get(name) ?? null;
}

export function vaultDeleteEntry(name) {
  const db = getSqliteDb(); if (!db) return 0;
  return db.prepare(`DELETE FROM vault_entries WHERE name = ?`).run(name).changes;
}

export function vaultCreateAgentRequest({ agent, entry_name, reason }) {
  const db = getSqliteDb(); if (!db) return null;
  return db.prepare(`INSERT INTO vault_agent_requests (agent, entry_name, reason) VALUES (?, ?, ?)`).run(agent, entry_name, reason || null).lastInsertRowid;
}

export function vaultListAgentRequests(status = null) {
  const db = getSqliteDb(); if (!db) return [];
  if (status) return db.prepare(`SELECT * FROM vault_agent_requests WHERE status = ? ORDER BY created_at DESC`).all(status);
  return db.prepare(`SELECT * FROM vault_agent_requests ORDER BY created_at DESC`).all();
}

export function vaultResolveAgentRequest(id, status) {
  const db = getSqliteDb(); if (!db) return;
  db.prepare(`UPDATE vault_agent_requests SET status = ?, resolved_at = datetime('now') WHERE id = ?`).run(status, id);
}
