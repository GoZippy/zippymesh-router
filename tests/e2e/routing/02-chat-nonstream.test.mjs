/**
 * POST /v1/chat/completions, stream:false — the shape an OpenAI SDK unpacks.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { api, ensureSetup, login } from "../_lib/client.mjs";
import { chat, CHAT_MODEL, CHAT_TAG, chatUntilCacheHit, CONTENT_BUDGET, FINISH_BUDGET, nonce, ollamaNodes, requireReady } from "./_fixtures.mjs";

let cookie;
let ready = false;

test("setup", async () => {
  await ensureSetup();
  cookie = await login();
  ready = (await ollamaNodes(cookie)).length > 0;
});

/**
 * Every assertion below needs a live local model.
 *
 * T1, fixed 2026-08-30: this used to `t.skip()`, and node:test reports a skip as
 * non-failing, so a fully-skipped file exited 0 and a total routing outage read
 * as a green run. `requireReady` asserts unless ZMLR_E2E_ALLOW_SKIP=1.
 */
function need(t) {
  return requireReady(t, ready);
}

test("a plain completion returns the full chat.completion envelope", async (t) => {
  if (!need(t)) return;
  const t0 = Date.now();
  const res = await chat({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} Reply with exactly one word: PONG` }],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  const ms = Date.now() - t0;
  t.diagnostic(`non-stream latency ${ms}ms`);
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.ok(ms < 60_000, `simple completion took ${ms}ms (budget 60s)`);

  const b = res.json;
  assert.equal(typeof b.id, "string");
  assert.equal(b.object, "chat.completion");
  assert.equal(typeof b.created, "number");
  assert.equal(typeof b.model, "string");

  assert.ok(Array.isArray(b.choices) && b.choices.length === 1, "expected exactly one choice");
  const c = b.choices[0];
  assert.equal(c.index, 0);
  assert.equal(c.message.role, "assistant");
  assert.equal(typeof c.message.content, "string");
  assert.ok(typeof c.finish_reason === "string" && c.finish_reason.length > 0);

  assert.equal(typeof b.usage.prompt_tokens, "number");
  assert.equal(typeof b.usage.completion_tokens, "number");
  assert.equal(typeof b.usage.total_tokens, "number");
});

test("`model` in the response is the provider-qualified id that was sent (fixed 2026-08-30)", async (t) => {
  if (!need(t)) return;
  const res = await chat({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} hi` }],
    max_tokens: 32,
    temperature: 0.7,
  });
  assert.equal(res.status, 200);
  // Was the provider-local tag (`qwen3.5:4b`), which 404'd when a client fed
  // response.model back into its next request. resolveClientFacingModelId()
  // in open-sse/handlers/chatCore.js now echoes the id the client sent.
  // Contract doc §4.
  assert.equal(res.json.model, CHAT_MODEL);
  assert.notEqual(res.json.model, CHAT_TAG);
  // The provider-local tag is still reported, separately, as a header.
  assert.equal(res.headers.get("x-routed-model"), CHAT_TAG);
  assert.equal(res.headers.get("x-zmlr-model"), CHAT_MODEL);
});

