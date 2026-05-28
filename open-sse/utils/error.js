import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/constants.js";

const MAX_REQUEST_ID_LENGTH = 128;

function normalizeRequestId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_REQUEST_ID_LENGTH);
}

function withRequestIdMetadata(metadata, requestId) {
  const normalizedRequestId = normalizeRequestId(requestId);
  const nextMetadata = metadata && typeof metadata === "object" ? { ...metadata } : {};
  const metadataRequestId = normalizeRequestId(nextMetadata.request_id);
  const finalRequestId = normalizedRequestId || metadataRequestId;
  if (finalRequestId) {
    nextMetadata.request_id = finalRequestId;
  }
  return { requestId: finalRequestId, metadata: nextMetadata };
}

/**
 * Build OpenAI-compatible error response body (LiteLLM-style: optional code override, retry metadata).
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {object} [options] - Optional: { code?, metadata?, num_retries?, max_retries? }
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode, message, options = {}) {
  const errorInfo = ERROR_TYPES[statusCode] ||
    (statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  const code = options.code ?? errorInfo.code;
  const { requestId, metadata } = withRequestIdMetadata(options.metadata, options.requestId);
  const body = {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: code || ""
    }
  };
  if (requestId) body.error.request_id = requestId;
  if (options.num_retries != null) body.error.num_retries = options.num_retries;
  if (options.max_retries != null) body.error.max_retries = options.max_retries;
  if (Object.keys(metadata).length > 0) body.error.metadata = metadata;
  return body;
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {object} [options] - Optional: { alternatives?, retryAfterMs?, code?, metadata?, num_retries?, max_retries? }
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode, message, options = {}) {
  const { requestId } = withRequestIdMetadata(options.metadata, options.requestId);
  const body = buildErrorBody(statusCode, message, {
    code: options.code,
    metadata: options.metadata,
    requestId,
    num_retries: options.num_retries,
    max_retries: options.max_retries
  });
  if (options.alternatives && Array.isArray(options.alternatives) && options.alternatives.length > 0) {
    body.error.alternatives = options.alternatives;
    body.error.hint = "Try one of these models in your playbook or pool, or add them to enable auto-failover.";
  }
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };
  if (statusCode === 429 && options.retryAfterMs != null && options.retryAfterMs > 0) {
    const retryAfterSec = Math.ceil(options.retryAfterMs / 1000);
    headers["Retry-After"] = String(retryAfterSec);
    body.error.retry_after_seconds = retryAfterSec;
  }
  if (requestId) {
    headers["X-Request-ID"] = requestId;
  }
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers
  });
}

/**
 * Write error to SSE stream (for streaming)
 * @param {WritableStreamDefaultWriter} writer - Stream writer
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
export async function writeStreamError(writer, statusCode, message, options = {}) {
  const errorBody = buildErrorBody(statusCode, message, options);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

/**
 * Parse Antigravity error message to extract retry time
 * Example: "You have exhausted your capacity on this model. Your quota will reset after 2h7m23s."
 * @param {string} message - Error message
 * @returns {number|null} Retry time in milliseconds, or null if not found
 */
export function parseAntigravityRetryTime(message) {
  if (typeof message !== "string") return null;
  
  // Match patterns like: 2h7m23s, 5m30s, 45s, 1h20m, etc.
  const match = message.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
  if (!match) return null;
  
  let totalMs = 0;
  
  // Extract hours
  if (match[1]) {
    const hours = parseInt(match[1]);
    totalMs += hours * 60 * 60 * 1000;
  }
  
  // Extract minutes
  if (match[2]) {
    const minutes = parseInt(match[2]);
    totalMs += minutes * 60 * 1000;
  }
  
  // Extract seconds
  if (match[3]) {
    const seconds = parseInt(match[3]);
    totalMs += seconds * 1000;
  }
  
  return totalMs > 0 ? totalMs : null;
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {string} provider - Provider name (for Antigravity-specific parsing)
 * @returns {Promise<{statusCode: number, message: string, retryAfterMs: number|null}>}
 */
export async function parseUpstreamError(response, provider = null) {
  let message = "";
  let retryAfterMs = null;
  
  try {
    const text = await response.text();
    
    // Try parse as JSON
    try {
      const json = JSON.parse(text);
      message = json.error?.message || json.message || json.error || text;
    } catch {
      message = text;
    }
  } catch {
    message = `Upstream error: ${response.status}`;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);

  // Parse retry time: Retry-After header (generic) or Antigravity message
  if (response.status === 429) {
    const ra = response.headers?.get?.("retry-after") || response.headers?.get?.("Retry-After");
    if (ra) {
      const sec = parseInt(ra, 10);
      if (!isNaN(sec)) retryAfterMs = sec * 1000;
    }
    if (!retryAfterMs && provider === "antigravity") {
      retryAfterMs = parseAntigravityRetryTime(messageStr);
    }
  }

  // Detect context-window exceeded (LiteLLM-style semantic code)
  let code;
  const lower = messageStr.toLowerCase();
  if (response.status === 400 && (
    lower.includes("context_length") ||
    lower.includes("context length") ||
    lower.includes("maximum context") ||
    lower.includes("token limit") ||
    lower.includes("too many tokens")
  )) {
    code = "context_window_exceeded";
  }

  return {
    statusCode: response.status,
    message: messageStr,
    retryAfterMs,
    code
  };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number|null} retryAfterMs - Optional retry-after time in milliseconds
 * @param {object} [opts] - Optional: { code? } for semantic error code (e.g. context_window_exceeded)
 * @returns {{ success: false, status: number, error: string, response: Response, retryAfterMs?: number }}
 */
export function createErrorResult(statusCode, message, retryAfterMs = null, opts = {}) {
  const responseOpts = {};
  if (retryAfterMs != null && retryAfterMs > 0) responseOpts.retryAfterMs = retryAfterMs;
  if (opts.code) responseOpts.code = opts.code;
  if (opts.requestId) responseOpts.requestId = opts.requestId;
  if (opts.metadata && typeof opts.metadata === "object") responseOpts.metadata = opts.metadata;

  const result = {
    success: false,
    status: statusCode,
    error: message,
    response: errorResponse(statusCode, message, responseOpts)
  };

  if (retryAfterMs) result.retryAfterMs = retryAfterMs;
  if (opts.code) result.code = opts.code;
  if (opts.requestId) result.requestId = opts.requestId;

  return result;
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman, options = {}) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return errorResponse(statusCode, msg, {
    ...options,
    retryAfterMs: retryAfterSec * 1000
  });
}

/**
 * Format provider error with context
 * @param {Error} error - Original error
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number|string} statusCode - HTTP status code or error code
 * @returns {string} Formatted error message
 */
export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || 'FETCH_FAILED';
  const message = error.message || "Unknown error";
  return `[${code}]: ${message}`;
}
