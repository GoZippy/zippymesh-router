import { v4 as uuidv4 } from "uuid";
import { getSqliteDb, ensureSqliteSync } from "./localDb.js";

const LIFECYCLE_STATES = new Set(["active", "missing", "deprecated"]);
const DEFAULT_LIFECYCLE_STATE = "active";

function normalizeLifecycleState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return LIFECYCLE_STATES.has(normalized) ? normalized : DEFAULT_LIFECYCLE_STATE;
}

function normalizeModelIds(modelIds) {
  if (!Array.isArray(modelIds)) return [];
  const next = new Set();
  for (const candidate of modelIds) {
    const modelId = String(candidate || "").trim();
    if (modelId) next.add(modelId);
  }
  return Array.from(next);
}

function safeParseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Global Model Registry Service
 * Handles unified model discovery, pricing, and health across all providers.
 */

/**
 * Get all models from the registry
 */
export async function getRegistryModels(filter = {}) {
    await ensureSqliteSync();
    const sqlite = getSqliteDb();

    let query = `SELECT * FROM model_registry WHERE 1=1`;
    const params = [];

    if (filter.provider) {
        query += ` AND provider = ?`;
        params.push(filter.provider);
    }

    if (filter.isFree !== undefined) {
        query += ` AND is_free = ?`;
        params.push(filter.isFree ? 1 : 0);
    }

    if (filter.lifecycleState) {
      if (Array.isArray(filter.lifecycleState)) {
        const lifecycleStates = filter.lifecycleState
          .map((state) => String(state || "").trim().toLowerCase())
          .filter((state) => state);
        if (lifecycleStates.length > 0) {
          query += ` AND lifecycle_state IN (${lifecycleStates.map(() => "?").join(", ")})`;
          params.push(...lifecycleStates);
        }
      } else {
        query += ` AND lifecycle_state = ?`;
        params.push(String(filter.lifecycleState).trim().toLowerCase());
      }
    }

    if (filter.search) {
        query += ` AND (name LIKE ? OR model_id LIKE ?)`;
        params.push(`%${filter.search}%`);
        params.push(`%${filter.search}%`);
    }

    const rows = sqlite.prepare(query).all(...params);
    return rows.map(mapModelRow);
}

/**
 * Get a specific model from the registry
 */
export async function getRegistryModel(provider, modelId) {
    await ensureSqliteSync();
    const sqlite = getSqliteDb();
    const row = sqlite.prepare(`SELECT * FROM model_registry WHERE provider = ? AND model_id = ?`).get(provider, modelId);
    return row ? mapModelRow(row) : null;
}

/**
 * Register or update a model in the registry
 */
export async function registerModel(data) {
    await ensureSqliteSync();
    const sqlite = getSqliteDb();
    const now = new Date().toISOString();
    const firstSeenAt = data.firstSeenAt || now;
    const lifecycleState = normalizeLifecycleState(data.lifecycleState);

    const id = uuidv4();

    sqlite.prepare(`
    INSERT INTO model_registry (
      id, provider, model_id, name, description, 
      input_price, output_price, request_price, context_window,
      is_free, is_preview, is_premium, last_sync, metadata,
      first_seen_at, last_seen_at, missing_since_at, lifecycle_state, replacement_metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, model_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      input_price = excluded.input_price,
      output_price = excluded.output_price,
      request_price = excluded.request_price,
      context_window = excluded.context_window,
      is_free = excluded.is_free,
      is_preview = excluded.is_preview,
      is_premium = excluded.is_premium,
      last_sync = excluded.last_sync,
      metadata = excluded.metadata,
      first_seen_at = COALESCE(model_registry.first_seen_at, excluded.first_seen_at),
      last_seen_at = excluded.last_seen_at,
      missing_since_at = excluded.missing_since_at,
      lifecycle_state = excluded.lifecycle_state,
      replacement_metadata = excluded.replacement_metadata
  `).run(
        id, data.provider, data.modelId, data.name || data.modelId, data.description || null,
        data.inputPrice || 0, data.outputPrice || 0, data.requestPrice || 0, data.contextWindow || null,
        data.isFree ? 1 : 0, data.isPreview ? 1 : 0, data.isPremium ? 1 : 0, now,
        data.metadata ? JSON.stringify(data.metadata) : null,
        firstSeenAt,
        now,
        data.missingSinceAt || null,
        lifecycleState,
        data.replacementMetadata ? JSON.stringify(data.replacementMetadata) : null
    );

    return await getRegistryModel(data.provider, data.modelId);
}