test("the routed provider and model are reported in response headers", async (t) => {
  if (!need(t)) return;
  const res = await chat({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} hi` }],
    max_tokens: 32,
    temperature: 0.7,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-routed-provider"), "ollama");
  assert.equal(res.headers.get("x-routed-model"), CHAT_TAG);
  assert.ok(res.headers.get("x-request-id"), "no X-Request-ID on a chat response");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("a client-supplied X-Request-Id is echoed back", async (t) => {
  if (!need(t)) return;
  const id = `acp-${nonce()}`;
  const res = await api("/v1/chat/completions", {
    method: "POST",
    headers: { "x-request-id": id },
    body: { model: CHAT_MODEL, messages: [{ role: "user", content: `${nonce()} hi` }], max_tokens: 16, temperature: 0.7 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-request-id"), id);
});

test("assistant content is non-empty when the model is given room to finish", async (t) => {
  if (!need(t)) return;
  // FINISH_BUDGET, not CONTENT_BUDGET: this is one of the three assertions that
  // needs the model to think AND answer inside the budget. See _fixtures.mjs.
  // The cache-busting nonce trails the instruction so a thinking model reads a
  // tag rather than a gibberish first token to reason about.
  const res = await chat({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `Reply with exactly one word: PONG (req ${nonce()})` }],
    max_tokens: FINISH_BUDGET,
    temperature: 0.7,
  });
  assert.equal(res.status, 200);
  const c = res.json.choices[0];
  assert.equal(c.finish_reason, "stop", `expected the model to finish; got ${c.finish_reason}`);
  assert.ok(c.message.content.trim().length > 0, "assistant content was empty on a completed turn");
});

test("system + user + assistant + user multi-turn is accepted and answered", async (t) => {
  if (!need(t)) return;
  const res = await chat({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: "You are a terse calculator. Answer with only a number." },
      { role: "user", content: `2+2 (req ${nonce()})` },
      { role: "assistant", content: "4" },
      { role: "user", content: "now add 10" },
    ],
    max_tokens: FINISH_BUDGET,
    temperature: 0.7,
  });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.choices[0].message.role, "assistant");
  assert.equal(res.json.choices[0].finish_reason, "stop");
  const answer = res.json.choices[0].message.content;
  assert.ok(answer.trim().length > 0, "multi-turn produced no assistant content");
  t.diagnostic(`multi-turn answer: ${JSON.stringify(answer).slice(0, 120)}`);
});

test("max_tokens is honoured: a tiny budget truncates with finish_reason=length", async (t) => {
  if (!need(t)) return;
  const res = await chat({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} Write a 500 word essay about rain.` }],
    max_tokens: 8,
    temperature: 0.7,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.choices[0].finish_reason, "length");
  assert.equal(res.json.usage.completion_tokens, 8);
});

