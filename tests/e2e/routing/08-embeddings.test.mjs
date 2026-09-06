/**
 * POST /v1/embeddings against a real local Ollama.
 *
 * This route did not exist before 2026-08-30: `GET /v1/models` advertised
 * `ollama/nomic-embed-text` while a request to `/v1/embeddings` got Next's HTML
 * 404 page, so `client.embeddings.create()` failed at the parse step (defect 8,
 * docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §1).
 *
 * The file also pins the wider rule the fix depends on: every error the `/v1`
 * surface returns is the OpenAI JSON envelope, never HTML — including for a
 * path with no route at all.
 *
 * Skips cleanly when no Ollama node is registered, like the rest of the suite.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { api, ensureSetup, login } from "../_lib/client.mjs";
import { ALLOW_SKIP, EMBED_TAG, OLLAMA_URL, errorEnvelope, ollamaNodes, ollamaTags, requireReady } from "./_fixtures.mjs";

/** The id form ZMLR exposes for a local Ollama embedding model. */
const EMBED_MODEL = `ollama/${EMBED_TAG}`;

let cookie;
let ready = false;

/**
 * T1, fixed 2026-08-30: was a `t.skip()`, which node:test reports as
 * non-failing, so an outage read as a green run. Now an assertion unless
 * ZMLR_E2E_ALLOW_SKIP=1 is set on purpose.
 */
function need(t) {
  return requireReady(t, ready, `a registered local Ollama serving ${EMBED_TAG}`);
}

function embed(body, opts = {}) {
  return api("/v1/embeddings", { method: "POST", body, ...opts });
}

/** Shared shape check: OpenAI's {error:{message,type,code}} — and JSON, not HTML. */
function assertEnvelope(res, expectedStatus) {
  assert.equal(res.status, expectedStatus, res.text.slice(0, 300));
  assert.match(res.headers.get("content-type") || "", /application\/json/,
    `expected a JSON error envelope, got: ${res.text.slice(0, 200)}`);
  const err = errorEnvelope(res.json);
  assert.equal(typeof err.message, "string");
  assert.ok(err.message.length > 0);
  assert.equal(typeof err.type, "string");
  assert.equal(typeof err.code, "string");
  return err;
}

test("setup", async () => {
  await ensureSetup();
  cookie = await login();
  const nodes = await ollamaNodes(cookie);
  const tags = await ollamaTags();
  const hasEmbedModel = (tags || []).some((n) => n === EMBED_TAG || n.startsWith(`${EMBED_TAG}:`));
  ready = nodes.length > 0 && hasEmbedModel;
});

// T7 note: this is an ENVIRONMENT PRECONDITION, asserted against Ollama
// directly rather than through ZMLR. Named as one so it is not miscounted as a
// routing check.
test("precondition: the local Ollama has the embedding model this file needs", async (t) => {
  const tags = await ollamaTags();
  if (tags === null) {
    if (!ALLOW_SKIP) throw new Error(`no Ollama at ${OLLAMA_URL} (set ZMLR_E2E_ALLOW_SKIP=1 to skip instead)`);
    t.skip(`no Ollama at ${OLLAMA_URL}`);
    return;
  }
  assert.ok(
    tags.some((n) => n === EMBED_TAG || n.startsWith(`${EMBED_TAG}:`)),
    `Ollama has no ${EMBED_TAG}; pull it or set ZMLR_E2E_EMBED_MODEL. Tags: ${tags.join(", ")}`
  );
});

test("POST /v1/embeddings returns the OpenAI list envelope", async (t) => {
  if (!need(t)) return;
  const t0 = Date.now();
  const res = await embed({ model: EMBED_MODEL, input: "the quick brown fox" });
  t.diagnostic(`embeddings single input took ${Date.now() - t0}ms`);

  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  assert.equal(res.json.object, "list");
  assert.ok(Array.isArray(res.json.data));
  assert.equal(res.json.data.length, 1);

  const row = res.json.data[0];
  assert.equal(row.object, "embedding");
  assert.equal(row.index, 0);
  assert.ok(Array.isArray(row.embedding), "embedding is not an array");
  assert.ok(row.embedding.length > 0, "embedding vector is empty");
  assert.equal(typeof row.embedding[0], "number");
  t.diagnostic(`vector dimension: ${row.embedding.length}`);

  // The id the client sent round-trips — not the provider-local tag.
  assert.equal(res.json.model, EMBED_MODEL);

  assert.equal(typeof res.json.usage.prompt_tokens, "number");
  assert.equal(typeof res.json.usage.total_tokens, "number");
  assert.ok(res.json.usage.prompt_tokens > 0);
});

