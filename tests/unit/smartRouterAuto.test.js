/**
 * The two independent defects that made `model:"auto"` (and every
 * zippymesh/* / free/* / local/* playbook id) return 404 on dev-beta, pinned so
 * they cannot come back. Measured behaviour and file:line in
 * docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §6.
 *
 *  1. `parseConstraintsFromRequest` returned `null` when the request carried no
 *     X-* constraint header. Every consumer's `= {}` default only fires on
 *     `undefined`, so `recommendationService.scoreModel` threw
 *     `Cannot read properties of null (reading 'maxCostPerMTokens')`, routing
 *     was skipped, and the literal "auto" was forwarded to the provider.
 *
 *  2. Even when routing DID pick a model, the rewrite
 *     `new Request(nextRequest, init)` threw
 *     `Cannot read private member #state from an object whose class did not
 *     declare it`, the catch swallowed it, and the ORIGINAL body (model "auto")
 *     was sent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDiscoveryCatalog } = vi.hoisted(() => ({
  mockGetDiscoveryCatalog: vi.fn(),
}));

vi.mock("../../src/lib/discovery/catalogService.js", () => ({
  getDiscoveryCatalog: mockGetDiscoveryCatalog,
}));

import {
  parseConstraintsFromRequest,
  hasConstraints,
  rewriteRequestBody,
  applyRoutingHeaders,
  detectImageInput,
  shouldAvoidThinking,
} from "../../src/lib/routing/smartRouter.js";
import { getRecommendations } from "../../src/lib/discovery/recommendationService.js";

/** Minimal Request stand-in: only `headers.get` is exercised. */
function headerReq(headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { headers: { get: (k) => h[k.toLowerCase()] ?? null } };
}

function localModel(id, capabilities = []) {
  return {
    id,
    name: id,
    provider: "ollama",
    source: "local",
    fullModel: `ollama/${id}`,
    capabilities,
    isFree: true,
    inputPrice: null,
    contextWindow: null,
    isFast: false,
    local: true,
    deprecated: false,
    metadata: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDiscoveryCatalog.mockResolvedValue({
    models: [
      localModel("qwen3.5:4b", ["fast"]),
      localModel("deepseek-coder:6.7b", ["code"]),
    ],
  });
});

describe("parseConstraintsFromRequest — defect 1a", () => {
  it("returns an OBJECT, not null, when no X-* constraint header is present", () => {
    const constraints = parseConstraintsFromRequest(headerReq({}));
    expect(constraints).not.toBeNull();
    expect(constraints).toEqual({});
  });

  it("still parses every documented constraint header", () => {
    const constraints = parseConstraintsFromRequest(headerReq({
      "x-max-latency-ms": "1500",
      "x-max-cost-per-m-tokens": "0.75",
      "x-min-context-window": "32768",
      "x-prefer-free": "TRUE",
      "x-prefer-local": "false",
    }));
    expect(constraints).toEqual({
      maxLatencyMs: 1500,
      maxCostPerMTokens: 0.75,
      minContextWindow: 32768,
      preferFree: true,
      preferLocal: false,
    });
  });

  it("hasConstraints distinguishes 'nothing asked for' from a real constraint set", () => {
    expect(hasConstraints(parseConstraintsFromRequest(headerReq({})))).toBe(false);
    expect(hasConstraints(parseConstraintsFromRequest(headerReq({ "x-prefer-local": "true" })))).toBe(true);
    expect(hasConstraints(null)).toBe(false);
  });

  it("router-derived flags do not make an unconstrained request look constrained", () => {
    // hasImageInput / avoidThinking are facts the ROUTER worked out, not things
    // the caller asked for; telemetry stores null for "unconstrained".
    expect(hasConstraints({ hasImageInput: true, avoidThinking: true })).toBe(false);
    expect(hasConstraints({ hasImageInput: false, preferLocal: true })).toBe(true);
  });
});

/**
 * The AUTO defects from the 2026-08-30 adversarial round (finding H6).
 *
 * `{"model":"auto","messages":[{"role":"user","content":"Say OK"}],"max_tokens":8}`
 * answered 200 with `content: ""`. Two compounding causes, both here:
 *
 *   x-selected-model: ollama/qwen3-vl:2b-thinking
 *   x-routing-reason: Has vision capability (+5)
 *   x-routing-score:  56
 *
 * an unconditional +5 vision bonus on a text-only prompt selected the slowest
 * local model on the box (measured 21-22 s vs 0.8 s for a text model), and that
 * model is a *thinking* model whose answer lands in `message.reasoning` while
 * `message.content` stays `""`.
 */
