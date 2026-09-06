/**
 * Provider-agnostic `/v1/embeddings` execution.
 *
 * Added 2026-08-30 to close defect 8 in
 * docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md: ZMLR advertised
 * `ollama/nomic-embed-text` in `GET /v1/models` but had no embeddings route, so
 * `client.embeddings.create()` got Next's **HTML** 404 page and failed at the
 * parse step.
 *
 * Everything here is pure apart from an injected `fetchImpl`, so it is unit
 * testable without a server, a database or a network
 * (tests/unit/embeddingsRoute.test.js).
 *
 * Three provider shapes are supported:
 *
 *   ollama            POST {base}/api/embed  {model, input}
 *                     -> {model, embeddings: number[][], prompt_eval_count}
 *   openai-compatible POST {base}/v1/embeddings  (LM Studio, OpenAI itself, any
 *                     openai-compatible provider node) -> already OpenAI shape
 *
 * The response ZMLR returns is always the OpenAI shape:
 *   {object:"list", data:[{object:"embedding", index, embedding}], model, usage}
 */

import { resolveProviderAlias } from "../services/model.js";

/** Ollama's `/api/embed` caps out well below this; a guard, not a policy. */
export const MAX_EMBEDDING_INPUTS = 2048;

export class EmbeddingsError extends Error {
  constructor(status, message, code = null, type = null) {
    super(message);
    this.name = "EmbeddingsError";
    this.status = status;
    this.code = code;
    this.type = type;
  }
}

/**
 * Validate and flatten the OpenAI `input` field.
 *
 * OpenAI accepts a string, an array of strings, an array of token ids, or an
 * array of arrays of token ids. ZMLR accepts the two string forms and rejects
 * token-id input with a 400 rather than silently mangling it.
 *
 * @param {string|string[]} input
 * @returns {string[]}
 * @throws {EmbeddingsError} 400 on anything else
 */
export function normalizeEmbeddingInput(input) {
  if (typeof input === "string") {
    if (input.length === 0) {
      throw new EmbeddingsError(400, "'input' must not be empty", "invalid_input");
    }
    return [input];
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new EmbeddingsError(400, "'input' must not be an empty array", "invalid_input");
    }
    if (input.length > MAX_EMBEDDING_INPUTS) {
      throw new EmbeddingsError(
        400,
        `'input' has ${input.length} items; the maximum is ${MAX_EMBEDDING_INPUTS}`,
        "invalid_input"
      );
    }
    for (const item of input) {
      if (typeof item !== "string") {
        throw new EmbeddingsError(
          400,
          "'input' must be a string or an array of strings (token-id input is not supported)",
          "invalid_input"
        );
      }
    }
    return input;
  }

  throw new EmbeddingsError(400, "'input' is required and must be a string or an array of strings", "invalid_input");
}

/**
 * Encode a float vector the way OpenAI's `encoding_format:"base64"` does:
 * little-endian float32, base64.
 * @param {number[]} vector
 * @returns {string}
 */
export function floatsToBase64(vector) {
  const buf = new ArrayBuffer(vector.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < vector.length; i++) {
    view.setFloat32(i * 4, vector[i], true);
  }
  // Buffer exists in the Next/node runtime this route runs in.
  return Buffer.from(buf).toString("base64");
}

/**
 * @param {number[][]} vectors
 * @param {"float"|"base64"} encodingFormat
 */
function toEmbeddingData(vectors, encodingFormat) {
  return vectors.map((vector, index) => ({
    object: "embedding",
    index,
    embedding: encodingFormat === "base64" ? floatsToBase64(vector) : vector,
  }));
}

/** ~4 chars per token, the same rough ratio open-sse/utils/usageTracking.js uses. */
export function estimateEmbeddingPromptTokens(inputs) {
  return inputs.reduce((sum, s) => sum + Math.ceil(s.length / 4), 0);
}

/**
 * Split "<prefix>/<model>" once. Returns `{ prefix: null, model }` for a bare id.
 */
export function parseEmbeddingModelId(modelId) {
  if (typeof modelId !== "string" || modelId.trim() === "") {
    throw new EmbeddingsError(400, "'model' is required", "invalid_request_error");
  }
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { prefix: null, alias: null, model: trimmed };
  const alias = trimmed.slice(0, slash);
  return { prefix: resolveProviderAlias(alias), alias, model: trimmed.slice(slash + 1) };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

/** `http://host:port` -> `http://host:port` ; `http://host:port/v1` -> same root */
export function ollamaRoot(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/, "");
}

/** Build the OpenAI-compatible embeddings URL for a provider base URL. */
export function openAiCompatibleEmbeddingsUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/v\d+$/.test(base)) return `${base}/embeddings`;
  return `${base}/v1/embeddings`;
}

