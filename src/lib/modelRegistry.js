import { v4 as uuidv4 } from "uuid";
import { getSqliteDb, ensureSqliteSync } from "./localDb.js";

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

    const id = uuidv4();

    sqlite.prepare(`
    INSERT INTO model_registry (
      id, provider, model_id, name, description, 
      input_price, output_price, request_price, context_window,
      is_free, is_preview, is_premium, last_sync, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      metadata = excluded.metadata
  `).run(
        id, data.provider, data.modelId, data.name || data.modelId, data.description || null,
        data.inputPrice || 0, data.outputPrice || 0, data.requestPrice || 0, data.contextWindow || null,
        data.isFree ? 1 : 0, data.isPreview ? 1 : 0, data.isPremium ? 1 : 0, now,
        data.metadata ? JSON.stringify(data.metadata) : null
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
        metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
}
