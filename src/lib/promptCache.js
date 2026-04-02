import crypto from "crypto";
import { getCacheEntry, setCacheEntry, getCacheStats, purgeExpiredCache, getCacheEmbedding, setCacheEmbedding, getAllCacheEmbeddings } from "@/lib/localDb.js";
import { getSettings } from "@/lib/localDb.js";

const CACHE_ENABLED = process.env.PROMPT_CACHE_ENABLED !== "false"; // on by default
const CACHE_TTL_SECONDS = parseInt(process.env.PROMPT_CACHE_TTL || "3600"); // 1 hour default

/**
 * Compute a stable hash for a chat completion request
 * @param {object} body - Request body (model + messages)
 * @returns {string} SHA-256 hex hash
 */
export function computePromptHash(body) {
  const key = JSON.stringify({
    model: body.model,
    messages: body.messages,
    // Include temperature only if explicitly set (default is non-deterministic)
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.max_tokens !== undefined && { max_tokens: body.max_tokens }),
  });
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Check if caching should be applied to this request.
 * Only cache non-streaming, non-tool-use requests with temperature=0 (or unset).
 */
export function isCacheable(body) {
  if (!CACHE_ENABLED) return false;
  if (body.stream) return false;
  if (body.tools?.length > 0) return false;
  // Only cache deterministic requests (temp = 0 or unset)
  if (body.temperature !== undefined && body.temperature !== 0) return false;
  return true;
}

/**
 * Try to get a cached response. Returns null on miss.
 * @param {string} hash
 * @returns {object|null} Parsed cached response or null
 */
export function tryGetCache(hash) {
  if (!CACHE_ENABLED) return null;
  try {
    const entry = getCacheEntry(hash);
    if (!entry) return null;
    return JSON.parse(entry.response_json);
  } catch (e) {
    return null;
  }
}

/**
 * Store a response in cache
 * @param {string} hash
 * @param {string} model
 * @param {object} responseBody - Parsed response JSON
 */
export function storeInCache(hash, model, responseBody) {
  if (!CACHE_ENABLED) return;
  try {
    const usage = responseBody.usage || {};
    setCacheEntry(
      hash,
      model,
      JSON.stringify(responseBody),
      usage.prompt_tokens || 0,
      usage.completion_tokens || 0,
      CACHE_TTL_SECONDS
    );
  } catch (e) {
    // Cache failures are non-fatal
    console.warn("[PromptCache] Failed to store:", e.message);
  }
}

// ─── Cosine Similarity ────────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two float arrays.
 * Returns a value in [-1, 1]; identical vectors → 1.
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Extract a representative string from a messages array for embedding.
 * Concatenates the last 3 user/assistant turns (or fewer).
 */
function messagesToText(messages) {
  if (!Array.isArray(messages)) return "";
  return messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(-3)
    .map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n")
    .slice(0, 2000); // cap at 2000 chars
}

/**
 * Fetch an embedding vector from a local Ollama instance.
 * Returns a float array or null on failure.
 * @param {string} text
 * @param {string} model - Embedding model name (e.g. nomic-embed-text)
 * @param {string} ollamaUrl - Base URL of Ollama (default: http://localhost:11434)
 */
export async function getOllamaEmbedding(text, model = "nomic-embed-text", ollamaUrl = "http://localhost:11434") {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.embedding) ? data.embedding : null;
  } catch {
    return null;
  }
}

/**
 * Try semantic cache lookup using cosine similarity against stored embeddings.
 * Returns { response, similarity } on hit, or null on miss.
 *
 * @param {Array} messages - Incoming messages array
 * @param {object} settings - Settings object containing semantic cache config
 */
export async function trySemanticCache(messages, settings = {}) {
  const enabled = settings.semanticCacheEnabled ?? false;
  if (!enabled || !CACHE_ENABLED) return null;

  const threshold = settings.semanticCacheThreshold ?? 0.92;
  const embModel = settings.semanticCacheEmbeddingModel ?? "nomic-embed-text";
  const ollamaUrl = settings.ollamaUrl ?? "http://localhost:11434";

  const text = messagesToText(messages);
  if (!text) return null;

  // Generate embedding for incoming request
  const incomingEmbed = await getOllamaEmbedding(text, embModel, ollamaUrl);
  if (!incomingEmbed) return null; // Ollama not available — skip

  // Load all stored embeddings for this embed model
  const stored = getAllCacheEmbeddings(embModel);
  if (!stored || stored.length === 0) return null;

  let bestSim = 0;
  let bestHash = null;
  for (const row of stored) {
    try {
      const vec = JSON.parse(row.embedding);
      const sim = cosineSimilarity(incomingEmbed, vec);
      if (sim > bestSim) {
        bestSim = sim;
        bestHash = row.hash;
      }
    } catch {
      // malformed row — skip
    }
  }

  if (bestSim < threshold || !bestHash) return null;

  // Fetch the cached response for the best matching hash
  const entry = getCacheEntry(bestHash);
  if (!entry) return null;

  try {
    return { response: JSON.parse(entry.response_json), similarity: bestSim };
  } catch {
    return null;
  }
}

/**
 * Store the embedding for a newly cached entry.
 * @param {string} hash - The prompt hash
 * @param {Array} messages
 * @param {object} settings
 */
export async function storeEmbedding(hash, messages, settings = {}) {
  const enabled = settings.semanticCacheEnabled ?? false;
  if (!enabled) return;

  const embModel = settings.semanticCacheEmbeddingModel ?? "nomic-embed-text";
  const ollamaUrl = settings.ollamaUrl ?? "http://localhost:11434";
  const text = messagesToText(messages);
  if (!text) return;

  const embedding = await getOllamaEmbedding(text, embModel, ollamaUrl);
  if (!embedding) return;

  try {
    setCacheEmbedding(hash, embModel, JSON.stringify(embedding));
  } catch (e) {
    console.warn("[SemanticCache] Failed to store embedding:", e.message);
  }
}

export { getCacheStats, purgeExpiredCache };
