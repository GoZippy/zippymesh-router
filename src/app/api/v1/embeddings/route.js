/**
 * POST /v1/embeddings — OpenAI-compatible embeddings.
 *
 * Added 2026-08-30. Before this route existed, `GET /v1/models` advertised
 * `ollama/nomic-embed-text` while `client.embeddings.create()` got Next's HTML
 * 404 page (defect 8 in docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md).
 *
 * Request  {model, input: string|string[], encoding_format?, dimensions?}
 * Response {object:"list", data:[{object:"embedding", index, embedding}], model,
 *           usage:{prompt_tokens, total_tokens}}
 *
 * Every failure is the same OpenAI error envelope the rest of `/v1` uses
 * (open-sse/utils/error.js) — never HTML.
 *
 * Auth mirrors chat/completions: gated only when `settings.requireApiKey` is on,
 * and then only by `Authorization: Bearer <router key>`
 * (src/sse/handlers/chat.js:40-53 does the same thing).
 *
 * Routing: `<prefix>/<model>` where prefix is `ollama`, `lmstudio`, `openai`, or
 * the `prefix` of a registered `openai-compatible` provider node. A bare id with
 * no prefix is tried against the registered local runtimes in order.
 */

import { getSettings, getProviderNodes, getProviderConnections } from "@/lib/localDb.js";
import { requireApiKey } from "@/lib/auth/apiKey.js";
import { errorResponse } from "open-sse/utils/error.js";
import { getRequestIdFromRequest } from "@/lib/apiErrors.js";
import {
  EmbeddingsError,
  normalizeEmbeddingInput,
  parseEmbeddingModelId,
  executeEmbeddings,
} from "open-sse/handlers/embeddingsCore.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * Candidate targets for a model id, best first.
 * @returns {Promise<Array<{kind:string, baseUrl:string, model:string, provider:string, apiKey?:string, label:string}>>}
 */
async function resolveEmbeddingTargets(modelId) {
  const { prefix, alias, model } = parseEmbeddingModelId(modelId);

  let nodes = [];
  try {
    nodes = await getProviderNodes();
  } catch {
    nodes = [];
  }
  const localNodes = (nodes || []).filter((n) => n?.type === "local" && n?.baseUrl);
  const ollamaNodes = localNodes.filter((n) => n.apiType === "ollama");
  const lmStudioNodes = localNodes.filter((n) => n.apiType !== "ollama");

  const asOllama = (n) => ({
    kind: "ollama", baseUrl: n.baseUrl, model, provider: "ollama", label: n.name || n.baseUrl,
  });
  const asLmStudio = (n) => ({
    kind: "openai-compatible", baseUrl: n.baseUrl, model, provider: "lmstudio", label: n.name || n.baseUrl,
  });

  if (prefix === "ollama") {
    if (ollamaNodes.length === 0) {
      throw new EmbeddingsError(404,
        `No Ollama runtime is registered, so the model '${modelId}' cannot be served. Add one from the dashboard (Providers -> Scan) and try again.`,
        "model_not_found");
    }
    return ollamaNodes.map(asOllama);
  }

  if (prefix === "lmstudio") {
    if (lmStudioNodes.length === 0) {
      throw new EmbeddingsError(404,
        `No LM Studio runtime is registered, so the model '${modelId}' cannot be served.`,
        "model_not_found");
    }
    return lmStudioNodes.map(asLmStudio);
  }

  if (prefix === "openai") {
    let connections = [];
    try {
      connections = await getProviderConnections({ provider: "openai" });
    } catch {
      connections = [];
    }
    const usable = (connections || []).filter((c) => c?.apiKey && c?.isEnabled !== false);
    if (usable.length === 0) {
      throw new EmbeddingsError(404,
        `No OpenAI connection with an API key is configured, so the model '${modelId}' cannot be served.`,
        "model_not_found");
    }
    return usable.map((c) => ({
      kind: "openai-compatible",
      baseUrl: c.metadata?.baseUrl || OPENAI_BASE_URL,
      model,
      provider: "openai",
      apiKey: c.apiKey,
      label: c.name || "openai",
    }));
  }

  if (prefix) {
    // A registered openai-compatible provider node, addressed by its prefix.
    const compat = (nodes || []).filter(
      (n) => n?.type === "openai-compatible" && n?.baseUrl && (n.prefix === alias || n.prefix === prefix)
    );
    if (compat.length > 0) {
      return compat.map((n) => ({
        kind: "openai-compatible",
        baseUrl: n.baseUrl,
        model,
        provider: n.prefix || prefix,
        apiKey: n.metadata?.apiKey,
        label: n.name || n.baseUrl,
      }));
    }
    throw new EmbeddingsError(404,
      `The model '${modelId}' does not exist or is not reachable from this router. Provider prefix '${alias}' is not registered.`,
      "model_not_found");
  }

  // Bare id, no prefix: try every local runtime we know about.
  const bare = [...ollamaNodes.map(asOllama), ...lmStudioNodes.map(asLmStudio)];
  if (bare.length === 0) {
    throw new EmbeddingsError(404,
      `The model '${modelId}' does not exist or is not reachable from this router. Send a provider-qualified id such as 'ollama/${modelId}'.`,
      "model_not_found");
  }
  return bare;
}

export async function POST(request) {
  const requestId = getRequestIdFromRequest(request);

  // Auth — identical posture to /v1/chat/completions.
  try {
    const settings = await getSettings();
    if (settings?.requireApiKey) {
      await requireApiKey(request);
    }
  } catch (err) {
    return errorResponse(err?.code || 401, err?.message || "Missing API key", { requestId });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", { requestId });
  }

  let inputs;
  let targets;
  const encodingFormat = body?.encoding_format ?? "float";
  try {
    if (encodingFormat !== "float" && encodingFormat !== "base64") {
      throw new EmbeddingsError(400, `Unsupported encoding_format '${encodingFormat}'; expected 'float' or 'base64'`, "invalid_input");
    }
    inputs = normalizeEmbeddingInput(body?.input);
    targets = await resolveEmbeddingTargets(body?.model);
  } catch (err) {
    if (err instanceof EmbeddingsError) {
      return errorResponse(err.status, err.message, { requestId, ...(err.code ? { code: err.code } : {}) });
    }
    return errorResponse(400, err?.message || "Invalid request", { requestId });
  }

  let lastError = null;
  for (const target of targets) {
    try {
      const { body: payload, usageSource } = await executeEmbeddings(target, {
        inputs,
        encodingFormat,
        dimensions: body?.dimensions,
        signal: request.signal,
      });

      // Echo the provider-qualified id the client sent, not the provider's local
      // tag — same rule as chat/completions (defect 7).
      payload.model = typeof body?.model === "string" ? body.model : payload.model;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-Request-ID": requestId,
          "X-Routed-Provider": target.provider,
          "X-Routed-Model": target.model,
          "X-ZMLR-Model": payload.model,
          "X-ZMLR-Usage": usageSource,
        },
      });
    } catch (err) {
      lastError = err;
      // 404 from one runtime just means "not this one" — try the next.
      if (err instanceof EmbeddingsError && (err.status === 404 || err.status === 502)) continue;
      break;
    }
  }

  if (lastError instanceof EmbeddingsError) {
    return errorResponse(lastError.status, lastError.message, {
      requestId,
      ...(lastError.code ? { code: lastError.code } : {}),
    });
  }
  return errorResponse(502, `[502]: ${lastError?.message || "embedding request failed"}`, { requestId });
}
