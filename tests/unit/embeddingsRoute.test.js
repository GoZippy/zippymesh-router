/**
 * Unit tests for POST /v1/embeddings and the JSON catch-all under /v1.
 *
 * Covers defect 8 from docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §1:
 * `/v1/embeddings` had no route file, so an OpenAI SDK's
 * `client.embeddings.create()` received Next's **HTML** 404 page and failed at
 * the parse step — while `GET /v1/models` happily advertised
 * `ollama/nomic-embed-text`.
 *
 * The REAL route handler, the REAL localDb (on the throwaway DATA_DIR that
 * tests/unit/_setup/dataDir.mjs creates) and the REAL provider-node lookup run.
 * Only `fetch` is stubbed, so no request leaves the machine.
 *
 * The stubbed provider payloads are the exact shapes Ollama 0.32.14 returned on
 * 2026-08-30:
 *   POST /api/embed      -> {model, embeddings:[[...768 floats]], prompt_eval_count}
 *   POST /v1/embeddings  -> {object:"list", data:[{object,embedding,index}], model, usage}
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

import {
  EmbeddingsError,
  normalizeEmbeddingInput,
  parseEmbeddingModelId,
  floatsToBase64,
  ollamaRoot,
  openAiCompatibleEmbeddingsUrl,
  estimateEmbeddingPromptTokens,
  fetchOllamaEmbeddings,
  fetchOpenAiCompatibleEmbeddings,
} from "../../open-sse/handlers/embeddingsCore.js";
import { createProviderNode } from "../../src/lib/localDb.js";
import { POST, OPTIONS } from "../../src/app/api/v1/embeddings/route.js";
import { POST as CATCHALL_POST, GET as CATCHALL_GET } from "../../src/app/api/v1/[...path]/route.js";

const OLLAMA_URL = "http://127.0.0.1:11434";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function post(body, { headers = {} } = {}) {
  return new Request("http://127.0.0.1/api/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function read(res) {
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON — that is the bug we test for */ }
  return { status: res.status, headers: res.headers, text, json };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────

