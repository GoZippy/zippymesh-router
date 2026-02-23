import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SMART_PLAYBOOKS, INITIAL_SETTINGS } from "../shared/constants/defaults.js";

// Detect environment: Cloud (Workers/Edge) vs Local (Node.js)
// Checking 'caches' is unreliable in Node 18+ as it's often polyfilled
const isCloud = typeof process === 'undefined' || !process.versions || !process.versions.node;


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
    const envKey = 'APP' + 'DATA';
    const appDataEnv = process.env[envKey];
    if (appDataEnv) {
      return `${appDataEnv}\\${appName}`;
    }
    // Fallback if APPDATA is missing, use base64 decoding to evade Next.js NFT AST tracing
    const getRoaming = () => Buffer.from("QXBwRGF0YVxSb2FtaW5n", "base64").toString("utf-8");
    return `${homeDir}\\${getRoaming()}\\${appName}`;
  } else {
    // macOS & Linux: ~/.{appName}
    return `${homeDir}/.${appName}`;
  }
}

// Data file path - stored in user home directory
const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "db.json");

// Ensure data directory exists
if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
  settings: {
    cloudEnabled: false,
    stickyRoundRobinLimit: 3,
    requireLogin: true,
    isDemoMode: false
  },

  pricing: {}, // pricing configuration
  routingPlaybooks: [], // NEW: routing playbooks
  rateLimitConfigs: DEFAULT_RATE_LIMITS, // NEW: rate limit configurations
  rateLimitState: {}, // NEW: persisted rate limit state
  p2pOffers: [], // NEW: marketplace offers from peers
  p2pSubscriptions: [], // NEW: active node-to-node subscriptions
  cachedModels: {},
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
    cachedModels: {}
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

// ============ Provider Connections ============

/**
 * Get all provider connections
 */
export async function getProviderConnections(filter = {}) {
  const db = await getDb();
  let connections = db.data.providerConnections || [];

  if (filter.provider) {
    connections = connections.filter(c => c.provider === filter.provider);
  }
  if (filter.group) {
    connections = connections.filter(c => c.group === filter.group);
  }
  if (filter.isActive !== undefined) {
    connections = connections.filter(c => c.isActive === filter.isActive);
  }

  // Sort by priority (lower = higher priority)
  connections.sort((a, b) => (a.priority || 999) - (b.priority || 999));

  return connections;
}

// ============ Provider Nodes ============

/**
 * Get provider nodes
 */
export async function getProviderNodes(filter = {}) {
  const db = await getDb();
  let nodes = db.data.providerNodes || [];

  if (filter.type) {
    nodes = nodes.filter((node) => node.type === filter.type);
  }

  return nodes;
}

/**
 * Get provider node by ID
 */
export async function getProviderNodeById(id) {
  const db = await getDb();
  return db.data.providerNodes.find((node) => node.id === id) || null;
}

/**
 * Create provider node
 */
export async function createProviderNode(data) {
  const db = await getDb();

  // Initialize providerNodes if undefined (backward compatibility)
  if (!db.data.providerNodes) {
    db.data.providerNodes = [];
  }

  const now = new Date().toISOString();

  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };

  db.data.providerNodes.push(node);
  await db.write();

  return node;
}

/**
 * Update provider node
 */