test("usage is the provider's own numbers, not ZMLR's old +2000 pad (fixed 2026-08-30)", async (t) => {
  if (!need(t)) return;
  // open-sse/utils/usageTracking.js used to add a hardcoded BUFFER_TOKENS=2000
  // to prompt_tokens/total_tokens on the way out, so a two-word prompt reported
  // 2011 where Ollama said 11. The pad is now opt-in
  // (ZMLR_USAGE_BUFFER_TOKENS) and declared with x-zmlr-usage: padded.
  const res = await chat({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} hi` }],
    max_tokens: 8,
    temperature: 0.7,
  });
  assert.equal(res.status, 200);
  const u = res.json.usage;
  assert.ok(u.prompt_tokens > 0, `prompt_tokens=${u.prompt_tokens}`);
  assert.ok(u.prompt_tokens < 200, `prompt_tokens=${u.prompt_tokens} for a 2-word prompt — the +2000 pad is back`);
  assert.equal(u.total_tokens, u.prompt_tokens + u.completion_tokens);
  // Where the numbers came from, so nobody has to guess. Contract doc §4.
  assert.equal(res.headers.get("x-zmlr-usage"), "provider");
});

test("temperature is accepted and does not change the response shape", async (t) => {
  if (!need(t)) return;
  for (const temperature of [0, 1]) {
    const res = await chat({
      model: CHAT_MODEL,
      messages: [{ role: "user", content: `${nonce()} say ok` }],
      max_tokens: 32,
      temperature,
    });
    assert.equal(res.status, 200, `temperature=${temperature}: ${res.text.slice(0, 200)}`);
    assert.equal(res.json.object, "chat.completion");
  }
});

test("identical temperature-0 bodies are served from the prompt cache, with a FRESH id", async (t) => {
  if (!need(t)) return;
  // PROMPT_CACHE_ENABLED defaults on (src/lib/promptCache.js).
  const messages = [{ role: "user", content: `cache-${nonce()} reply with the number 7` }];
  const body = { model: CHAT_MODEL, messages, max_tokens: 64, temperature: 0 };
  const first = await chat(body);
  assert.equal(first.status, 200);
  // T7: the write into the cache is fire-and-forget after the response is sent,
  // so poll for it instead of guessing a sleep duration.
  const second = await chatUntilCacheHit(body);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-cache"), "HIT", "second identical request was not a cache hit");
  // Fixed 2026-08-30: an OpenAI `id` identifies a RESPONSE, not a prompt, and
  // replaying the stored one broke client-side dedupe and log correlation.
  // A hit is advertised by x-cache, never by a repeated id. Contract doc §8.
  assert.notEqual(second.json.id, first.json.id, "cache hit replayed the stored completion id");
  // Everything a client reads as the answer is byte-identical.
  assert.deepEqual(second.json.choices, first.json.choices);
});

test("the cache key covers response_format, so json mode is a MISS after a plain answer", async (t) => {
  if (!need(t)) return;
  const messages = [{ role: "user", content: `cachefmt-${nonce()} reply with the number 7` }];
  const body = { model: CHAT_MODEL, messages, max_tokens: 64, temperature: 0 };
  const plain = await chat(body);
  assert.equal(plain.status, 200);

  // T5, fixed 2026-08-30. This test used to be `assert.notEqual(x-cache,"HIT")`
  // and nothing else — and `headers.get()` returns null when the header is
  // absent, so it passed whenever the cache was disabled, broken, or simply
  // stopped emitting the header. It was the designated regression test for
  // cache-key defect 5, and it could not fail.
  //
  // The CONTROL proves the cache is alive on this very body first; only then is
  // "the json-mode variant misses" evidence of anything.
  const control = await chatUntilCacheHit(body);
  assert.equal(control.headers.get("x-cache"), "HIT",
    "the prompt cache is not serving hits at all — the MISS assertion below would be vacuous");

  const jsonMode = await chat({ ...body, response_format: { type: "json_object" } });
  assert.equal(jsonMode.status, 200);
  // Was defect 5: computePromptHash hashed only {model, messages, temperature,
  // max_tokens}, so a JSON-mode request was answered with the plain-prose
  // response that preceded it. It now hashes the whole body minus an explicit
  // ignore-list (src/lib/promptCache.js, key version v3). Contract doc §8.
  assert.notEqual(jsonMode.headers.get("x-cache"), "HIT", "response_format is invisible to the cache key again");
});

test("SECURITY: a cache entry is scoped to the caller who created it (H3)", async (t) => {
  if (!need(t)) return;
  // Added 2026-08-30 adversarial round. The key hashed the request body and
  // nothing else, so a prompt cached for one caller was replayed to any other
  // caller who sent the same body, and `x-cache: HIT` was a confirm-a-guess
  // oracle for "has anyone on this install run this exact prompt". Verified
  // live: a prompt sent with NO credentials came back `x-cache: HIT` to two
  // unrelated bearer identities. Contract doc §8.
  const messages = [{ role: "user", content: `tenant-${nonce()} reply with the number 7` }];
  const body = { model: CHAT_MODEL, messages, max_tokens: 64, temperature: 0 };
  const aHeaders = { Authorization: `Bearer tenant-A-${nonce()}` };
  const bHeaders = { Authorization: `Bearer tenant-B-${nonce()}` };

  assert.equal((await chat(body, { headers: aHeaders })).status, 200);
  // Control: A's own repeat DOES hit, so the cache is demonstrably working.
  const aAgain = await chatUntilCacheHit(body, { headers: aHeaders });
  assert.equal(aAgain.headers.get("x-cache"), "HIT", "the cache is not serving hits — this test would be vacuous");

  // The actual assertion: a different identity must not read A's entry.
  const b = await chat(body, { headers: bHeaders });
  assert.equal(b.status, 200);
  assert.notEqual(b.headers.get("x-cache"), "HIT", "another caller was served A's cached answer");
});
