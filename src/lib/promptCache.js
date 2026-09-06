import crypto from "crypto";
import { getCacheEntry, setCacheEntry, getCacheStats, purgeExpiredCache, getCacheEmbedding, setCacheEmbedding, getAllCacheEmbeddings } from "@/lib/localDb.js";
import { getSettings } from "@/lib/localDb.js";

const CACHE_ENABLED = process.env.PROMPT_CACHE_ENABLED !== "false"; // on by default
const CACHE_TTL_SECONDS = parseInt(process.env.PROMPT_CACHE_TTL || "3600"); // 1 hour default

/**
 * Bumped whenever the meaning of the key changes, so entries written by an
 * older ZMLR can never be served against a newer key.
 *   v2 = 2026-08-30, the fix for defect 5 below (whole-body deny-list key).
 *   v3 = 2026-08-30 adversarial round, the tenant dimension (H3).
 */
const CACHE_KEY_VERSION = "v3";

/** The identity used when a request presents no credential at all. */
export const ANONYMOUS_TENANT = "anon";

/**
 * Derive the cache's TENANT component from a request's credentials.
 *
 * ## Why the key has a tenant at all (H3, 2026-08-30)
 *
 * `computePromptHash` hashed the request body and nothing else, `user` was
 * explicitly on the ignore list, and `getCacheEntry(hash)` reads one global
 * table. Verified live: a prompt sent with NO credentials was then served, with
 * `x-cache: HIT`, to two unrelated bearer identities that had never sent it.
 * Two consequences — a caller who replays another caller's exact body gets that
 * caller's stored answer, and `x-cache: HIT` is a confirm-a-guess oracle for
 * "has anyone on this install ever run this exact prompt".
 *
 * ## What goes in
 *
 * A stable, non-reversible identity — never the raw credential:
 *
 *   - a virtual key      -> `vk:<virtual key id>` (already an opaque uuid)
 *   - a router bearer    -> `key:<HMAC-SHA256(JWT_SECRET, raw)[0..32]>`
 *   - no credential      -> `anon`
 *
 * The HMAC means the stored key material is not derivable from the hash even if
 * the cache table leaks, and it is keyed on the install's own `JWT_SECRET` so
 * two installs never produce the same tenant id for the same key.
 *
 * Anonymous callers still share one bucket with each other. That is deliberate:
 * on the default install `/v1` takes no credentials at all, and giving every
 * uncredentialed request its own bucket would disable the cache outright. An
 * operator who needs per-caller isolation turns on `requireApiKey` — which is
 * what makes the callers distinguishable in the first place.
 *
 * @param {{virtualKeyId?: string|null, bearer?: string|null}} [identity]
 * @returns {string}
 */
export function tenantIdFor(identity = {}) {
  if (identity.virtualKeyId) return `vk:${identity.virtualKeyId}`;
  const bearer = typeof identity.bearer === "string" ? identity.bearer.trim() : "";
  if (bearer) {
    const secret = process.env.JWT_SECRET || "zmlr-prompt-cache-tenant";
    return `key:${crypto.createHmac("sha256", secret).update(bearer).digest("hex").slice(0, 32)}`;
  }
  return ANONYMOUS_TENANT;
}

/**
 * Pull the tenant identity out of a Request's Authorization header.
 * `virtualKeyId` is supplied by the caller when it has already resolved one.
 *
 * @param {Request} request
 * @param {string|null} [virtualKeyId]
 */
export function tenantIdForRequest(request, virtualKeyId = null) {
  let bearer = null;
  try {
    const auth = request?.headers?.get?.("authorization") || request?.headers?.get?.("Authorization") || "";
    if (auth.toLowerCase().startsWith("bearer ")) bearer = auth.slice(7).trim() || null;
  } catch { /* header-less request object */ }
  return tenantIdFor({ virtualKeyId, bearer });
}

/**
 * Request fields that do NOT change the answer and are therefore excluded from
 * the cache key.
 *
 * Everything else in the body is part of the key. This is deliberately a
 * DENY-list: before 2026-08-30 `computePromptHash` was an ALLOW-list of
 * `{model, messages, temperature, max_tokens}`, so every other field — most
 * damagingly `response_format` — was invisible to it. A JSON-mode request was
 * served the cached plain-prose answer with `x-cache: HIT`
 * (docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §8, defect 5, verified
 * against a live Ollama). A deny-list fails safe: a field nobody thought of
 * causes an extra miss, never a wrong hit.
 *
 * `stream` is excluded because `isCacheable()` already refuses streaming
 * requests. The `_*` and routing keys are ZMLR-internal annotations added
 * between the client and this function.
 */
const CACHE_KEY_IGNORED_FIELDS = new Set([
  "stream",
  "stream_options",
  "user",
  "metadata",
  "guardrails",
  "intent",
  "routing",
  "_playbookName",
  "_routing",
  "_toolNameMap",
]);

/**
 * Recursively canonicalise a value so two semantically identical bodies hash
 * the same regardless of key order. Object keys are sorted; array order is
 * preserved (message order is meaning).
 */
function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    if (v === undefined) continue;
    out[key] = canonicalize(v);
  }
  return out;
}

/**
 * Compute a stable hash covering the full semantics of a chat completion
 * request: model, messages, tools, tool_choice, response_format, temperature,
 * top_p, max_tokens, stop, seed, n — and anything else the caller sent that is
 * not on CACHE_KEY_IGNORED_FIELDS.
 *
 * The key is scoped to a TENANT (H3): two different callers never share an
 * entry, and `x-cache: HIT` therefore only ever tells a caller about its own
 * traffic. See tenantIdFor().
 *
 * @param {object} body - Request body
 * @param {string} [tenant] - tenant id from tenantIdFor(); defaults to anonymous
 * @returns {string} SHA-256 hex hash
 */
