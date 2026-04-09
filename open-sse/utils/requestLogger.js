// Check if running in Node.js environment (has fs module)
const isNode = typeof process !== "undefined" && process.versions?.node && typeof window === "undefined";

// Check if logging is enabled via environment variable (default: false)
const LOGGING_ENABLED = typeof process !== "undefined" && process.env?.ENABLE_REQUEST_LOGS === 'true';

let fs = null;
let path = null;
let LOGS_DIR = null;

// Lazy load Node.js modules (avoid top-level await)
async function ensureNodeModules() {
  if (!isNode || !LOGGING_ENABLED || fs) return;
  try {
    fs = await import("fs");
    path = await import("path");
    LOGS_DIR = path.join(typeof process !== "undefined" && process.cwd ? process.cwd() : ".", "logs");
  } catch {
    // Running in non-Node environment (Worker, Browser, etc.)
  }
}

// Format timestamp for folder name: 20251228_143045
function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${m}${d}_${h}${min}${s}`;
}

// Create log session folder: {sourceFormat}_{targetFormat}_{model}_{timestamp}_{requestId}
async function createLogSession(sourceFormat, targetFormat, model, requestId = null) {
  await ensureNodeModules();
  if (!fs || !LOGS_DIR) return null;
  
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    
    const timestamp = formatTimestamp();
    const safeModel = model.replace(/[/:]/g, "-");
    const requestSuffix = requestId ? `_${String(requestId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24)}` : "";
    const folderName = `${sourceFormat}_${targetFormat}_${safeModel}_${timestamp}${requestSuffix}`;
    const sessionPath = path.join(LOGS_DIR, folderName);
    
    fs.mkdirSync(sessionPath, { recursive: true });
    
    return sessionPath;
  } catch (err) {
    console.log("[LOG] Failed to create log session:", err.message);
    return null;
  }
}

// Write JSON file
function writeJsonFile(sessionPath, filename, data) {
  if (!fs || !sessionPath) return;
  
  try {
    const filePath = path.join(sessionPath, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(`[LOG] Failed to write ${filename}:`, err.message);
  }
}

function maskValue(value) {
  if (typeof value !== "string") return value;
  return "***";
}

function normalizeHeaderInput(headers) {
  if (!headers) return {};
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    const flattened = {};
    for (const [key, value] of headers) {
      flattened[key] = value;
    }
    return flattened;
  }
  return headers;
}

function sanitizeLogValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeLogValue);
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (
        lower === "authorization" ||
        lower === "x-api-key" ||
        lower === "cookie" ||
        lower === "set-cookie" ||
        lower.includes("token") ||
        lower.includes("secret")
      ) {
        output[key] = sanitizeLogValue(child);
        if (typeof child === "string") {
          output[key] = maskValue(child);
        }
      } else {
        output[key] = sanitizeLogValue(child);
      }
    }
    return output;
  }
  return value;
}

// Mask sensitive data in headers
function maskSensitiveHeaders(headers) {
  const safeHeaders = normalizeHeaderInput(headers);
  const masked = { ...safeHeaders };

  for (const key of Object.keys(masked)) {
    const lowerKey = String(key).toLowerCase();
    if (
      lowerKey === "authorization" ||
      lowerKey === "x-api-key" ||
      lowerKey === "cookie" ||
      lowerKey === "set-cookie" ||
      lowerKey.includes("token") ||
      lowerKey.includes("secret")
    ) {
      masked[key] = maskValue(masked[key]);
    }
  }

  return masked;
}

// No-op logger when logging is disabled
function createNoOpLogger() {
  return {
    sessionPath: null,
    requestId: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {}
  };
}

/**
 * Create a new log session and return logger functions
 * @param {string} sourceFormat - Source format from client (claude, openai, etc.)
 * @param {string} targetFormat - Target format to provider (antigravity, gemini-cli, etc.)
 * @param {string} model - Model name
 * @returns {Promise<object>} Promise that resolves to logger object with methods to log each stage
 */
export async function createRequestLogger(sourceFormat, targetFormat, model, requestId = null) {
  // Return no-op logger if logging is disabled
  if (!LOGGING_ENABLED) {
    return createNoOpLogger();
  }
  
  // Wait for session to be created before returning logger
  const normalizedRequestId = typeof requestId === "string" && requestId.trim()
    ? requestId.trim().slice(0, 128)
    : null;
  const sessionPath = await createLogSession(sourceFormat, targetFormat, model, normalizedRequestId);
  
  return {
    get sessionPath() { return sessionPath; },
    get requestId() { return normalizedRequestId; },
    
    // 1. Log client raw request (before any conversion)
    logClientRawRequest(endpoint, body, headers = {}) {
      writeJsonFile(sessionPath, "1_req_client.json", {
        timestamp: new Date().toISOString(),
        requestId: normalizedRequestId,
        endpoint,
        headers: maskSensitiveHeaders(headers),
        body: sanitizeLogValue(body),
      });
    },
    
    // 2. Log raw request from client (after initial conversion like responsesApi)
    logRawRequest(body, headers = {}) {
      writeJsonFile(sessionPath, "2_req_source.json", {
        timestamp: new Date().toISOString(),
        requestId: normalizedRequestId,
        headers: maskSensitiveHeaders(headers),
        body: sanitizeLogValue(body),
      });
    },
    
    // 3. Log OpenAI intermediate format (source → openai)
    logOpenAIRequest(body) {
      writeJsonFile(sessionPath, "3_req_openai.json", {
        timestamp: new Date().toISOString(),
        requestId: normalizedRequestId,
        body: sanitizeLogValue(body),
      });
    },
    
    // 4. Log target format request (openai → target)
    logTargetRequest(url, headers, body) {
      writeJsonFile(sessionPath, "4_req_target.json", {
        timestamp: new Date().toISOString(),
        requestId: normalizedRequestId,
        url,
        headers: maskSensitiveHeaders(headers),
        body: sanitizeLogValue(body),
      });
    },
    
    // 5. Log provider response (for non-streaming or error)
    logProviderResponse(status, statusText, headers, body) {
      const filename = "5_res_provider.json";
      writeJsonFile(sessionPath, filename, {
        timestamp: new Date().toISOString(),
        requestId: normalizedRequestId,
        status,
        statusText,
        headers: maskSensitiveHeaders(headers),
        body: sanitizeLogValue(body),
      });
    },
    
    // 5. Append streaming chunk to provider response
    appendProviderChunk(chunk) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path.join(sessionPath, "5_res_provider.txt");
        fs.appendFileSync(filePath, chunk);
      } catch (err) {
        // Ignore append errors
      }
    },
    
    // 6. Append OpenAI intermediate chunks (target → openai)
    appendOpenAIChunk(chunk) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path.join(sessionPath, "6_res_openai.txt");
        fs.appendFileSync(filePath, chunk);
      } catch (err) {
        // Ignore append errors
      }
    },
    
    // 7. Log converted response to client (for non-streaming)
    logConvertedResponse(body) {
      writeJsonFile(sessionPath, "7_res_client.json", {
        timestamp: new Date().toISOString(),
        requestId: normalizedRequestId,
        body: sanitizeLogValue(body),
      });
    },
    
    // 7. Append streaming chunk to converted response
    appendConvertedChunk(chunk) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path.join(sessionPath, "7_res_client.txt");
        fs.appendFileSync(filePath, chunk);
      } catch (err) {
        // Ignore append errors
      }
    },
    
    // 6. Log error
    logError(error, requestBody = null) {
      writeJsonFile(sessionPath, "6_error.json", {
        timestamp: new Date().toISOString(),
        requestId: normalizedRequestId,
        error: error?.message || String(error),
        stack: error?.stack,
        requestBody: sanitizeLogValue(requestBody),
      });
    }
  };
}

// Legacy functions for backward compatibility
export function logRequest() {}
export function logResponse() {}
export function logError(provider, { error, url, model, requestBody }) {
  if (!fs || !LOGS_DIR) return;
  
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    
    const date = new Date().toISOString().split("T")[0];
    const logPath = path.join(LOGS_DIR, `${provider}-${date}.log`);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: "error",
      provider,
      model,
      url,
      error: error?.message || String(error),
      stack: error?.stack,
      requestBody: sanitizeLogValue(requestBody),
    };
    
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
  } catch (err) {
    console.log("[LOG] Failed to write error log:", err.message);
  }
}

export { sanitizeLogValue, maskValue, maskSensitiveHeaders };