/**
 * Update model health metrics
 */
export async function updateModelHealth(provider, modelId, metrics) {
    await ensureSqliteSync();
    const sqlite = getSqliteDb();

    sqlite.prepare(`
    UPDATE model_registry 
    SET avg_latency = ?, avg_tps = ?
    WHERE provider = ? AND model_id = ?
  `).run(metrics.latency || 0, metrics.tps || 0, provider, modelId);
}

/**
 * Mark missing/missing->deprecated/reattivated states for a provider's catalog models.
 */
export async function reconcileProviderModelLifecycle(provider, seenModelIds = []) {
  await ensureSqliteSync();
  const sqlite = getSqliteDb();
  const now = new Date().toISOString();
  const seen = new Set(normalizeModelIds(seenModelIds));
  const existing = sqlite.prepare(`
    SELECT model_id, lifecycle_state, missing_since_at
    FROM model_registry
    WHERE provider = ?
  `).all(provider);

  let missingMarked = 0;
  let deprecatedMarked = 0;
  let reactivated = 0;
  let unchanged = 0;
  let lastMissingSinceAt = now;

  const setActive = sqlite.prepare(`
    UPDATE model_registry
    SET lifecycle_state = 'active', missing_since_at = NULL, last_seen_at = ?, replacement_metadata = NULL
    WHERE provider = ? AND model_id = ?
  `);
  const setMissing = sqlite.prepare(`
    UPDATE model_registry
    SET lifecycle_state = 'missing', missing_since_at = COALESCE(missing_since_at, ?)
    WHERE provider = ? AND model_id = ?
  `);
  const setDeprecated = sqlite.prepare(`
    UPDATE model_registry
    SET lifecycle_state = 'deprecated',
        missing_since_at = COALESCE(missing_since_at, ?),
        replacement_metadata = COALESCE(?, replacement_metadata)
    WHERE provider = ? AND model_id = ?
  `);
  const updateLastSeen = sqlite.prepare(`
    UPDATE model_registry
    SET last_seen_at = ?
    WHERE provider = ? AND model_id = ?
  `);

  for (const row of existing) {
    const modelId = row.model_id;
    const lifecycleState = normalizeLifecycleState(row.lifecycle_state);
    const isSeen = seen.has(modelId);

    if (isSeen) {
      if (lifecycleState !== "active") {
        setActive.run(now, provider, modelId);
        reactivated += 1;
      } else {
        unchanged += 1;
      }
      updateLastSeen.run(now, provider, modelId);
      continue;
    }

    if (lifecycleState === "deprecated") {
      unchanged += 1;
      continue;
    }

    if (lifecycleState === "missing") {
      const replacementMetadata = JSON.stringify({
        reason: "provider_catalog_missing",
        provider,
        modelId,
        missingSinceAt: row.missing_since_at || now,
        observedAt: now,
      });
      setDeprecated.run(now, replacementMetadata, provider, modelId);
      deprecatedMarked += 1;
      lastMissingSinceAt = row.missing_since_at || now;
      continue;
    }

    setMissing.run(now, provider, modelId);
    missingMarked += 1;
  }

  return {
    provider,
    seenCount: seen.size,
    unchangedCount: unchanged,
    missingMarked,
    deprecatedMarked,
    reactivatedCount: reactivated,
    lastMissingSinceAt,
  };
}

function mapModelRow(row) {
    return {
        ...row,
        modelId: row.model_id,
        inputPrice: row.input_price,
        outputPrice: row.output_price,
        requestPrice: row.request_price,
        contextWindow: row.context_window,
        isFree: row.is_free === 1,
        isPreview: row.is_preview === 1,
        isPremium: row.is_premium === 1,
        avgLatency: row.avg_latency,
        avgTps: row.avg_tps,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        missingSinceAt: row.missing_since_at,
        lifecycleState: row.lifecycle_state || DEFAULT_LIFECYCLE_STATE,
        replacementMetadata: safeParseJson(row.replacement_metadata),
        metadata: safeParseJson(row.metadata),
    };
}
