/**
 * Provider-level circuit breaker to avoid hammering failing providers.
 * States: closed (normal), open (reject), halfOpen (allow one probe).
 * In-memory; resets on process restart.
 */

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_PROBE_AFTER_MS = 30_000;

const state = new Map();

function getOrCreate(provider, options = {}) {
  if (state.has(provider)) return state.get(provider);
  const entry = {
    state: "closed",
    failures: 0,
    lastFailureAt: null,
    openedAt: null,
    halfOpenProbeAt: null,
    failureThreshold: options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
    cooldownMs: options.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    probeAfterMs: options.probeAfterMs ?? DEFAULT_PROBE_AFTER_MS,
  };
  state.set(provider, entry);
  return entry;
}

/**
 * @param {string} provider - Provider id (e.g. "openai", "anthropic")
 * @param {Object} [options] - Override threshold/cooldown (not persisted)
 * @returns {boolean} True if requests to this provider are allowed
 */
export function isAvailable(provider, options = {}) {
  if (!provider || typeof provider !== "string") return false;
  const entry = getOrCreate(provider, options);
  const now = Date.now();

  if (entry.state === "closed") return true;

  if (entry.state === "open") {
    if (now - (entry.openedAt || 0) >= entry.cooldownMs) {
      entry.state = "halfOpen";
      entry.halfOpenProbeAt = now;
      return true;
    }
    return false;
  }

  // halfOpen: allow one request as probe
  if (entry.state === "halfOpen") return true;

  return false;
}

/**
 * Record a successful request; closes or keeps circuit closed.
 */
export function recordSuccess(provider) {
  if (!provider || typeof provider !== "string") return;
  const entry = getOrCreate(provider);
  entry.state = "closed";
  entry.failures = 0;
  entry.lastFailureAt = null;
  entry.openedAt = null;
  entry.halfOpenProbeAt = null;
}

/**
 * Record a failed request; may open circuit after threshold.
 */
export function recordFailure(provider, options = {}) {
  if (!provider || typeof provider !== "string") return;
  const entry = getOrCreate(provider, options);
  const now = Date.now();
  entry.lastFailureAt = now;
  entry.failures += 1;

  if (entry.state === "halfOpen") {
    entry.state = "open";
    entry.openedAt = now;
    return;
  }

  if (entry.state === "closed" && entry.failures >= entry.failureThreshold) {
    entry.state = "open";
    entry.openedAt = now;
  }
}

/**
 * Get current state for a provider (for diagnostics).
 */
export function getState(provider) {
  if (!provider || !state.has(provider)) {
    return { state: "closed", failures: 0 };
  }
  const entry = state.get(provider);
  return {
    state: entry.state,
    failures: entry.failures,
    lastFailureAt: entry.lastFailureAt,
    openedAt: entry.openedAt,
  };
}

/**
 * Reset circuit for a provider (e.g. after manual recovery).
 */
export function reset(provider) {
  if (provider) {
    state.delete(provider);
  } else {
    state.clear();
  }
}