describe("detectImageInput — the gate on the vision bonus", () => {
  it("is false for a plain string prompt, however much it talks about images", () => {
    expect(detectImageInput({ messages: [{ role: "user", content: "describe this image, screenshot, visual" }] })).toBe(false);
    expect(detectImageInput({ messages: [{ role: "user", content: "Say OK" }] })).toBe(false);
  });

  it("is true for a real OpenAI multimodal part", () => {
    expect(detectImageInput({
      messages: [{ role: "user", content: [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ] }],
    })).toBe(true);
  });

  it("recognises the Responses and Anthropic spellings too", () => {
    expect(detectImageInput({ messages: [{ role: "user", content: [{ type: "input_image", image_url: "x" }] }] })).toBe(true);
    expect(detectImageInput({ messages: [{ role: "user", content: [{ type: "image", source: {} }] }] })).toBe(true);
  });

  it("never throws on a missing, null or malformed body", () => {
    expect(detectImageInput(null)).toBe(false);
    expect(detectImageInput({})).toBe(false);
    expect(detectImageInput({ messages: "nope" })).toBe(false);
    expect(detectImageInput({ messages: [null, { content: [null, 3] }] })).toBe(false);
  });
});

describe("shouldAvoidThinking", () => {
  it("steers away from thinking models for the everyday intents", () => {
    for (const intent of ["default", "chat", "code", "fast", "vision"]) {
      expect(shouldAvoidThinking(intent)).toBe(true);
    }
  });

  it("does NOT when the caller asked for reasoning", () => {
    expect(shouldAvoidThinking("reasoning")).toBe(false);
  });
});

describe("scoring — H6, the model `auto` actually picks", () => {
  /** The three models the review's box offered for a plain "Say OK". */
  const BOX = [
    localModel("qwen3-vl:2b-thinking", ["vision", "reasoning", "fast"]),
    localModel("qwen3.5:4b", ["fast"]),
    localModel("llama3.1:8b", ["fast"]),
  ];

  it("a text-only `auto` no longer picks the vision/thinking model", async () => {
    mockGetDiscoveryCatalog.mockResolvedValue({ models: BOX });
    const r = await getRecommendations("default", { hasImageInput: false, avoidThinking: true }, "");
    expect(r.recommendations[0].fullModel).not.toBe("ollama/qwen3-vl:2b-thinking");
    // ...and the reason string that used to be on the wire as x-routing-reason
    // ("Has vision capability (+5)") appears on NO candidate.
    expect(r.recommendations.map((x) => x.reasoning.join(" ")).join(" ")).not.toMatch(/Has vision capability/);
  });

  it("the vision bonus comes back when the request actually carries an image", async () => {
    mockGetDiscoveryCatalog.mockResolvedValue({ models: BOX });
    const r = await getRecommendations("vision", { hasImageInput: true }, "");
    expect(r.recommendations[0].fullModel).toBe("ollama/qwen3-vl:2b-thinking");
    expect(r.recommendations[0].reasoning.join(" ")).toMatch(/Has vision capability \(\+5\)/);
  });

  it("a thinking model IS chosen when the intent asks for reasoning", async () => {
    mockGetDiscoveryCatalog.mockResolvedValue({ models: BOX });
    const r = await getRecommendations("reasoning", { avoidThinking: true }, "");
    expect(r.recommendations[0].fullModel).toBe("ollama/qwen3-vl:2b-thinking");
  });

  it("a thinking model IS chosen when nothing else is on the box", async () => {
    // The penalty is uniform, so ordering among thinking models is unchanged and
    // `auto` still answers rather than failing to select anything.
    mockGetDiscoveryCatalog.mockResolvedValue({
      models: [localModel("deepseek-r1:14b", ["reasoning"]), localModel("qwen3-vl:2b-thinking", ["reasoning", "fast"])],
    });
    const r = await getRecommendations("default", { avoidThinking: true }, "");
    expect(r.recommendations[0].fullModel).toBe("ollama/qwen3-vl:2b-thinking");
    expect(r.recommendations[0].score).toBeGreaterThan(0);
  });

  it("a non-thinking peer outranks a thinking one that would otherwise tie or win", async () => {
    mockGetDiscoveryCatalog.mockResolvedValue({
      models: [localModel("thinker:4b", ["reasoning", "fast"]), localModel("plain:8b", ["fast"])],
    });
    const r = await getRecommendations("default", { avoidThinking: true }, "");
    expect(r.recommendations[0].fullModel).toBe("ollama/plain:8b");
    const thinker = r.recommendations.find((x) => x.fullModel === "ollama/thinker:4b");
    expect(thinker.score).toBeLessThan(r.recommendations[0].score);
    expect(thinker.reasoning.join(" ")).toMatch(/Thinking model deprioritised/);
  });

  it("without the flags, scoring is unchanged for callers that never set them", async () => {
    mockGetDiscoveryCatalog.mockResolvedValue({ models: BOX });
    const r = await getRecommendations("default", {}, "");
    expect(r.recommendations.length).toBeGreaterThan(0);
    // No image and no flag: still no vision bonus. The bonus is opt-in now.
    expect(r.recommendations.map((x) => x.reasoning.join(" ")).join(" ")).not.toMatch(/Has vision capability/);
  });
});