describe("normalizeEmbeddingInput", () => {
  it("accepts a string", () => {
    expect(normalizeEmbeddingInput("hello")).toEqual(["hello"]);
  });

  it("accepts an array of strings", () => {
    expect(normalizeEmbeddingInput(["a", "b"])).toEqual(["a", "b"]);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a number", 7],
    ["an object", { text: "hi" }],
    ["an empty string", ""],
    ["an empty array", []],
    ["token ids", [[1, 2, 3]]],
    ["mixed types", ["a", 3]],
  ])("rejects %s with a 400", (_label, value) => {
    let thrown = null;
    try { normalizeEmbeddingInput(value); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(EmbeddingsError);
    expect(thrown.status).toBe(400);
  });
});

describe("model id parsing", () => {
  it("splits on the first slash and resolves the provider alias", () => {
    expect(parseEmbeddingModelId("ollama/nomic-embed-text:latest"))
      .toEqual({ prefix: "ollama", alias: "ollama", model: "nomic-embed-text:latest" });
    expect(parseEmbeddingModelId("ol/nomic-embed-text"))
      .toEqual({ prefix: "ollama", alias: "ol", model: "nomic-embed-text" });
  });

  it("treats an unprefixed id as a bare model", () => {
    expect(parseEmbeddingModelId("nomic-embed-text")).toEqual({ prefix: null, alias: null, model: "nomic-embed-text" });
  });

  it("rejects a missing model with a 400", () => {
    expect(() => parseEmbeddingModelId(undefined)).toThrow(EmbeddingsError);
    expect(() => parseEmbeddingModelId("  ")).toThrow(EmbeddingsError);
  });
});

describe("url helpers", () => {
  it("strips a /v1 suffix for Ollama's native API", () => {
    expect(ollamaRoot("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
    expect(ollamaRoot("http://127.0.0.1:11434/")).toBe("http://127.0.0.1:11434");
    expect(ollamaRoot("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
  });

  it("never doubles /v1 on an openai-compatible base url", () => {
    expect(openAiCompatibleEmbeddingsUrl("http://127.0.0.1:1234")).toBe("http://127.0.0.1:1234/v1/embeddings");
    expect(openAiCompatibleEmbeddingsUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1/embeddings");
    expect(openAiCompatibleEmbeddingsUrl("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1/embeddings");
  });
});

describe("floatsToBase64", () => {
  it("emits little-endian float32, decodable back to the vector", () => {
    const vector = [0, 1, -1, 0.5];
    const b64 = floatsToBase64(vector);
    const buf = Buffer.from(b64, "base64");
    expect(buf.length).toBe(vector.length * 4);
    const out = [];
    for (let i = 0; i < vector.length; i++) out.push(buf.readFloatLE(i * 4));
    expect(out).toEqual(vector);
  });
});

describe("estimateEmbeddingPromptTokens", () => {
  it("uses the same ~4 chars/token ratio as the rest of the router", () => {
    expect(estimateEmbeddingPromptTokens(["abcd", "abcdefgh"])).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Provider calls (fetch stubbed)
// ───────────────────────────────────────────────────────────────────────────

describe("fetchOllamaEmbeddings", () => {
  it("translates /api/embed into the OpenAI list shape with the provider's own token count", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      model: "nomic-embed-text",
      embeddings: [[0.1, 0.2], [0.3, 0.4]],
      prompt_eval_count: 7,
    }));

    const { body, usageSource } = await fetchOllamaEmbeddings({
      baseUrl: OLLAMA_URL, model: "nomic-embed-text", inputs: ["hello world", "second"], fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${OLLAMA_URL}/api/embed`);
    expect(JSON.parse(init.body)).toEqual({ model: "nomic-embed-text", input: ["hello world", "second"] });

    expect(usageSource).toBe("provider");
    expect(body).toEqual({
      object: "list",
      data: [
        { object: "embedding", index: 0, embedding: [0.1, 0.2] },
        { object: "embedding", index: 1, embedding: [0.3, 0.4] },
      ],
      model: "nomic-embed-text",
      usage: { prompt_tokens: 7, total_tokens: 7 },
    });
  });

  it("honours encoding_format base64", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ model: "m", embeddings: [[1, 2]], prompt_eval_count: 2 }));
    const { body } = await fetchOllamaEmbeddings({
      baseUrl: OLLAMA_URL, model: "m", inputs: ["x"], encodingFormat: "base64", fetchImpl,
    });
    expect(typeof body.data[0].embedding).toBe("string");
    const buf = Buffer.from(body.data[0].embedding, "base64");
    expect([buf.readFloatLE(0), buf.readFloatLE(4)]).toEqual([1, 2]);
  });

  it("estimates usage when the provider omits prompt_eval_count", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ model: "m", embeddings: [[1]] }));
    const { body, usageSource } = await fetchOllamaEmbeddings({
      baseUrl: OLLAMA_URL, model: "m", inputs: ["abcdefgh"], fetchImpl,
    });
    expect(usageSource).toBe("estimated");
    expect(body.usage.prompt_tokens).toBe(2);
  });

  it("keeps a provider 404 as a 404 model_not_found", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "model 'nope' not found" }, 404));
    await expect(fetchOllamaEmbeddings({ baseUrl: OLLAMA_URL, model: "nope", inputs: ["x"], fetchImpl }))
      .rejects.toMatchObject({ status: 404, code: "model_not_found" });
  });

  it("turns a transport failure into a 502", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    await expect(fetchOllamaEmbeddings({ baseUrl: OLLAMA_URL, model: "m", inputs: ["x"], fetchImpl }))
      .rejects.toMatchObject({ status: 502 });
  });

  it("rejects a response with no vectors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ model: "m", embeddings: [] }));
    await expect(fetchOllamaEmbeddings({ baseUrl: OLLAMA_URL, model: "m", inputs: ["x"], fetchImpl }))
      .rejects.toMatchObject({ status: 502 });
  });
});

describe("fetchOpenAiCompatibleEmbeddings", () => {
  it("passes through and re-indexes the provider's list", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      object: "list",
      data: [{ object: "embedding", embedding: [0.5] }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 6, total_tokens: 6 },
    }));

    const { body, usageSource } = await fetchOpenAiCompatibleEmbeddings({
      baseUrl: "https://api.openai.com/v1", model: "text-embedding-3-small",
      inputs: ["hi"], apiKey: "sk-test", fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    // A single input is sent as a bare string, the way the OpenAI SDK does.
    expect(JSON.parse(init.body).input).toBe("hi");
    expect(usageSource).toBe("provider");
    expect(body.data[0].index).toBe(0);
    expect(body.usage).toEqual({ prompt_tokens: 6, total_tokens: 6 });
  });

  it("relays the provider's status on failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "bad key" } }, 401));
    await expect(fetchOpenAiCompatibleEmbeddings({
      baseUrl: "https://api.openai.com/v1", model: "m", inputs: ["x"], fetchImpl,
    })).rejects.toMatchObject({ status: 401 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The route itself
// ───────────────────────────────────────────────────────────────────────────

describe("POST /v1/embeddings", () => {
  beforeAll(async () => {
    await createProviderNode({
      type: "local",
      name: "Ollama (unit test)",
      baseUrl: OLLAMA_URL,
      apiType: "ollama",
    });
  });

  it("answers OPTIONS with CORS", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("REGRESSION (defect 8): the route exists and answers JSON, never HTML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      model: "nomic-embed-text", embeddings: [[0.1, 0.2, 0.3]], prompt_eval_count: 3,
    })));

    const res = await read(await POST(post({ model: "ollama/nomic-embed-text", input: "hello" })));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.json).not.toBeNull();
    expect(res.json.object).toBe("list");
    expect(res.json.data).toHaveLength(1);
    expect(res.json.data[0]).toMatchObject({ object: "embedding", index: 0 });
    expect(res.json.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    // The id the client sent round-trips, not the provider-local tag.
    expect(res.json.model).toBe("ollama/nomic-embed-text");
    expect(res.json.usage).toEqual({ prompt_tokens: 3, total_tokens: 3 });
    expect(res.headers.get("x-routed-provider")).toBe("ollama");
    expect(res.headers.get("x-routed-model")).toBe("nomic-embed-text");
    expect(res.headers.get("x-zmlr-usage")).toBe("provider");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("handles a batch of inputs and indexes them in order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      model: "nomic-embed-text", embeddings: [[1], [2], [3]], prompt_eval_count: 9,
    })));
    const res = await read(await POST(post({ model: "ollama/nomic-embed-text", input: ["a", "b", "c"] })));
    expect(res.status).toBe(200);
    expect(res.json.data.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(res.json.data.map((d) => d.embedding)).toEqual([[1], [2], [3]]);
  });

  it("calls Ollama's /api/embed on the registered node", async () => {
    const f = vi.fn(async () => jsonResponse({ model: "m", embeddings: [[1]], prompt_eval_count: 1 }));
    vi.stubGlobal("fetch", f);
    await POST(post({ model: "ollama/nomic-embed-text", input: "hello" }));
    expect(f.mock.calls[0][0]).toBe(`${OLLAMA_URL}/api/embed`);
  });

  it("returns a JSON 400 for a malformed body", async () => {
    const res = await read(await POST(post("{not json")));
    expect(res.status).toBe(400);
    expect(res.json?.error?.message).toBeTruthy();
    expect(res.json.error.type).toBe("invalid_request_error");
  });

  it("returns a JSON 400 when input is missing", async () => {
    const res = await read(await POST(post({ model: "ollama/nomic-embed-text" })));
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/input/i);
  });

  it("returns a JSON 400 for an unsupported encoding_format", async () => {
    const res = await read(await POST(post({ model: "ollama/nomic-embed-text", input: "x", encoding_format: "utf8" })));
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/encoding_format/);
  });

  it("returns a JSON 404 envelope (not HTML) for an unknown provider prefix", async () => {
    const res = await read(await POST(post({ model: "nope/whatever", input: "x" })));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.json.error.code).toBe("model_not_found");
    expect(res.json.error.type).toBe("invalid_request_error");
  });

  it("returns a JSON 404 envelope when the provider does not know the model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "model 'ghost' not found" }, 404)));
    const res = await read(await POST(post({ model: "ollama/ghost", input: "x" })));
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("model_not_found");
    expect(res.json.error.message).toMatch(/ghost/);
  });

  it("returns a JSON 400 when model is missing entirely", async () => {
    const res = await read(await POST(post({ input: "x" })));
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/model/i);
  });

  it("supports encoding_format base64 end to end", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      model: "nomic-embed-text", embeddings: [[1, 2]], prompt_eval_count: 1,
    })));
    const res = await read(await POST(post({
      model: "ollama/nomic-embed-text", input: "x", encoding_format: "base64",
    })));
    expect(res.status).toBe(200);
    expect(typeof res.json.data[0].embedding).toBe("string");
  });
});

describe("the /v1 catch-all", () => {
  it("answers an unrouted /v1 path with the OpenAI error envelope, not Next's HTML 404", async () => {
    const req = new Request("http://127.0.0.1/api/v1/completions", { method: "POST", body: "{}" });
    const res = await read(await CATCHALL_POST(req, { params: Promise.resolve({ path: ["completions"] }) }));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.json.error.code).toBe("unknown_endpoint");
    expect(res.json.error.type).toBe("invalid_request_error");
    expect(res.json.error.message).toMatch(/\/v1\/completions/);
  });

  it("does the same for GET, and sets CORS so a browser client can read it", async () => {
    const req = new Request("http://127.0.0.1/api/v1/nope");
    const res = await read(await CATCHALL_GET(req, { params: Promise.resolve({ path: ["nope"] }) }));
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.json.error.message).toMatch(/\/v1\/nope/);
  });
});
