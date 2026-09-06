/**
 * Pure logic for the "Add a local runtime" card (AddLocalRuntime.js).
 *
 * Kept free of React and of any DOM/browser API so it can be unit-tested in the
 * project's Node vitest environment (tests/unit/addLocalRuntime.test.js). This
 * follows the convention that just landed for the vault UI —
 * `agentTokenLogic.js` beside `AgentTokensPanel.js`.
 *
 * It backs the ONE-CALL local-runtime path added 2026-08-30:
 *
 *   POST /api/provider-nodes
 *   { type:"local", apiType:"ollama"|"lmstudio"|"llamacpp"|"openai-compatible",
 *     baseUrl?, name? }
 *     -> 201 { node, created:true,  models, modelIds }
 *     -> 200 { node, created:false, deduped:true, ... }   already registered
 *     -> 400 unsupported apiType / unparseable baseUrl
 *     -> 502 nothing answered at that URL
 *
 * Before it existed the only way in was "Scan Local Network" (POST /api/discovery),
 * a ~240 s /24 sweep. That button still exists, demoted to a secondary link.
 */

/* ------------------------------------------------------------------ *
 * Runtime table
 *
 * DUPLICATED ON PURPOSE from `LOCAL_RUNTIME_PROFILES` in
 * src/lib/discovery/localDiscovery.js. That module cannot be imported into a
 * client bundle: it imports `node:os` and src/lib/localDb.js at the top level
 * (localDb resolves + creates its data directory at module-import time).
 *
 * Keep in sync with:
 *   - LOCAL_RUNTIME_PROFILES   src/lib/discovery/localDiscovery.js  (defaultPort, appendV1, label)
 *   - LOCAL_DEFAULT_BASE_URLS  src/app/api/provider-nodes/route.js  (the 127.0.0.1 host)
 *   - prefixForNode()          src/lib/routing/localModelIndex.js   (modelPrefix)
 *
 * tests/unit/addLocalRuntime.test.js asserts parity against the server module,
 * so a drift here fails the unit suite rather than shipping a wrong default.
 *
 * `vllm` is also accepted by the API (defaultPort 8000) but is not offered in
 * the picker — an operator running vLLM can use "OpenAI-compatible", which is
 * stored identically (storedApiType "openai", probe path /v1/models).
 * ------------------------------------------------------------------ */

/** Host the API defaults to for every local runtime. */
export const LOCAL_DEFAULT_HOST = "127.0.0.1";

export const LOCAL_RUNTIME_OPTIONS = Object.freeze([
  Object.freeze({
    value: "ollama",
    label: "Ollama",
    defaultPort: 11434,
    appendV1: false,
    modelPrefix: "ollama",
    modelToken: "tag",
    probePath: "/api/tags",
    hint: "Is Ollama running? Start it with `ollama serve`, then try again.",
  }),
  Object.freeze({
    value: "lmstudio",
    label: "LM Studio",
    defaultPort: 1234,
    appendV1: true,
    modelPrefix: "lmstudio",
    modelToken: "model",
    probePath: "/v1/models",
    hint: "Start the local server in LM Studio → Developer, then try again.",
  }),
  Object.freeze({
    value: "llamacpp",
    label: "llama.cpp",
    defaultPort: 8080,
    appendV1: true,
    modelPrefix: "lmstudio",
    modelToken: "model",
    probePath: "/v1/models",
    hint: "Start llama-server with an OpenAI-compatible port, e.g. `llama-server -m model.gguf --port 8080`.",
  }),
  Object.freeze({
    value: "openai-compatible",
    label: "OpenAI-compatible (vLLM, TGI, …)",
    defaultPort: 8000,
    appendV1: true,
    modelPrefix: "lmstudio",
    modelToken: "model",
    probePath: "/v1/models",
    hint: "Point at the server root (the part before `/v1`) and make sure it answers `GET /v1/models`.",
  }),
]);

/** The apiType the picker defaults to — a Kiro Crew user almost always has this. */
export const DEFAULT_API_TYPE = "ollama";

/** How many model ids the success state lists before collapsing to "+N more". */
export const MODEL_PREVIEW_LIMIT = 5;

