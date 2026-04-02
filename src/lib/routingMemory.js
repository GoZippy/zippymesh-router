/**
 * Optional routing memory: persist successful routes (provider, model, intent, clientId)
 * and suggest models that worked for similar requests (same intent or client).
 * Used to bias scoring when enableRoutingMemory is on.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isCloud = typeof caches !== "undefined" || typeof caches === "object";

function getDataDir() {
  if (isCloud) return null;
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const appName = process.env.ZIPPY_APP_NAME || "zippy-mesh";
  const home = process.platform === "win32"
    ? (process.env.APPDATA || process.env.USERPROFILE) + `\\${appName}`
    : `${process.env.HOME || process.env.USERPROFILE}/.${appName}`;
  return home;
}

const MEMORY_FILE = getDataDir() ? path.join(getDataDir(), "routing_memory.json") : null;
const MAX_ENTRIES = 500;

function ensureFile() {
  if (isCloud || !MEMORY_FILE) return;
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ entries: [] }, null, 0));
  }
}

function readEntries() {
  if (isCloud || !MEMORY_FILE) return [];
  try {
    ensureFile();
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  if (isCloud || !MEMORY_FILE) return;
  try {
    ensureFile();
    const trimmed = entries.slice(-MAX_ENTRIES);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ entries: trimmed }, null, 0));
  } catch (err) {
    console.warn("[routingMemory] write failed:", err?.message);
  }
}

/**
 * Record a successful route for routing memory.
 * @param {{ provider: string, model: string, intent?: string, clientId?: string }} opts
 */
export function saveRoutingMemorySuccess({ provider, model, intent = null, clientId = null }) {
  const entries = readEntries();
  entries.push({
    provider,
    model,
    intent: intent || "generic",
    clientId: clientId || null,
    timestamp: Date.now(),
  });
  writeEntries(entries);
}

/**
 * Get recent successful (provider, model) pairs for similar context.
 * Matches by intent and optionally clientId; returns most recent first, deduplicated by provider+model.
 * @param {{ intent?: string, clientId?: string, limit?: number }} opts
 * @returns {{ provider: string, model: string }[]}
 */
export function getRoutingMemorySuggestions({ intent = null, clientId = null, limit = 10 } = {}) {
  const entries = readEntries();
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  const filtered = entries
    .filter((e) => now - e.timestamp < maxAge)
    .filter((e) => {
      if (intent && e.intent && e.intent !== "generic") {
        if (e.intent !== intent) return false;
      }
      if (clientId && e.clientId) {
        if (e.clientId !== clientId) return false;
      }
      return true;
    })
    .reverse();
  const seen = new Set();
  const out = [];
  for (const e of filtered) {
    const key = `${e.provider}:${e.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider: e.provider, model: e.model });
    if (out.length >= limit) break;
  }
  return out;
}
