/**
 * Unit tests for the "Add a local runtime" dashboard card.
 *
 * The card is the UI for the one-call fast path added 2026-08-30:
 *   POST /api/provider-nodes { type:"local", apiType, baseUrl?, name? }
 * which replaced "Scan Local Network" (POST /api/discovery, a ~240 s /24 sweep)
 * as the way a user points ZMLR at their own Ollama / LM Studio / llama.cpp.
 *
 * The vitest config runs in a Node environment with no DOM and the repo has no
 * jsdom / @testing-library, so — following the convention set by
 * tests/unit/agentTokensPanel.test.js — we exercise the pure logic module and
 * the fetch client rather than rendering the React component.
 *
 * Covered:
 *   1. default base URL per runtime, and PARITY with the server's own
 *      LOCAL_RUNTIME_PROFILES / normalizeLocalBaseUrl (the client table is a
 *      deliberate duplicate because localDiscovery.js imports node:os)
 *   2. URL normalisation (scheme optional, trailing "/v1" stripped then
 *      re-appended only for the OpenAI-shaped runtimes)
 *   3. payload construction
 *   4. result-state mapping for 201 / 200 / 400 / 502 / 401 / network failure
 *   5. addLocalRuntime() against a mocked global fetch
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// localDiscovery.js imports src/lib/localDb.js (which resolves + creates its
// data dir at import time) and src/lib/security.js. Stub both so importing it
// purely for the parity assertions has no side effects at all. Same shape as
// tests/unit/providerNodesLocal.test.js.
vi.mock("../../src/lib/localDb.js", () => ({
  createProviderNode: vi.fn(async (d) => ({ id: "node-1", ...d })),
  getProviderNodes: vi.fn(async () => []),
  getNodeIdentity: vi.fn(async () => ({ publicKey: "PUB" })),
}));

vi.mock("../../src/lib/security.js", () => ({
  signPayload: vi.fn(async () => "jwt"),
  verifyPayload: vi.fn(async () => ({})),
}));

import {
  DEFAULT_API_TYPE,
  LOCAL_DEFAULT_HOST,
  LOCAL_RUNTIME_OPTIONS,
  MODEL_PREVIEW_LIMIT,
  RUNTIME_SELECT_OPTIONS,
  buildAddPayload,
  defaultBaseUrlFor,
  describeAddResult,
  extractErrorMessage,
  normalizeBaseUrlInput,
  previewModelIds,
  routableIdPattern,
  runtimeOption,
  troubleshootingHint,
} from "../../src/shared/components/providers/addLocalRuntimeLogic.js";

import { addLocalRuntime } from "../../src/shared/components/providers/addLocalRuntimeApi.js";

// The server-side source of truth the client table duplicates.
import {
  LOCAL_RUNTIME_PROFILES,
  normalizeLocalBaseUrl,
} from "../../src/lib/discovery/localDiscovery.js";

// ── fetch harness ─────────────────────────────────────────────────────────────

/** Minimal Response stand-in: safeFetchJson only uses ok/status/statusText/text(). */
function jsonResponse(status, body, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

/** The envelope apiError() produces (open-sse errorResponse). */
function apiErrorBody(message) {
  return { error: { message, type: "invalid_request_error", code: "" } };
}

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ── 1. runtime table + defaults ───────────────────────────────────────────────

describe("runtime table", () => {
  it("offers exactly the four runtimes the card advertises, Ollama first", () => {
    expect(LOCAL_RUNTIME_OPTIONS.map((o) => o.value)).toEqual([
      "ollama",
      "lmstudio",
      "llamacpp",
      "openai-compatible",
    ]);
    expect(DEFAULT_API_TYPE).toBe("ollama");
    expect(LOCAL_RUNTIME_OPTIONS[0].value).toBe(DEFAULT_API_TYPE);
  });

  it("exposes them to <Select> as {value,label} pairs", () => {
    expect(RUNTIME_SELECT_OPTIONS).toHaveLength(LOCAL_RUNTIME_OPTIONS.length);
    for (const o of RUNTIME_SELECT_OPTIONS) {
      expect(typeof o.value).toBe("string");
      expect(typeof o.label).toBe("string");
      expect(Object.keys(o).sort()).toEqual(["label", "value"]);
    }
  });

  it("prefills the documented default port per runtime", () => {
    expect(defaultBaseUrlFor("ollama")).toBe("http://127.0.0.1:11434");
    expect(defaultBaseUrlFor("lmstudio")).toBe("http://127.0.0.1:1234");
    expect(defaultBaseUrlFor("llamacpp")).toBe("http://127.0.0.1:8080");
    expect(defaultBaseUrlFor("openai-compatible")).toBe("http://127.0.0.1:8000");
    expect(LOCAL_DEFAULT_HOST).toBe("127.0.0.1");
  });

  it("returns no URL (and no option) for an unknown runtime", () => {
    expect(defaultBaseUrlFor("gpt4all")).toBe("");
    expect(defaultBaseUrlFor("")).toBe("");
    expect(defaultBaseUrlFor(undefined)).toBe("");
    expect(runtimeOption("gpt4all")).toBeNull();
    expect(runtimeOption(null)).toBeNull();
  });

  it("accepts a differently-cased / padded apiType", () => {
    expect(runtimeOption(" Ollama ").value).toBe("ollama");
    expect(runtimeOption("LMStudio").value).toBe("lmstudio");
  });

  it("matches canonical keys only — the server's spelling aliases are its own", () => {
    // API_TYPE_ALIASES in localDiscovery.js also accepts "lm-studio",
    // "llama.cpp", "openai", ... The card never emits those, and accepting them
    // here would let a caller pick a runtime the picker cannot display.
    expect(runtimeOption("lm-studio")).toBeNull();
    expect(runtimeOption("llama.cpp")).toBeNull();
    expect(runtimeOption("openai")).toBeNull();
  });

  it("names the routable model-id shape per runtime", () => {
    expect(routableIdPattern("ollama")).toBe("ollama/<tag>");
    expect(routableIdPattern("lmstudio")).toBe("lmstudio/<model>");
    expect(routableIdPattern("llamacpp")).toBe("lmstudio/<model>");
    expect(routableIdPattern("openai-compatible")).toBe("lmstudio/<model>");
  });

  it("gives an actionable, runtime-specific 'nothing answered' hint", () => {
    expect(troubleshootingHint("ollama")).toMatch(/ollama serve/);
    expect(troubleshootingHint("lmstudio")).toMatch(/LM Studio/);
    expect(troubleshootingHint("lmstudio")).toMatch(/Developer/);
    expect(troubleshootingHint("llamacpp")).toMatch(/llama-server/);
    expect(troubleshootingHint("nope")).toMatch(/running and reachable/i);
  });
});

// ── 1b. parity with the server's own table + normaliser ───────────────────────
//
// addLocalRuntimeLogic.js duplicates LOCAL_RUNTIME_PROFILES because
// src/lib/discovery/localDiscovery.js imports node:os and src/lib/localDb.js
// and therefore cannot be pulled into a client bundle. These assertions make a
// drift fail here instead of shipping a wrong default port to a user.

describe("parity with src/lib/discovery/localDiscovery.js", () => {
  it("every offered runtime is an apiType the server actually supports", () => {
    for (const opt of LOCAL_RUNTIME_OPTIONS) {
      expect(LOCAL_RUNTIME_PROFILES[opt.value], `missing server profile for ${opt.value}`).toBeTruthy();
    }
  });

  it("defaultPort / appendV1 / probePath match the server profile", () => {
    for (const opt of LOCAL_RUNTIME_OPTIONS) {
      const profile = LOCAL_RUNTIME_PROFILES[opt.value];
      expect(opt.defaultPort, `defaultPort drift for ${opt.value}`).toBe(profile.defaultPort);
      expect(opt.appendV1, `appendV1 drift for ${opt.value}`).toBe(profile.appendV1);
      expect(opt.probePath, `probePath drift for ${opt.value}`).toBe(profile.probePath);
    }
  });

  it("modelPrefix matches prefixForNode()'s ollama-vs-everything-else split", () => {
    for (const opt of LOCAL_RUNTIME_OPTIONS) {
      const storedApiType = LOCAL_RUNTIME_PROFILES[opt.value].storedApiType;
      expect(opt.modelPrefix).toBe(storedApiType === "ollama" ? "ollama" : "lmstudio");
    }
  });

  it("normalizeBaseUrlInput agrees with the server's normalizeLocalBaseUrl", () => {
    const inputs = [
      "http://127.0.0.1:11434",
      "127.0.0.1:11434",
      "localhost:1234/v1",
      "http://localhost:1234/v1/",
      "http://10.0.0.9:8080///",
      "https://box.lan:8443/llm/v1",
      "http://127.0.0.1:8000/openai/v1",
    ];
    for (const opt of LOCAL_RUNTIME_OPTIONS) {
      for (const input of inputs) {
        expect(
          normalizeBaseUrlInput(input, opt.value),
          `drift for ${opt.value} / ${input}`
        ).toEqual(normalizeLocalBaseUrl(input, opt.value));
      }
    }
  });

  it("agrees with the server on unparseable input too", () => {
    for (const bad of ["", "   ", "http://", "::::"]) {
      expect(normalizeBaseUrlInput(bad, "ollama")).toEqual(
        normalizeLocalBaseUrl(bad, "ollama") ?? null
      );
    }
  });
});

// ── 2. URL normalisation ──────────────────────────────────────────────────────

describe("normalizeBaseUrlInput", () => {
  it("assumes http:// when the scheme is left off", () => {
    expect(normalizeBaseUrlInput("127.0.0.1:11434", "ollama")).toEqual({
      root: "http://127.0.0.1:11434",
      baseUrl: "http://127.0.0.1:11434",
    });
  });

  it("keeps an explicit https scheme", () => {
    expect(normalizeBaseUrlInput("https://box.lan:8443", "ollama").root).toBe("https://box.lan:8443");
  });

  it("drops trailing slashes", () => {
    expect(normalizeBaseUrlInput("http://127.0.0.1:11434///", "ollama").baseUrl).toBe(
      "http://127.0.0.1:11434"
    );
  });

  it("strips a trailing /v1 and does NOT put it back for Ollama", () => {
    expect(normalizeBaseUrlInput("http://127.0.0.1:11434/v1", "ollama")).toEqual({
      root: "http://127.0.0.1:11434",
      baseUrl: "http://127.0.0.1:11434",
    });
  });

  it("strips a trailing /v1 and puts it back for the OpenAI-shaped runtimes", () => {
    for (const t of ["lmstudio", "llamacpp", "openai-compatible"]) {
      expect(normalizeBaseUrlInput("http://127.0.0.1:1234/v1/", t)).toEqual({
        root: "http://127.0.0.1:1234",
        baseUrl: "http://127.0.0.1:1234/v1",
      });
    }
  });

  it("preserves a mount path while still handling its /v1", () => {
    expect(normalizeBaseUrlInput("http://box.lan:8080/llm/v1", "llamacpp")).toEqual({
      root: "http://box.lan:8080/llm",
      baseUrl: "http://box.lan:8080/llm/v1",
    });
  });

  it("is a fixed point: re-normalising its own output changes nothing", () => {
    for (const t of ["ollama", "lmstudio", "llamacpp", "openai-compatible"]) {
      const once = normalizeBaseUrlInput(defaultBaseUrlFor(t), t);
      const twice = normalizeBaseUrlInput(once.baseUrl, t);
      expect(twice).toEqual(once);
      // and the server does not change it either — this is what the card sends
      expect(normalizeLocalBaseUrl(once.baseUrl, t)).toEqual(once);
    }
  });

  it("returns null for unusable input", () => {
    expect(normalizeBaseUrlInput("", "ollama")).toBeNull();
    expect(normalizeBaseUrlInput("   ", "ollama")).toBeNull();
    expect(normalizeBaseUrlInput("http://", "ollama")).toBeNull();
    expect(normalizeBaseUrlInput(null, "ollama")).toBeNull();
    expect(normalizeBaseUrlInput("http://127.0.0.1:11434", "gpt4all")).toBeNull();
  });
});

// ── 3. payload construction ───────────────────────────────────────────────────

describe("buildAddPayload", () => {
  it("falls back to the runtime default when the URL field is blank", () => {
    const r = buildAddPayload({ apiType: "ollama", baseUrl: "  " });
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({
      type: "local",
      apiType: "ollama",
      baseUrl: "http://127.0.0.1:11434",
    });
  });

  it("defaults to Ollama when no runtime is given", () => {
    const r = buildAddPayload({});
    expect(r.payload.apiType).toBe("ollama");
    expect(r.payload.baseUrl).toBe("http://127.0.0.1:11434");
  });

  it("sends the normalised URL, /v1 appended for LM Studio", () => {
    const r = buildAddPayload({ apiType: "lmstudio", baseUrl: "localhost:1234" });
    expect(r.payload.baseUrl).toBe("http://localhost:1234/v1");
  });

  it("always sends type:'local' so the route takes the fast path", () => {
    for (const t of ["ollama", "lmstudio", "llamacpp", "openai-compatible"]) {
      expect(buildAddPayload({ apiType: t }).payload.type).toBe("local");
    }
  });

  it("trims the optional name and omits it when blank", () => {
    expect(buildAddPayload({ apiType: "ollama", name: "  Workstation  " }).payload.name).toBe(
      "Workstation"
    );
    expect("name" in buildAddPayload({ apiType: "ollama", name: "   " }).payload).toBe(false);
    expect("name" in buildAddPayload({ apiType: "ollama" }).payload).toBe(false);
  });

  it("rejects an unsupported runtime before any request", () => {
    const r = buildAddPayload({ apiType: "gpt4all" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pick a local runtime/i);
  });

  it("rejects an unparseable URL and names a working example", () => {
    const r = buildAddPayload({ apiType: "ollama", baseUrl: "http://" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("http://127.0.0.1:11434");
  });
});

// ── 4. result-state mapping ───────────────────────────────────────────────────

describe("describeAddResult", () => {
  const ok201 = {
    ok: true,
    status: 201,
    created: true,
    node: { id: "n1", baseUrl: "http://127.0.0.1:11434", apiType: "ollama" },
    models: ["qwen3:4b", "llama3.2:3b"],
    modelIds: ["ollama/qwen3:4b", "ollama/llama3.2:3b"],
  };

  it("201 -> success, model count, ids and the routing sentence", () => {
    const d = describeAddResult(ok201, "ollama");
    expect(d.kind).toBe("added");
    expect(d.tone).toBe("success");
    expect(d.title).toBe("Ollama added — 2 models found");
    expect(d.modelIds).toEqual(["ollama/qwen3:4b", "ollama/llama3.2:3b"]);
    expect(d.extraCount).toBe(0);
    expect(d.detail).toContain("ollama/<tag>");
    expect(d.detail).toContain("auto");
    expect(d.hint).toBe("");
  });

  it("201 singular/zero model wording", () => {
    expect(describeAddResult({ ...ok201, modelIds: ["ollama/qwen3:4b"] }, "ollama").title).toBe(
      "Ollama added — 1 model found"
    );
    const none = describeAddResult({ ...ok201, models: [], modelIds: [] }, "ollama");
    expect(none.kind).toBe("added");
    expect(none.title).toBe("Ollama added — no models loaded yet");
    expect(none.detail).toContain("ollama/<tag>");
  });

  it("201 caps the id preview and reports the remainder", () => {
    const many = Array.from({ length: 9 }, (_, i) => `ollama/m${i}`);
    const d = describeAddResult({ ...ok201, modelIds: many }, "ollama");
    expect(d.modelIds).toHaveLength(MODEL_PREVIEW_LIMIT);
    expect(d.extraCount).toBe(9 - MODEL_PREVIEW_LIMIT);
    expect(d.title).toBe("Ollama added — 9 models found");
  });

  it("200 -> already connected, and says so instead of claiming an add", () => {
    const d = describeAddResult(
      { ...ok201, status: 200, created: false, modelIds: [] },
      "ollama"
    );
    expect(d.kind).toBe("already");
    expect(d.tone).toBe("info");
    expect(d.title).toBe("Ollama is already connected");
    expect(d.detail).toContain("http://127.0.0.1:11434");
    expect(d.detail).toMatch(/nothing to do/i);
  });

  it("200 without a node still reads sensibly", () => {
    const d = describeAddResult({ ok: true, status: 200, created: false, modelIds: [] }, "lmstudio");
    expect(d.kind).toBe("already");
    expect(d.title).toBe("LM Studio is already connected");
    expect(d.detail).toMatch(/this address/i);
  });

  it("502 -> unreachable, keeps the server's sentence, adds the runtime hint", () => {
    const serverMsg =
      "No Ollama runtime responded at http://127.0.0.1:11434/api/tags (fetch failed)";
    const d = describeAddResult({ ok: false, status: 502, error: serverMsg }, "ollama");
    expect(d.kind).toBe("unreachable");
    expect(d.tone).toBe("error");
    expect(d.title).toMatch(/not reachable/i);
    expect(d.detail).toBe(serverMsg);
    expect(d.hint).toMatch(/ollama serve/);
    expect(d.modelIds).toEqual([]);
  });

  it("502 hint is per-runtime", () => {
    const d = describeAddResult({ ok: false, status: 502, error: "nope" }, "lmstudio");
    expect(d.title).toMatch(/LM Studio/);
    expect(d.hint).toMatch(/LM Studio → Developer/);
  });

  it("400 -> invalid, and points at the expected root URL shape", () => {
    const d = describeAddResult(
      { ok: false, status: 400, error: 'Invalid baseUrl "http://"' },
      "llamacpp"
    );
    expect(d.kind).toBe("invalid");
    expect(d.detail).toBe('Invalid baseUrl "http://"');
    expect(d.hint).toContain("http://127.0.0.1:8080");
  });

  it("401 -> unauthorized (the card redirects to /login)", () => {
    const d = describeAddResult(
      { ok: false, status: 401, unauthorized: true, error: "Unauthorized" },
      "ollama"
    );
    expect(d.kind).toBe("unauthorized");
    expect(d.tone).toBe("error");
    expect(d.title).toMatch(/session expired/i);
  });

  it("a network failure (status 0) falls through to the generic error state", () => {
    const d = describeAddResult({ ok: false, status: 0, error: "network down" }, "ollama");
    expect(d.kind).toBe("error");
    expect(d.detail).toBe("network down");
    expect(d.hint).toMatch(/ollama serve/);
  });

  it("a 500 also falls through to the generic error state", () => {
    const d = describeAddResult(
      { ok: false, status: 500, error: "Failed to create provider node" },
      "ollama"
    );
    expect(d.kind).toBe("error");
    expect(d.detail).toBe("Failed to create provider node");
  });
});

describe("previewModelIds", () => {
  it("caps at the preview limit and counts the rest", () => {
    const ids = Array.from({ length: 7 }, (_, i) => `ollama/m${i}`);
    expect(previewModelIds(ids)).toEqual({ shown: ids.slice(0, 5), extraCount: 2 });
  });

  it("tolerates a missing / junk list", () => {
    expect(previewModelIds(undefined)).toEqual({ shown: [], extraCount: 0 });
    expect(previewModelIds(null)).toEqual({ shown: [], extraCount: 0 });
    expect(previewModelIds(["a", null, 3, "b"], 10)).toEqual({ shown: ["a", "b"], extraCount: 0 });
  });
});

// ── 5. error envelopes ────────────────────────────────────────────────────────

describe("extractErrorMessage", () => {
  it("reads apiError()'s OpenAI-style object envelope", () => {
    expect(extractErrorMessage({ status: 502, data: apiErrorBody("nothing answered") })).toBe(
      "nothing answered"
    );
  });

  it("reads a plain string envelope", () => {
    expect(extractErrorMessage({ data: { error: "Name is required" } })).toBe("Name is required");
  });

  it("falls back to safeFetchJson's own error, then the default", () => {
    expect(extractErrorMessage({ status: 0, data: null, error: "fetch failed" })).toBe("fetch failed");
    expect(extractErrorMessage({ data: {} }, "boom")).toBe("boom");
    expect(extractErrorMessage(null, "boom")).toBe("boom");
  });
});

// ── 6. API client ─────────────────────────────────────────────────────────────

describe("addLocalRuntimeApi — addLocalRuntime", () => {
  it("POSTs {type:'local'} and reports a 201 as created", async () => {
    const node = { id: "n1", type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" };
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(201, {
        node,
        created: true,
        deduped: false,
        models: ["qwen3:4b"],
        modelIds: ["ollama/qwen3:4b"],
      })
    );

    const r = await addLocalRuntime({ apiType: "ollama" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(201);
    expect(r.created).toBe(true);
    expect(r.node).toEqual(node);
    expect(r.models).toEqual(["qwen3:4b"]);
    expect(r.modelIds).toEqual(["ollama/qwen3:4b"]);

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/provider-nodes");
    expect(opts.method).toBe("POST");
    expect(opts.credentials).toBe("include");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({
      type: "local",
      apiType: "ollama",
      baseUrl: "http://127.0.0.1:11434",
    });
  });

  it("passes an explicit URL and name through, normalised", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(201, { node: {}, created: true }));
    await addLocalRuntime({ apiType: "lmstudio", baseUrl: " localhost:1234/v1/ ", name: " Studio " });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      type: "local",
      apiType: "lmstudio",
      baseUrl: "http://localhost:1234/v1",
      name: "Studio",
    });
  });

  it("reports a 200 as already registered, not as created", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { node: { id: "n1" }, created: false, deduped: true, models: [], modelIds: [] })
    );
    const r = await addLocalRuntime({ apiType: "ollama" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.created).toBe(false);
    expect(describeAddResult(r, "ollama").kind).toBe("already");
  });

  it("trusts data.created over the status code (a proxy may rewrite 201 -> 200)", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { node: {}, created: true, modelIds: [] }));
    expect((await addLocalRuntime({ apiType: "ollama" })).created).toBe(true);
  });

  it("surfaces the route's 400 for a bad apiType", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        400,
        apiErrorBody('Invalid local apiType "gpt4all". Use one of: ollama, lmstudio, llamacpp, vllm, openai-compatible')
      )
    );
    // Reached only when the server disagrees with the client table; force it by
    // sending a runtime the client does know.
    const r = await addLocalRuntime({ apiType: "ollama" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.unauthorized).toBe(false);
    expect(r.error).toMatch(/Invalid local apiType/);
    expect(describeAddResult(r, "ollama").kind).toBe("invalid");
  });

  it("surfaces the route's 502 when nothing answered", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        502,
        apiErrorBody("No Ollama runtime responded at http://127.0.0.1:11434/api/tags (fetch failed)")
      )
    );
    const r = await addLocalRuntime({ apiType: "ollama" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(502);
    expect(r.error).toMatch(/No Ollama runtime responded/);
    const d = describeAddResult(r, "ollama");
    expect(d.kind).toBe("unreachable");
    expect(d.hint).toMatch(/ollama serve/);
  });

  it("flags a 401 as unauthorized so the card can redirect to /login", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, apiErrorBody("Unauthorized")));
    const r = await addLocalRuntime({ apiType: "ollama" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.unauthorized).toBe(true);
    expect(r.error).toBe("Unauthorized");
    expect(describeAddResult(r, "ollama").kind).toBe("unauthorized");
  });

  it("surfaces a network failure as status 0", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const r = await addLocalRuntime({ apiType: "ollama" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.error).toBe("network down");
  });

  it("rejects an unsupported runtime without spending a request", async () => {
    globalThis.fetch = vi.fn();
    const r = await addLocalRuntime({ apiType: "gpt4all" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pick a local runtime/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects an unparseable URL without spending a request", async () => {
    globalThis.fetch = vi.fn();
    const r = await addLocalRuntime({ apiType: "ollama", baseUrl: "http://" });
    expect(r.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("tolerates a 2xx body with no models arrays", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(201, { node: { id: "n1" }, created: true }));
    const r = await addLocalRuntime({ apiType: "ollama" });
    expect(r.models).toEqual([]);
    expect(r.modelIds).toEqual([]);
    expect(describeAddResult(r, "ollama").title).toBe("Ollama added — no models loaded yet");
  });
});