/** @returns {object|null} the runtime option, or null when unknown. */
export function runtimeOption(apiType) {
  if (!apiType || typeof apiType !== "string") return null;
  const key = apiType.trim().toLowerCase();
  return LOCAL_RUNTIME_OPTIONS.find((o) => o.value === key) || null;
}

/** Options in the shape `<Select>` wants. */
export const RUNTIME_SELECT_OPTIONS = Object.freeze(
  LOCAL_RUNTIME_OPTIONS.map((o) => Object.freeze({ value: o.value, label: o.label }))
);

/**
 * The base URL to prefill when the runtime changes.
 * @returns {string} e.g. "http://127.0.0.1:11434", or "" for an unknown runtime.
 */
export function defaultBaseUrlFor(apiType) {
  const opt = runtimeOption(apiType);
  return opt ? `http://${LOCAL_DEFAULT_HOST}:${opt.defaultPort}` : "";
}

/**
 * Mirror of `normalizeLocalBaseUrl` in src/lib/discovery/localDiscovery.js:
 * scheme optional (http:// is assumed), trailing slashes dropped, one trailing
 * `/v1` dropped, then re-appended only for the OpenAI-shaped runtimes.
 *
 * Used for display + client-side validation only — the server normalises again
 * and remains the single authority. `normalizeBaseUrlInput(x).baseUrl` is a
 * fixed point of the server's function, so re-sending it changes nothing.
 *
 * @returns {{root: string, baseUrl: string}|null} null when unparseable.
 */
export function normalizeBaseUrlInput(rawBaseUrl, apiType) {
  const opt = runtimeOption(apiType);
  if (!opt || !rawBaseUrl || typeof rawBaseUrl !== "string") return null;

  let raw = rawBaseUrl.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  let path = url.pathname.replace(/\/+$/, "");
  if (/\/v1$/i.test(path)) path = path.slice(0, -3);
  const root = `${url.origin}${path}`.replace(/\/+$/, "");
  return { root, baseUrl: opt.appendV1 ? `${root}/v1` : root };
}

/**
 * Build the POST /api/provider-nodes body from the card's form state.
 *
 * @param {{apiType?: string, baseUrl?: string, name?: string}} form
 * @returns {{ok: true, payload: object, normalized: {root: string, baseUrl: string}}
 *          |{ok: false, error: string}}
 */
export function buildAddPayload(form = {}) {
  const { apiType = DEFAULT_API_TYPE, baseUrl = "", name = "" } = form;

  const opt = runtimeOption(apiType);
  if (!opt) {
    return { ok: false, error: "Pick a local runtime." };
  }

  const typed = typeof baseUrl === "string" ? baseUrl.trim() : "";
  const target = typed || defaultBaseUrlFor(opt.value);
  const normalized = normalizeBaseUrlInput(target, opt.value);
  if (!normalized) {
    return {
      ok: false,
      error: `Enter a valid address, e.g. ${defaultBaseUrlFor(opt.value)}`,
    };
  }

  const payload = {
    type: "local",
    apiType: opt.value,
    baseUrl: normalized.baseUrl,
  };
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (trimmedName) payload.name = trimmedName;

  return { ok: true, payload, normalized };
}

/** The per-runtime "it didn't answer" hint. */
export function troubleshootingHint(apiType) {
  const opt = runtimeOption(apiType);
  return opt ? opt.hint : "Check that the runtime is running and reachable at that address.";
}

/** How a newly-registered runtime's models are addressed, e.g. "ollama/<tag>". */
export function routableIdPattern(apiType) {
  const opt = runtimeOption(apiType);
  if (!opt) return "";
  return `${opt.modelPrefix}/<${opt.modelToken}>`;
}

/**
 * Trim a model-id list down to a preview.
 * @returns {{shown: string[], extraCount: number}}
 */
export function previewModelIds(modelIds, limit = MODEL_PREVIEW_LIMIT) {
  const all = Array.isArray(modelIds) ? modelIds.filter((m) => typeof m === "string" && m) : [];
  const cap = Number.isFinite(limit) && limit > 0 ? limit : MODEL_PREVIEW_LIMIT;
  return { shown: all.slice(0, cap), extraCount: Math.max(0, all.length - cap) };
}