export async function updateProviderNode(id, data) {
  const db = await getDb();
  if (!db.data.providerNodes) {
    db.data.providerNodes = [];
  }

  const index = db.data.providerNodes.findIndex((node) => node.id === id);

  if (index === -1) return null;

  db.data.providerNodes[index] = {
    ...db.data.providerNodes[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await db.write();

  return db.data.providerNodes[index];
}

/**
 * Delete provider node
 */
export async function deleteProviderNode(id) {
  const db = await getDb();
  if (!db.data.providerNodes) {
    db.data.providerNodes = [];
  }

  const index = db.data.providerNodes.findIndex((node) => node.id === id);

  if (index === -1) return null;

  const [removed] = db.data.providerNodes.splice(index, 1);
  await db.write();

  return removed;
}

/**
 * Delete all provider connections by provider ID
 */
export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getDb();
  const beforeCount = db.data.providerConnections.length;
  db.data.providerConnections = db.data.providerConnections.filter(
    (connection) => connection.provider !== providerId
  );
  const deletedCount = beforeCount - db.data.providerConnections.length;
  await db.write();
  return deletedCount;
}

/**
 * Get provider connection by ID
 */
export async function getProviderConnectionById(id) {
  const db = await getDb();
  return db.data.providerConnections.find(c => c.id === id) || null;
}

/**
 * Create or update provider connection (upsert by provider + email/name)
 */
export async function createProviderConnection(data) {
  const db = await getDb();
  const now = new Date().toISOString();

  // Check for existing connection by explicit connectionId,
  // or by same provider and email (for OAuth),
  // or by same provider and name (for API key)
  let existingIndex = -1;
  if (data.connectionId) {
    existingIndex = db.data.providerConnections.findIndex(c => c.id === data.connectionId);
  } else if (data.authType === "oauth" && data.email) {
    existingIndex = db.data.providerConnections.findIndex(
      c => c.provider === data.provider && c.authType === "oauth" && c.email === data.email
    );
  } else if (data.authType === "apikey" && data.name) {
    existingIndex = db.data.providerConnections.findIndex(
      c => c.provider === data.provider && c.authType === "apikey" && c.name === data.name
    );
  }

  // If exists, update instead of create
  if (existingIndex !== -1) {
    db.data.providerConnections[existingIndex] = {
      ...db.data.providerConnections[existingIndex],
      ...data,
      updatedAt: now,
    };
    await db.write();
    return db.data.providerConnections[existingIndex];
  }

  // Generate name for OAuth if not provided
  let connectionName = data.name || null;
  if (!connectionName && data.authType === "oauth") {
    if (data.email) {
      connectionName = data.email;
    } else {
      // Count existing connections for this provider to generate index
      const existingCount = db.data.providerConnections.filter(
        c => c.provider === data.provider
      ).length;
      connectionName = `Account ${existingCount + 1}`;
    }
  }

  // Auto-increment priority if not provided
  let connectionPriority = data.priority;
  if (!connectionPriority) {
    const providerConnections = db.data.providerConnections.filter(
      c => c.provider === data.provider
    );
    const maxPriority = providerConnections.reduce((max, c) => Math.max(max, c.priority || 0), 0);
    connectionPriority = maxPriority + 1;
  }

  // Create new connection - only save fields with actual values
  const connection = {
    id: uuidv4(),
    provider: data.provider,
    authType: data.authType || "oauth",
    name: connectionName,
    group: data.group || "default",
    priority: connectionPriority,
    isActive: data.isActive !== undefined ? data.isActive : true,
    createdAt: now,
    updatedAt: now,
  };

  // Only add optional fields if they have values
  const optionalFields = [
    "displayName", "email", "globalPriority", "defaultModel", "group",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "idToken", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
    "consecutiveUseCount", "latency", "tps"
  ];

  for (const field of optionalFields) {
    if (data[field] !== undefined && data[field] !== null) {
      connection[field] = data[field];
    }
  }

  // Only add providerSpecificData if it has content
  if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
    connection.providerSpecificData = data.providerSpecificData;
  }

  db.data.providerConnections.push(connection);
  await db.write();

  // Reorder to ensure consistency
  await reorderProviderConnections(data.provider);

  return connection;
}

/**
 * Update provider connection
 */
export async function updateProviderConnection(id, data) {
  const db = await getDb();
  const index = db.data.providerConnections.findIndex(c => c.id === id);

  if (index === -1) return null;

  const providerId = db.data.providerConnections[index].provider;

  db.data.providerConnections[index] = {
    ...db.data.providerConnections[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await db.write();

  // Reorder if priority was changed
  if (data.priority !== undefined) {
    await reorderProviderConnections(providerId);
  }

  return db.data.providerConnections[index];
}

/**
 * Delete provider connection
 */
export async function deleteProviderConnection(id) {
  const db = await getDb();
  const index = db.data.providerConnections.findIndex(c => c.id === id);

  if (index === -1) return false;

  const providerId = db.data.providerConnections[index].provider;

  db.data.providerConnections.splice(index, 1);
  await db.write();

  // Reorder to fill gaps
  await reorderProviderConnections(providerId);

  return true;
}

/**
 * Reorder provider connections to ensure unique, sequential priorities
 */
export async function reorderProviderConnections(providerId) {
  const db = await getDb();
  if (!db.data.providerConnections) return;

  const providerConnections = db.data.providerConnections
    .filter(c => c.provider === providerId)
    .sort((a, b) => {
      // Sort by priority first
      const pDiff = (a.priority || 0) - (b.priority || 0);
      if (pDiff !== 0) return pDiff;
      // Use updatedAt as tie-breaker (newer first)
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

  // Re-assign sequential priorities
  providerConnections.forEach((conn, index) => {
    conn.priority = index + 1;
  });

  await db.write();
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
  if (db.data.settings?.nodeIdentity) {
    return db.data.settings.nodeIdentity;
  }

  // Generate new key pair
  const { generateKeyPair } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const generate = promisify(generateKeyPair);

  const { publicKey, privateKey } = await generate("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const identity = {
    publicKey,
    privateKey,
    createdAt: new Date().toISOString()
  };

  db.data.settings.nodeIdentity = identity;
  await db.write();
  return identity;
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
 * Get pricing for a specific provider and model
 */
export async function getPricingForModel(provider, model) {
  const pricing = await getPricing();

  // Try direct lookup
  if (pricing[provider]?.[model]) {
    return pricing[provider][model];
  }

  // Try mapping provider ID to alias
  // We need to duplicate the mapping here or import it
  // Since we can't easily import from open-sse, we'll implement the mapping locally
  const PROVIDER_ID_TO_ALIAS = {
    claude: "cc",
    codex: "cx",
    "gemini-cli": "gc",
    qwen: "qw",
    iflow: "if",
    antigravity: "ag",
    github: "gh",
    openai: "openai",
    anthropic: "anthropic",
    gemini: "gemini",
    openrouter: "openrouter",
    glm: "glm",
    kimi: "kimi",
    minimax: "minimax",
  };

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
    rules: data.rules || [], // Array of rule objects
    isActive: data.isActive !== undefined ? data.isActive : true,
    priority: data.priority || 0,
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
