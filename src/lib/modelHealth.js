/**
 * Model Health Tracker
 *
 * Tracks per-(provider, modelId) failure counts and implements exponential
 * backoff when a model consistently fails to load or returns 400-class errors.
 *
 * Backoff schedule (after DEGRADE_THRESHOLD consecutive failures):
 *   Tier 0 → 5 min
 *   Tier 1 → 15 min
 *   Tier 2 → 30 min
 *   Tier 3+ → 1 hour (capped)
 *
 * Integration:
 *   - orchestrator.js: call recordModelFailure / recordModelSuccess on each attempt
 *   - failoverManager.js: filter candidates through isModelDegraded
 *   - /api/provider-status: call getDegradedModels for the status response
 */

import { getSqliteDb } from './localDb.js';

const DEGRADE_THRESHOLD = 3;

// Backoff durations in ms per tier
const BACKOFF_MS = [
  5  * 60 * 1000,  // tier 0 → 5 min
  15 * 60 * 1000,  // tier 1 → 15 min
  30 * 60 * 1000,  // tier 2 → 30 min
  60 * 60 * 1000,  // tier 3+ → 1 hour
];

function backoffMs(tier) {
  return BACKOFF_MS[Math.min(tier, BACKOFF_MS.length - 1)];
}

// Lazy-initialised prepared statements
let _stmts = null;