/**
 * Map an `addLocalRuntime()` result onto the card's result state.
 *
 * @param {object} result   the addLocalRuntimeApi result
 * @param {string} apiType  the runtime that was attempted
 * @returns {{kind: string, tone: string, title: string, detail: string,
 *            hint: string, modelIds: string[], extraCount: number}}
 *
 * kind is one of:
 *   "added"        201 — a new node was created
 *   "already"      200 — deduped by host:port, nothing to do
 *   "unreachable"  502 — nothing answered at that URL
 *   "invalid"      400 — bad apiType / unparseable baseUrl
 *   "unauthorized" 401 — session expired (the card redirects to /login)
 *   "error"        anything else, including a network failure (status 0)
 */
export function describeAddResult(result, apiType) {
  const opt = runtimeOption(apiType);
  const label = opt ? opt.label : "Local runtime";
  const blank = { modelIds: [], extraCount: 0, hint: "" };

  if (result?.ok) {
    const { shown, extraCount } = previewModelIds(result.modelIds);
    const count = Array.isArray(result.modelIds) ? result.modelIds.length : 0;

    if (result.created) {
      return {
        kind: "added",
        tone: "success",
        title:
          count > 0
            ? `${label} added — ${count} model${count === 1 ? "" : "s"} found`
            : `${label} added — no models loaded yet`,
        detail:
          count > 0
            ? `These are now routable as \`${routableIdPattern(opt?.value)}\` and via \`auto\`.`
            : `The runtime answered but is serving no models yet. Pull or load one and it becomes routable as \`${routableIdPattern(opt?.value)}\` and via \`auto\`.`,
        hint: "",
        modelIds: shown,
        extraCount,
      };
    }

    return {
      kind: "already",
      tone: "info",
      title: `${label} is already connected`,
      detail: result.node?.baseUrl
        ? `ZippyMesh already has a provider node for ${result.node.baseUrl}. Nothing to do — its models are already routable via \`auto\`.`
        : `ZippyMesh already has a provider node for this address. Nothing to do — its models are already routable via \`auto\`.`,
      hint: "",
      modelIds: shown,
      extraCount,
    };
  }

  const status = result?.status ?? 0;
  const serverMessage = typeof result?.error === "string" ? result.error : "";

  if (status === 401) {
    return {
      ...blank,
      kind: "unauthorized",
      tone: "error",
      title: "Session expired",
      detail: "Sign in again to add a local runtime.",
    };
  }

  if (status === 502) {
    return {
      ...blank,
      kind: "unreachable",
      tone: "error",
      title: `Nothing answered — ${label} is not reachable`,
      detail: serverMessage || `No ${label} runtime responded at that address.`,
      hint: troubleshootingHint(opt?.value),
    };
  }

  if (status === 400) {
    return {
      ...blank,
      kind: "invalid",
      tone: "error",
      title: "That address was rejected",
      detail: serverMessage || "The server could not parse that base URL.",
      hint: `Use the runtime's root URL, e.g. ${defaultBaseUrlFor(opt?.value) || `http://${LOCAL_DEFAULT_HOST}:11434`} — ZippyMesh appends the right path itself.`,
    };
  }

  return {
    ...blank,
    kind: "error",
    tone: "error",
    title: "Could not add the local runtime",
    detail: serverMessage || "Request failed.",
    hint: troubleshootingHint(opt?.value),
  };
}

/**
 * Pick a message out of either error envelope ZMLR emits on this route:
 *   - `apiError()` -> open-sse errorResponse: `{ error: { message, type, code } }`
 *   - a plain `{ error: "..." }` string envelope
 * falling back to safeFetchJson's own `error`.
 *
 * Mirrors `extractErrorMessage` in src/shared/components/vault/agentTokenLogic.js;
 * duplicated rather than cross-imported so the providers UI does not depend on
 * the vault UI.
 */
export function extractErrorMessage(result, fallback = "Request failed") {
  const data = result?.data;
  if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
  if (typeof data?.error?.message === "string" && data.error.message.trim()) {
    return data.error.message.trim();
  }
  if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
  if (typeof result?.error === "string" && result.error.trim()) return result.error.trim();
  return fallback;
}
