/**
 * Bounded retry policy for transient provider failures.
 * Used to retry the same connection a limited number of times with backoff before failover.
 */

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

/** HTTP status codes that are considered retryable (transient) */
const RETRYABLE_STATUSES = new Set([
  408, 429, 500, 502, 503, 504,
]);

/**
 * @param {number} statusCode - HTTP status from provider
 * @returns {boolean} True if we should retry (same connection) with backoff
 */
export function isRetryable(statusCode) {
  if (statusCode == null) return true;
  return RETRYABLE_STATUSES.has(Number(statusCode));
}

/**
 * Compute delay for attempt index (0 = first retry).
 * Exponential backoff with jitter: delay = min(maxDelay, initialDelay * multiplier^attempt) * (0.5..1).
 *
 * @param {number} attemptIndex - 0-based retry attempt (0 = first retry after initial failure)
 * @param {Object} [options]
 * @param {number} [options.initialDelayMs]
 * @param {number} [options.maxDelayMs]
 * @param {number} [options.multiplier]
 * @returns {number} Delay in milliseconds
 */
export function getDelayMs(attemptIndex, options = {}) {
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const multiplier = options.multiplier ?? DEFAULT_BACKOFF_MULTIPLIER;

  const raw = initialDelayMs * Math.pow(multiplier, attemptIndex);
  const capped = Math.min(maxDelayMs, raw);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.round(capped * jitter);
}

/**
 * @returns {number} Max number of retries for the same connection before failing over
 */
export function getDefaultMaxRetries() {
  return DEFAULT_MAX_RETRIES;
}