async function readErrorText(res) {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return json?.error?.message || json?.error || json?.message || text;
    } catch {
      return text;
    }
  } catch {
    return `upstream returned ${res.status}`;
  }
}

/**
 * Ollama native embeddings.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl       e.g. http://127.0.0.1:11434
 * @param {string} opts.model         provider-local tag, e.g. nomic-embed-text
 * @param {string[]} opts.inputs
 * @param {"float"|"base64"} [opts.encodingFormat]
 * @param {function} [opts.fetchImpl]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{body: object, usageSource: "provider"|"estimated"}>}
 */
export async function fetchOllamaEmbeddings({ baseUrl, model, inputs, encodingFormat = "float", fetchImpl = fetch, signal }) {
  const url = `${ollamaRoot(baseUrl)}/api/embed`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: inputs }),
      signal,
    });
  } catch (err) {
    throw new EmbeddingsError(502, `[502]: ${err?.message || "embedding provider unreachable"}`, "provider_unreachable");
  }

  if (!res.ok) {
    const message = await readErrorText(res);
    // Ollama answers 404 for an unknown model — keep that status so a client
    // sees `model_not_found`, not a generic upstream failure.
    throw new EmbeddingsError(res.status === 404 ? 404 : res.status, `[${res.status}]: ${message}`,
      res.status === 404 ? "model_not_found" : null);
  }

  const data = await res.json();
  const vectors = Array.isArray(data?.embeddings) ? data.embeddings : null;
  if (!vectors || vectors.length === 0) {
    throw new EmbeddingsError(502, "[502]: embedding provider returned no vectors", "invalid_upstream_response");
  }

  const promptTokens = Number.isFinite(data?.prompt_eval_count)
    ? data.prompt_eval_count
    : estimateEmbeddingPromptTokens(inputs);

  return {
    usageSource: Number.isFinite(data?.prompt_eval_count) ? "provider" : "estimated",
    body: {
      object: "list",
      data: toEmbeddingData(vectors, encodingFormat),
      model: data?.model || model,
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    },
  };
}

/**
 * Pass an embeddings request through to any OpenAI-compatible provider
 * (LM Studio, OpenAI, an `openai-compatible` provider node).
 *
 * @returns {Promise<{body: object, usageSource: "provider"|"estimated"}>}
 */
export async function fetchOpenAiCompatibleEmbeddings({
  baseUrl, model, inputs, encodingFormat = "float", dimensions, apiKey, fetchImpl = fetch, signal,
}) {
  const url = openAiCompatibleEmbeddingsUrl(baseUrl);
  const payload = { model, input: inputs.length === 1 ? inputs[0] : inputs };
  if (encodingFormat) payload.encoding_format = encodingFormat;
  if (dimensions !== undefined) payload.dimensions = dimensions;

  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    throw new EmbeddingsError(502, `[502]: ${err?.message || "embedding provider unreachable"}`, "provider_unreachable");
  }

  if (!res.ok) {
    const message = await readErrorText(res);
    throw new EmbeddingsError(res.status, `[${res.status}]: ${message}`,
      res.status === 404 ? "model_not_found" : null);
  }

  const data = await res.json();
  if (!Array.isArray(data?.data)) {
    throw new EmbeddingsError(502, "[502]: embedding provider returned no vectors", "invalid_upstream_response");
  }

  const hasUsage = Number.isFinite(data?.usage?.prompt_tokens);
  const promptTokens = hasUsage ? data.usage.prompt_tokens : estimateEmbeddingPromptTokens(inputs);

  return {
    usageSource: hasUsage ? "provider" : "estimated",
    body: {
      object: "list",
      // Re-index defensively: some providers omit `index`.
      data: data.data.map((row, index) => ({
        object: "embedding",
        index: Number.isFinite(row?.index) ? row.index : index,
        embedding: row?.embedding,
      })),
      model: data?.model || model,
      usage: {
        prompt_tokens: promptTokens,
        total_tokens: Number.isFinite(data?.usage?.total_tokens) ? data.usage.total_tokens : promptTokens,
      },
    },
  };
}

/**
 * Run an embeddings request against a resolved target.
 *
 * @param {object} target - { kind: "ollama"|"openai-compatible", baseUrl, model, apiKey?, provider }
 */
export async function executeEmbeddings(target, { inputs, encodingFormat, dimensions, fetchImpl = fetch, signal }) {
  if (target.kind === "ollama") {
    return fetchOllamaEmbeddings({
      baseUrl: target.baseUrl, model: target.model, inputs, encodingFormat, fetchImpl, signal,
    });
  }
  return fetchOpenAiCompatibleEmbeddings({
    baseUrl: target.baseUrl, model: target.model, inputs, encodingFormat, dimensions,
    apiKey: target.apiKey, fetchImpl, signal,
  });
}