describe("getRecommendations — defect 1a, the throw site", () => {
  it("does not throw when handed an explicit null (the old smartRouter output)", async () => {
    const result = await getRecommendations("default", null, "");
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0].fullModel).toMatch(/^ollama\//);
  });

  it("does not throw when handed undefined", async () => {
    const result = await getRecommendations("default", undefined);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("recommends a provider-qualified id a client can actually send", async () => {
    const result = await getRecommendations("default", {}, "");
    for (const rec of result.recommendations) {
      expect(rec.fullModel).toContain("/");
    }
  });

  it("X-Intent: code steers the selection to a code-capable model", async () => {
    const result = await getRecommendations("code", { preferLocal: true }, "");
    expect(result.recommendations[0].fullModel).toBe("ollama/deepseek-coder:6.7b");
  });

  it("survives a catalog entry with no capabilities array", async () => {
    mockGetDiscoveryCatalog.mockResolvedValue({
      models: [{ id: "weird", fullModel: "plugin/weird", provider: "plugin", source: "plugin" }],
    });
    const result = await getRecommendations("default", null, "");
    expect(result.recommendations.length).toBe(1);
  });
});

describe("rewriteRequestBody — defect 1b", () => {
  const URL_ = "http://127.0.0.1:20128/v1/chat/completions";

  function originalRequest(body) {
    return new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", "x-intent": "code", "content-length": "999" },
      body: JSON.stringify(body),
    });
  }

  it("produces a request whose body carries the rewritten model", async () => {
    const req = originalRequest({ model: "auto", messages: [{ role: "user", content: "hi" }] });
    const rewritten = rewriteRequestBody(req, { model: "ollama/qwen3.5:4b", messages: [{ role: "user", content: "hi" }] });

    expect(await rewritten.json()).toEqual({
      model: "ollama/qwen3.5:4b",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("does not consume the original request — the caller still holds a usable body", async () => {
    const req = originalRequest({ model: "auto", messages: [] });
    rewriteRequestBody(req, { model: "ollama/qwen3.5:4b", messages: [] });
    // `new Request(req, {body})` marks `req` disturbed; this must not.
    expect(req.bodyUsed).toBe(false);
    expect((await req.json()).model).toBe("auto");
  });

  it("keeps the routing headers and drops the now-wrong content-length", () => {
    const req = originalRequest({ model: "auto" });
    const rewritten = rewriteRequestBody(req, { model: "ollama/qwen3.5:4b" });
    expect(rewritten.headers.get("x-intent")).toBe("code");
    expect(rewritten.headers.get("content-type")).toBe("application/json");
    expect(rewritten.headers.get("content-length")).toBeNull();
    expect(rewritten.method).toBe("POST");
    expect(rewritten.url).toBe(URL_);
  });

  it("works on a NextRequest-like object that cannot be used as a Request input", async () => {
    // The real NextRequest throws "Cannot read private member #state" when
    // passed to `new Request(input, init)`. Anything with url/method/headers is
    // enough for the plain-Request builder.
    const nextish = {
      url: URL_,
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "x-prefer-local": "true" }),
    };
    const rewritten = rewriteRequestBody(nextish, { model: "ollama/qwen3.5:4b" });
    expect((await rewritten.json()).model).toBe("ollama/qwen3.5:4b");
    expect(rewritten.headers.get("x-prefer-local")).toBe("true");
  });
});

describe("applyRoutingHeaders", () => {
  it("reports the selection on the SUCCESS path headers", () => {
    const headers = new Headers();
    applyRoutingHeaders(headers, {
      selected: "ollama/qwen3.5:4b",
      intent: "code",
      score: 56,
      reason: "Local model (privacy/speed)",
    });
    expect(headers.get("x-selected-model")).toBe("ollama/qwen3.5:4b");
    expect(headers.get("x-routing-intent")).toBe("code");
    expect(headers.get("x-routing-score")).toBe("56");
    expect(headers.get("x-routing-reason")).toBe("Local model (privacy/speed)");
  });

  it("never writes the string 'null' when nothing was selected", () => {
    const headers = new Headers();
    applyRoutingHeaders(headers, { selected: null, intent: "default", score: 0 });
    expect(headers.get("x-selected-model")).toBeNull();
    expect(headers.get("x-routing-intent")).toBe("default");
  });

  it("is a no-op on immutable headers rather than throwing", () => {
    const immutable = { set: () => { throw new TypeError("immutable"); } };
    expect(() => applyRoutingHeaders(immutable, { selected: "a/b" })).not.toThrow();
  });
});
