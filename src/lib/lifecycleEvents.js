import fs from "fs";
import os from "os";
import path from "path";

const SENSITIVE_KEY_PATTERN = /(token|secret|api[-_]?key|authorization|cookie|password|id[_-]?token|refresh[_-]?token)/i;
const MAX_STRING_LENGTH = 512;
const MAX_EVENT_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function sanitizeString(value) {
  if (typeof value !== "string") return value;
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
}

function sanitizeLifecycleValue(value, depth = 0) {
  if (depth > 4) return "[max_depth]";
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: sanitizeString(value.message || String(value)),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeLifecycleValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        next[key] = "[redacted]";
        continue;
      }
      next[key] = sanitizeLifecycleValue(child, depth + 1);
    }
    return next;
  }
  return String(value);
}

function getAppName() {
  return process.env.ZIPPY_APP_NAME || "zippy-mesh";
}

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), getAppName());
  }
  return path.join(os.homedir(), `.${getAppName()}`);
}

function getEventLogPath() {
  return path.join(getDataDir(), "provider-lifecycle-events.jsonl");
}

function trimLifecycleLogIfNeeded(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size <= MAX_EVENT_FILE_SIZE_BYTES) return;
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.trim().split("\n");
    const kept = lines.slice(-2000);
    fs.writeFileSync(filePath, kept.join("\n") + "\n", "utf8");
  } catch {
    // best effort
  }
}

export function buildProviderLifecycleEvent(type, payload = {}) {
  const now = new Date().toISOString();
  const requestId = typeof payload.requestId === "string" ? payload.requestId.trim().slice(0, 128) : null;
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    event: String(type || "provider.unknown"),
    provider: payload.provider || "unknown",
    connectionId: payload.connectionId || null,
    requestId: requestId || null,
    status: payload.status ?? null,
    detail: sanitizeLifecycleValue(payload.detail || {}),
  };
  return event;
}

export async function emitProviderLifecycleEvent(type, payload = {}) {
  const event = buildProviderLifecycleEvent(type, payload);
  const parts = [event.event, event.provider];
  if (event.connectionId) parts.push(event.connectionId.slice(0, 8));
  if (event.requestId) parts.push(event.requestId);
  console.info(`[LIFECYCLE] ${parts.join(" | ")}`);

  try {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = getEventLogPath();
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
    trimLifecycleLogIfNeeded(filePath);
  } catch {
    // Logging must never break request flow.
  }

  return event;
}

export async function getRecentProviderLifecycleEvents(limit = 100) {
  try {
    const filePath = getEventLogPath();
    if (!fs.existsSync(filePath)) return [];
    
    // Read the file and parse JSONL
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.trim().split("\n");
    
    // Take the last 'limit' lines and parse them
    return lines
      .slice(-limit)
      .reverse()
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    console.error("Error reading lifecycle events:", error);
    return [];
  }
}

