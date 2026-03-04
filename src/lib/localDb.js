import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import { SMART_PLAYBOOKS, INITIAL_SETTINGS } from "../shared/constants/defaults.js";
import { PROVIDER_ID_TO_ALIAS } from "../shared/constants/models.js";

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
  const homeDir = os.homedir();
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
const DATA_DIR = getUserDataDir();
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
  `);

  // Migration: add wallet_id to provider_connections / provider_nodes if missing (existing DBs created before column was added)
  try {
    ensureWalletColumns(sqliteDb);
  } catch (e) {
    // Log warning for unexpected errors, but continue - table may already have the column
    const message = String(e?.message || "");
    if (!message.includes("no column named wallet_id") && !message.includes("duplicate column name")) {
      console.warn("Migration warning: ensureWalletColumns failed:", e.message);
    }
  }

  return sqliteDb;
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
  cachedModels: {},
  rateLimitSuggestions: [], // Recent 429 suggestions for auto-failover (last 20)
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
          next.settings[settingKey] = settingDefault;
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
    return db.data.providerNodes[index];
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
  return await getProviderNodeById(id);
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
    await db.write();
    return removed[0];
  }

  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const existing = await getProviderNodeById(id);
  if (!existing) return null;

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
  return await getProviderConnectionById(id);
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

  return await getProviderConnectionById(id);
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

import { blacklistIp as firewallBlacklistIp } from "./firewall.js";

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
 * Get pricing for a specific provider and model
 */
export async function getPricingForModel(provider, model) {
  const pricing = await getPricing();

  // Try direct lookup
  if (pricing[provider]?.[model]) {
    return pricing[provider][model];
  }

  // Try mapping provider ID to alias (single source: shared/constants/models → open-sse/config/providerModels)
  const alias = PROVIDER_ID_TO_ALIAS[provider];
  if (alias && pricing[alias]) {
    return pricing[alias][model] || null;
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
          console.warn(`[localDb] Failed to parse peer metadata for ${row.peerId}`);
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