function ensureTable() {
  const db = getSqliteDb();
  if (!db) return null;

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_health (
      id           TEXT PRIMARY KEY,
      provider     TEXT NOT NULL,
      model_id     TEXT NOT NULL,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_failure_at      INTEGER,
      last_failure_type    TEXT,
      degraded             INTEGER NOT NULL DEFAULT 0,
      degraded_since_at    INTEGER,
      backoff_tier         INTEGER NOT NULL DEFAULT 0,
      next_probe_at        INTEGER,
      last_success_at      INTEGER,
      updated_at           INTEGER NOT NULL,
      UNIQUE(provider, model_id)
    );
    CREATE INDEX IF NOT EXISTS idx_model_health_degraded
      ON model_health(degraded, next_probe_at);
  `);

  return db;
}

function stmts() {
  if (_stmts) return _stmts;
  const db = ensureTable();
  if (!db) return null;

  _stmts = {
    upsertFail: db.prepare(`
      INSERT INTO model_health
        (id, provider, model_id, consecutive_failures, last_failure_at,
         last_failure_type, degraded, degraded_since_at, backoff_tier,
         next_probe_at, updated_at)
      VALUES
        (lower(hex(randomblob(8))), ?, ?, 1, ?, ?, 0, NULL, 0, NULL, ?)
      ON CONFLICT(provider, model_id) DO UPDATE SET
        consecutive_failures = consecutive_failures + 1,
        last_failure_at      = excluded.last_failure_at,
        last_failure_type    = excluded.last_failure_type,
        updated_at           = excluded.updated_at
    `),

    markDegraded: db.prepare(`
      UPDATE model_health
      SET degraded          = 1,
          degraded_since_at = ?,
          backoff_tier      = ?,
          next_probe_at     = ?,
          updated_at        = ?
      WHERE provider = ? AND model_id = ?
    `),

    escalateBackoff: db.prepare(`
      UPDATE model_health
      SET backoff_tier  = MIN(backoff_tier + 1, 3),
          next_probe_at = ?,
          updated_at    = ?
      WHERE provider = ? AND model_id = ? AND degraded = 1
    `),

    recordSuccess: db.prepare(`
      INSERT INTO model_health
        (id, provider, model_id, consecutive_failures, last_success_at,
         degraded, degraded_since_at, backoff_tier, next_probe_at, updated_at)
      VALUES
        (lower(hex(randomblob(8))), ?, ?, 0, ?, 0, NULL, 0, NULL, ?)
      ON CONFLICT(provider, model_id) DO UPDATE SET
        consecutive_failures = 0,
        last_success_at      = excluded.last_success_at,
        degraded             = 0,
        degraded_since_at    = NULL,
        backoff_tier         = 0,
        next_probe_at        = NULL,
        updated_at           = excluded.updated_at
    `),

    getRow: db.prepare(`
      SELECT * FROM model_health WHERE provider = ? AND model_id = ?
    `),

    getDegraded: db.prepare(`
      SELECT * FROM model_health WHERE degraded = 1 ORDER BY provider, model_id
    `),

    getAll: db.prepare(`
      SELECT * FROM model_health ORDER BY provider, model_id
    `),
  };

  return _stmts;
}

/**
 * Record a model failure.
 * @param {string} provider
 * @param {string} modelId
 * @param {string} [failureType]  - e.g. '400', '422', 'load_fail', 'timeout'
 */
export function recordModelFailure(provider, modelId, failureType = 'error') {
  const s = stmts();
  if (!s) return;

  const now = Date.now();
  s.upsertFail.run(provider, modelId, now, failureType, now);

  const row = s.getRow.get(provider, modelId);
  if (!row) return;

  if (!row.degraded && row.consecutive_failures >= DEGRADE_THRESHOLD) {
    // First degradation
    s.markDegraded.run(now, 0, now + backoffMs(0), now, provider, modelId);
    console.warn(
      `[modelHealth] ${provider}/${modelId} degraded after ${row.consecutive_failures} consecutive failures — next probe in 5m`
    );
  } else if (row.degraded) {
    // Already degraded — this is a failed probe; escalate backoff
    const newTier = Math.min((row.backoff_tier || 0) + 1, 3);
    const delay = backoffMs(newTier);
    s.escalateBackoff.run(now + delay, now, provider, modelId);
    console.warn(
      `[modelHealth] ${provider}/${modelId} probe failed — backoff tier ${newTier}, next probe in ${delay / 60000}m`
    );
  }
}

/**
 * Record a successful completion for a model.
 * Resets failure count and clears degraded state.
 */
export function recordModelSuccess(provider, modelId) {
  const s = stmts();
  if (!s) return;

  const now = Date.now();
  const row = s.getRow.get(provider, modelId);
  if (row?.degraded) {
    console.info(`[modelHealth] ${provider}/${modelId} recovered — clearing degraded state`);
  }
  s.recordSuccess.run(provider, modelId, now, now);
}

/**
 * Check whether a model is currently in its backoff window.
 * Returns true  → skip this model (still cooling down)
 * Returns false → model is healthy OR its probe window has opened
 */
export function isModelDegraded(provider, modelId) {
  const s = stmts();
  if (!s) return false;

  const row = s.getRow.get(provider, modelId);
  if (!row || !row.degraded) return false;

  // If next_probe_at has passed, allow ONE attempt through (probe window open)
  if (row.next_probe_at && Date.now() >= row.next_probe_at) return false;

  return true;
}

/**
 * Returns all currently-degraded models with their backoff metadata.
 * @returns {Array<{provider, modelId, consecutiveFailures, degradedSinceAt, backoffTier, nextProbeAt}>}
 */
export function getDegradedModels() {
  const s = stmts();
  if (!s) return [];

  return s.getDegraded.all().map((r) => ({
    provider: r.provider,
    modelId: r.model_id,
    consecutiveFailures: r.consecutive_failures,
    lastFailureType: r.last_failure_type,
    degradedSinceAt: r.degraded_since_at ? new Date(r.degraded_since_at).toISOString() : null,
    backoffTier: r.backoff_tier,
    nextProbeAt: r.next_probe_at ? new Date(r.next_probe_at).toISOString() : null,
    probeWindowOpen: r.next_probe_at ? Date.now() >= r.next_probe_at : true,
  }));
}

/**
 * Returns full health summary for all tracked models (for /api/provider-status).
 */
export function getModelHealthSummary() {
  const s = stmts();
  if (!s) return [];

  return s.getAll.all().map((r) => ({
    provider: r.provider,
    modelId: r.model_id,
    consecutiveFailures: r.consecutive_failures,
    lastFailureType: r.last_failure_type,
    lastFailureAt: r.last_failure_at ? new Date(r.last_failure_at).toISOString() : null,
    lastSuccessAt: r.last_success_at ? new Date(r.last_success_at).toISOString() : null,
    degraded: !!r.degraded,
    degradedSinceAt: r.degraded_since_at ? new Date(r.degraded_since_at).toISOString() : null,
    backoffTier: r.backoff_tier,
    nextProbeAt: r.next_probe_at ? new Date(r.next_probe_at).toISOString() : null,
    probeWindowOpen: r.next_probe_at ? Date.now() >= r.next_probe_at : !r.degraded,
  }));
}

export default {
  recordModelFailure,
  recordModelSuccess,
  isModelDegraded,
  getDegradedModels,
  getModelHealthSummary,
};
