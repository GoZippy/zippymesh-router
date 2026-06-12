/**
 * routingIntelligence.js — Lightweight local ML scoring from routing history.
 *
 * Reads from routingMemory to produce intent-aware model boost/penalty scores
 * that feed into the playbook engine. Results cached for 1 hour to avoid
 * re-running on every request.
 */

import { getLocalDb } from "@/lib/localDb.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_SAMPLES = 5; // Minimum data points to trust a score

let _cachedResult = null;
let _cacheTime = 0;

/**
 * Analyse routing memory from the routing_decisions table.
 * Returns adjusment scores per intent + model combination.
 *
 * Shape:
 *   {
 *     intentModelBoosts: { [intent]: { [model]: deltaScore } },
 *     sessionProviderPenalties: { [provider]: penaltyScore },
 *     topModelByIntent: { [intent]: { model, successRate, samples } },
 *     totalSamples: number,
 *   }
 */
export function analyzeRoutingMemory() {
  const now = Date.now();
  if (_cachedResult && now - _cacheTime < CACHE_TTL_MS) {
    return _cachedResult;
  }

  const empty = {
    intentModelBoosts: {},
    sessionProviderPenalties: {},
    topModelByIntent: {},
    totalSamples: 0,
  };

  let db;
  try {
    db = getLocalDb();
  } catch {
    return empty;
  }
  if (!db) return empty;

  try {
    // Total samples
    const totalRow = db.prepare("SELECT COUNT(*) as c FROM routing_decisions").get();
    const totalSamples = totalRow?.c ?? 0;
    if (totalSamples < MIN_SAMPLES) {
      _cachedResult = { ...empty, totalSamples };
      _cacheTime = now;
      return _cachedResult;
    }

    // Per-intent, per-model success/failure aggregation
    const rows = db.prepare(`
      SELECT intent, used_model, 
             COUNT(*) as total,
             SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes
      FROM routing_decisions
      WHERE intent IS NOT NULL AND used_model IS NOT NULL
      GROUP BY intent, used_model
      HAVING COUNT(*) >= ?
    `).all(MIN_SAMPLES);

    const intentModelBoosts = {};
    const topModelByIntent = {};

    for (const row of rows) {
      const intent = row.intent;
      const model = row.used_model;
      const rate = row.total > 0 ? row.successes / row.total : 0;

      if (!intentModelBoosts[intent]) intentModelBoosts[intent] = {};

      // Convert success rate to a scoring delta: +/-2500 points max
      // 100% success → +2500, 50% → 0, 0% → -2500
      const delta = Math.round((rate - 0.5) * 5000);
      intentModelBoosts[intent][model] = delta;

      // Track top model per intent
      if (
        !topModelByIntent[intent] ||
        rate > topModelByIntent[intent].successRate ||
        (rate === topModelByIntent[intent].successRate && row.total > topModelByIntent[intent].samples)
      ) {
        topModelByIntent[intent] = {
          model,
          successRate: Math.round(rate * 1000) / 10, // e.g. 93.5
          samples: row.total,
        };
      }
    }

    // Provider failure patterns (for session-level penalties)
    const providerRows = db.prepare(`
      SELECT used_model,
             COUNT(*) as total,
             SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as failures
      FROM routing_decisions
      WHERE timestamp >= datetime('now', '-24 hours')
      GROUP BY used_model
      HAVING COUNT(*) >= 3
    `).all();

    const sessionProviderPenalties = {};
    for (const row of providerRows) {
      const failRate = row.total > 0 ? row.failures / row.total : 0;
      if (failRate > 0.3) {
        // Model is failing >30% in the last 24 hours — apply a penalty
        sessionProviderPenalties[row.used_model] = Math.round(failRate * -3000);
      }
    }

    _cachedResult = {
      intentModelBoosts,
      sessionProviderPenalties,
      topModelByIntent,
      totalSamples,
    };
    _cacheTime = now;
    return _cachedResult;
  } catch (err) {
    console.warn("[RoutingIntelligence] Analysis failed:", err.message);
    return empty;
  }
}

/**
 * Get a scoring bonus for a specific (intent, model) pair.
 * Returns 0 if no data or not enough samples.
 *
 * @param {string} intent
 * @param {string} model
 * @returns {number} Scoring delta (positive = boost, negative = penalty)
 */
export function getModelScoreBonus(intent, model) {
  if (!intent || !model) return 0;
  const analysis = analyzeRoutingMemory();
  return analysis.intentModelBoosts?.[intent]?.[model] ?? 0;
}

/**
 * Get the "Learning from your usage" summary for the analytics page.
 * Returns null if not enough data yet.
 */
export function getLearningSummary() {
  const analysis = analyzeRoutingMemory();
  if (analysis.totalSamples < 100) return null;

  const entries = Object.entries(analysis.topModelByIntent)
    .filter(([, v]) => v.samples >= MIN_SAMPLES)
    .map(([intent, v]) => ({
      intent,
      model: v.model,
      successRate: v.successRate,
      samples: v.samples,
    }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 5);

  if (entries.length === 0) return null;

  return {
    totalSamples: analysis.totalSamples,
    topModels: entries,
    penalties: Object.entries(analysis.sessionProviderPenalties).map(([model, delta]) => ({ model, delta })),
  };
}

/**
 * Invalidate the cache (call after routing memory reset).
 */
export function resetRoutingIntelligenceCache() {
  _cachedResult = null;
  _cacheTime = 0;
}