test("the routed provider and model are reported in response headers", async (t) => {
  if (!need(t)) return;
  const res = await embed({ model: EMBED_MODEL, input: "hello" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-routed-provider"), "ollama");
  assert.equal(res.headers.get("x-routed-model"), EMBED_TAG);
  // Where the token counts came from: the provider, not an estimate.
  assert.equal(res.headers.get("x-zmlr-usage"), "provider");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("an array input yields one vector per item, indexed in order", async (t) => {
  if (!need(t)) return;
  const res = await embed({ model: EMBED_MODEL, input: ["alpha", "beta", "gamma"] });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.data.length, 3);
  assert.deepEqual(res.json.data.map((d) => d.index), [0, 1, 2]);
  const dims = new Set(res.json.data.map((d) => d.embedding.length));
  assert.equal(dims.size, 1, "vectors have different dimensions");
});

test("encoding_format base64 returns a base64 string per vector", async (t) => {
  if (!need(t)) return;
  const float = await embed({ model: EMBED_MODEL, input: "same text" });
  const b64 = await embed({ model: EMBED_MODEL, input: "same text", encoding_format: "base64" });
  assert.equal(b64.status, 200, b64.text.slice(0, 300));
  const encoded = b64.json.data[0].embedding;
  assert.equal(typeof encoded, "string");
  const buf = Buffer.from(encoded, "base64");
  assert.equal(buf.length, float.json.data[0].embedding.length * 4,
    "base64 payload is not 4 bytes per float32");
  // First component matches the float encoding (little-endian float32).
  assert.ok(Math.abs(buf.readFloatLE(0) - float.json.data[0].embedding[0]) < 1e-6);
});

test("an unqualified model id is resolved against the registered local runtimes", async (t) => {
  if (!need(t)) return;
  const res = await embed({ model: EMBED_TAG, input: "bare tag" });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.data.length, 1);
  assert.equal(res.json.model, EMBED_TAG);
});

test("an unknown model -> JSON 404 model_not_found, never Next's HTML 404", async () => {
  const res = await embed({ model: "ollama/does-not-exist-embed:0b", input: "x" });
  const err = assertEnvelope(res, 404);
  assert.equal(err.code, "model_not_found");
});

test("an unknown provider prefix -> JSON 404, not a 500", async () => {
  const res = await embed({ model: "nosuchprovider/whatever", input: "x" });
  const err = assertEnvelope(res, 404);
  assert.equal(err.code, "model_not_found");
});

test("a missing input -> JSON 400", async () => {
  const res = await embed({ model: EMBED_MODEL });
  const err = assertEnvelope(res, 400);
  assert.match(err.message, /input/i);
});

test("a missing model -> JSON 400", async () => {
  const res = await embed({ input: "x" });
  const err = assertEnvelope(res, 400);
  assert.match(err.message, /model/i);
});

test("a malformed JSON body -> JSON 400", async () => {
  const res = await api("/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assertEnvelope(res, 400);
});

test("OPTIONS preflight is allowed on /v1/embeddings", async () => {
  const res = await api("/v1/embeddings", { method: "OPTIONS" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods") || "", /POST/);
});

test("both /v1/embeddings and /api/v1/embeddings reach the same route", async (t) => {
  if (!need(t)) return;
  const res = await api("/api/v1/embeddings", {
    method: "POST",
    body: { model: EMBED_MODEL, input: "rewrite check" },
  });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.object, "list");
});

test("an unrouted /v1 path answers with the JSON error envelope, not HTML", async () => {
  const res = await api("/v1/completions", { method: "POST", body: { model: "x", prompt: "y" } });
  const err = assertEnvelope(res, 404);
  assert.equal(err.code, "unknown_endpoint");
  assert.match(err.message, /\/v1\/completions/);
});
