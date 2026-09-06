/**
 * Tool calling and response_format — the two features an agent harness needs
 * most and the two most likely to differ per provider.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ensureSetup, login } from "../_lib/client.mjs";
import { chat, CHAT_MODEL, chatStream, chatUntilCacheHit, CONTENT_BUDGET, FINISH_BUDGET, nonce, ollamaNodes, requireReady } from "./_fixtures.mjs";

let cookie;
let ready = false;

const TOOLS = [{
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  },
}];

test("setup", async () => {
  await ensureSetup();
  cookie = await login();
  ready = (await ollamaNodes(cookie)).length > 0;
});

/**
 * T1, fixed 2026-08-30: was a `t.skip()`, which node:test reports as
 * non-failing — a fully-skipped file exited 0. Now an assertion unless
 * ZMLR_E2E_ALLOW_SKIP=1 is set on purpose.
 */
function need(t) {
  return requireReady(t, ready);
}

test("tools + tool_choice:auto produce an OpenAI tool_calls message", async (t) => {
  if (!need(t)) return;
  const res = await chat({
    model: CHAT_MODEL,
    tools: TOOLS,
    tool_choice: "auto",
    messages: [{ role: "user", content: `${nonce()} What is the weather in Paris? Use the tool.` }],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  const choice = res.json.choices[0];
  assert.equal(choice.finish_reason, "tool_calls", `model did not call the tool; finish_reason=${choice.finish_reason}`);

  const calls = choice.message.tool_calls;
  assert.ok(Array.isArray(calls) && calls.length >= 1, "no tool_calls on the message");
  const call = calls[0];
  assert.equal(typeof call.id, "string");
  assert.ok(call.id.length > 0);
  assert.equal(call.type, "function");
  assert.equal(call.function.name, "get_weather");
  assert.equal(typeof call.function.arguments, "string", "arguments must be a JSON *string*");
  const args = JSON.parse(call.function.arguments);
  assert.equal(typeof args.city, "string");
  t.diagnostic(`tool arguments: ${call.function.arguments}`);
});

test("a tool result can be fed back as role:tool and the turn completes", async (t) => {
  if (!need(t)) return;
  const first = await chat({
    model: CHAT_MODEL,
    tools: TOOLS,
    tool_choice: "auto",
    messages: [{ role: "user", content: `${nonce()} What is the weather in Paris? Use the tool.` }],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  assert.equal(first.status, 200);
  const call = first.json.choices[0].message.tool_calls?.[0];
  if (!call) return t.skip("model did not emit a tool call on this run");

  const second = await chat({
    model: CHAT_MODEL,
    tools: TOOLS,
    messages: [
      { role: "user", content: "What is the weather in Paris? Use the tool." },
      first.json.choices[0].message,
      { role: "tool", tool_call_id: call.id, content: JSON.stringify({ city: "Paris", tempC: 17, sky: "rain" }) },
    ],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  assert.equal(second.status, 200, second.text.slice(0, 300));
  assert.equal(second.json.object, "chat.completion");
  assert.equal(second.json.choices[0].message.role, "assistant");
});

test("streamed tool calls arrive as delta.tool_calls with finish_reason tool_calls", async (t) => {
  if (!need(t)) return;
  const s = await chatStream({
    model: CHAT_MODEL,
    tools: TOOLS,
    tool_choice: "auto",
    messages: [{ role: "user", content: `${nonce()} What is the weather in Paris? Use the tool.` }],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  assert.equal(s.status, 200, s.raw.slice(0, 300));
  assert.ok(s.sawDone, "tool-call stream did not end with [DONE]");
  const deltas = s.chunks.flatMap((c) => c?.choices?.[0]?.delta?.tool_calls || []);
  if (deltas.length === 0) return t.skip("model did not emit a tool call on this run");
  assert.equal(deltas[0].type, "function");
  assert.equal(deltas[0].function.name, "get_weather");
  assert.equal(typeof deltas[0].function.arguments, "string");
  assert.ok(s.finishReasons.includes("tool_calls"), `finish reasons were ${JSON.stringify(s.finishReasons)}`);
});

test("a tools request is never served from the prompt cache", async (t) => {
  if (!need(t)) return;
  // isCacheable() rejects bodies with tools (src/lib/promptCache.js).
  const messages = [{ role: "user", content: `toolcache-${nonce()} weather in Paris?` }];
  const body = { model: CHAT_MODEL, tools: TOOLS, messages, max_tokens: 512, temperature: 0 };
  const a = await chat(body);
  assert.equal(a.status, 200);

  // T5, fixed 2026-08-30: `assert.notEqual(headers.get("x-cache"), "HIT")` on its
  // own passes whenever the cache is off, broken, or has stopped emitting the
  // header — `headers.get()` returns null for an absent header. The control
  // below shows the cache IS serving hits for a tool-free body first, so the
  // assertion that a tools body does not hit means something.
  const control = { model: CHAT_MODEL, messages, max_tokens: 64, temperature: 0 };
  assert.equal((await chat(control)).status, 200);
  const controlHit = await chatUntilCacheHit(control);
  assert.equal(controlHit.headers.get("x-cache"), "HIT",
    "the prompt cache is not serving hits at all — the tools assertion below would be vacuous");

  const b = await chat(body);
  assert.equal(b.status, 200);
  assert.notEqual(b.headers.get("x-cache"), "HIT", "a tools request was replayed from the cache");
});

test("response_format json_object is forwarded to the provider and constrains the output", async (t) => {
  if (!need(t)) return;
  // T4, fixed 2026-08-30. This test was named "response_format json_object is
  // forwarded" but asserted only `status === 200`, `object === "chat.completion"`
  // and `typeof content === "string"`; the JSON.parse result went to
  // t.diagnostic and was never asserted. Deleting `response_format` on the way
  // to the provider left it green.
  //
  // Ollama's OpenAI-compat layer maps `response_format:{type:"json_object"}` to
  // its own `format: "json"`, which GRAMMAR-CONSTRAINS the output. So a
  // completed turn producing parseable JSON is direct evidence the field was
  // forwarded — and a completed turn producing prose is direct evidence it was
  // not. FINISH_BUDGET, because the assertion needs the model to finish.
  const res = await chat({
    model: CHAT_MODEL,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: `${nonce()} Return a JSON object with keys a=1 and b=2 and nothing else.` }],
    max_tokens: FINISH_BUDGET,
    temperature: 0.7,
  });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.object, "chat.completion");
  const choice = res.json.choices[0];
  const content = choice.message.content;
  assert.equal(typeof content, "string");
  assert.equal(choice.finish_reason, "stop", `the model did not finish; got ${choice.finish_reason}`);

  let parsed = null;
  let parseError = null;
  try { parsed = JSON.parse(content); } catch (e) { parseError = e.message; }
  t.diagnostic(`json_object: finish=${choice.finish_reason} head=${JSON.stringify(content).slice(0, 120)}`);
  assert.notEqual(parsed, null,
    `response_format:{type:"json_object"} produced unparseable content — the field is not reaching the provider (${parseError})`);
  assert.equal(typeof parsed, "object");
});

test("an unknown response_format type does not 500 the router", async (t) => {
  if (!need(t)) return;
  const res = await chat({
    model: CHAT_MODEL,
    response_format: { type: "not_a_real_format" },
    messages: [{ role: "user", content: `${nonce()} hi` }],
    max_tokens: 32,
    temperature: 0.7,
  });
  assert.ok(res.status < 500, `router returned ${res.status}: ${res.text.slice(0, 200)}`);
  t.diagnostic(`unknown response_format -> ${res.status}`);
});