export function computePromptHash(body, tenant = ANONYMOUS_TENANT) {
  const subject = {};
  for (const key of Object.keys(body || {})) {
    if (CACHE_KEY_IGNORED_FIELDS.has(key)) continue;
    if (body[key] === undefined) continue;
    subject[key] = body[key];
  }
  const key = JSON.stringify({
    v: CACHE_KEY_VERSION,
    t: typeof tenant === "string" && tenant ? tenant : ANONYMOUS_TENANT,
    body: canonicalize(subject),
  });
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Check if caching should be applied to this request.
 *
 * Only non-streaming, tool-free requests with `temperature` unset or 0.
 *
 * **Why `tools` stays excluded even when the request is deterministic**
 * (decided 2026-08-30): a cached `finish_reason:"tool_calls"` replays a tool
 * call the client would then execute again, with a `tool_call_id` minted for a
 * conversation that already ended. Replaying a side effect to save one local
 * inference is the wrong trade, so a request carrying `tools` is never cached —
 * with or without `temperature: 0` / `seed`. `tests/e2e/routing/05-tools-and-json`
 * pins this.
 *
 * `n > 1` is excluded because the client asked for independent samples.
 */
export function isCacheable(body) {
  if (!CACHE_ENABLED) return false;
  if (!body || typeof body !== "object") return false;
  if (body.stream) return false;
  if (body.tools?.length > 0) return false;
  if (body.n !== undefined && body.n !== 1) return false;
  // Only cache deterministic requests (temp = 0 or unset)
  if (body.temperature !== undefined && body.temperature !== 0) return false;
  return true;
}

/**
 * Mint a fresh completion id for a response replayed from cache.
 *
 * OpenAI ids identify a *response*, not a prompt. Replaying the stored id makes
 * two distinct HTTP responses indistinguishable, which breaks client-side
 * dedupe, log correlation and any store keyed on `id`. A cache hit is still
 * advertised — by the `x-cache: HIT` header, which is where that belongs.
 */
export function mintCachedResponseId() {
  return `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Give a cached response body a fresh identity (new `id`, current `created`)
 * without touching anything a client reads as content.
 * @param {object} response
 * @returns {object} the same object, mutated
 */
export function refreshCachedResponseIdentity(response) {
  if (!response || typeof response !== "object") return response;
  if (typeof response.id === "string" || response.id === undefined) {
    response.id = mintCachedResponseId();
  }
  if (typeof response.created === "number") {
    response.created = Math.floor(Date.now() / 1000);
  }
  return response;
}

/**
 * Try to get a cached response. Returns null on miss.
 * The returned body carries a freshly minted `id` — see
 * refreshCachedResponseIdentity().
 * @param {string} hash
 * @returns {object|null} Parsed cached response or null
 */
export function tryGetCache(hash) {
  if (!CACHE_ENABLED) return null;
  try {
    const entry = getCacheEntry(hash);
    if (!entry) return null;
    return refreshCachedResponseIdentity(JSON.parse(entry.response_json));
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
 * Tenant-scoped exactly like the exact-match cache (H3): the embedding rows are
 * stored under `<embedding model>#<tenant>`, so `getAllCacheEmbeddings()` only
 * ever compares a caller's request against that caller's own history. A nearest
 * neighbour is an even softer oracle than an exact hit, so it needs the same
 * boundary.
 *
 * @param {Array} messages - Incoming messages array
 * @param {object} settings - Settings object containing semantic cache config
 * @param {string} [tenant] - tenant id from tenantIdFor()
 */
export async function trySemanticCache(messages, settings = {}, tenant = ANONYMOUS_TENANT) {
  const enabled = settings.semanticCacheEnabled ?? false;
  if (!enabled || !CACHE_ENABLED) return null;

  const threshold = settings.semanticCacheThreshold ?? 0.92;
  const embModel = `${settings.semanticCacheEmbeddingModel ?? "nomic-embed-text"}#${tenant}`;
  const ollamaUrl = settings.ollamaUrl ?? "http://localhost:11434";

  const text = messagesToText(messages);
  if (!text) return null;

  // Generate embedding for incoming request. The tenant suffix is a STORAGE
  // key, not a model name — strip it before asking Ollama.
  const incomingEmbed = await getOllamaEmbedding(text, embModel.split("#")[0], ollamaUrl);
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
    return {
      response: refreshCachedResponseIdentity(JSON.parse(entry.response_json)),
      similarity: bestSim
    };
  } catch {
    return null;
  }
}

/**
 * Store the embedding for a newly cached entry.
 * @param {string} hash - The prompt hash
 * @param {Array} messages
 * @param {object} settings
 * @param {string} [tenant] - tenant id from tenantIdFor(); see trySemanticCache
 */
export async function storeEmbedding(hash, messages, settings = {}, tenant = ANONYMOUS_TENANT) {
  const enabled = settings.semanticCacheEnabled ?? false;
  if (!enabled) return;

  const modelName = settings.semanticCacheEmbeddingModel ?? "nomic-embed-text";
  const embModel = `${modelName}#${tenant}`;
  const ollamaUrl = settings.ollamaUrl ?? "http://localhost:11434";
  const text = messagesToText(messages);
  if (!text) return;

  const embedding = await getOllamaEmbedding(text, modelName, ollamaUrl);
  if (!embedding) return;

  try {
    setCacheEmbedding(hash, embModel, JSON.stringify(embedding));
  } catch (e) {
    console.warn("[SemanticCache] Failed to store embedding:", e.message);
  }
}

export { getCacheStats, purgeExpiredCache };
