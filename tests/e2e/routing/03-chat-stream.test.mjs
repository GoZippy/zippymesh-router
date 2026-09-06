/**
 * POST /v1/chat/completions with stream:true — the SSE contract.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ensureSetup, login } from "../_lib/client.mjs";
import { CHAT_MODEL, CHAT_TAG, chatStream, CONTENT_BUDGET, FINISH_BUDGET, nonce, ollamaNodes, requireReady } from "./_fixtures.mjs";

let cookie;
let ready = false;

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

test("a stream is text/event-stream, parses as data: frames, and ends with [DONE]", async (t) => {
  if (!need(t)) return;
  const s = await chatStream({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} Reply with exactly one word: PONG` }],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  t.diagnostic(`stream: ttfb=${s.ttfbMs}ms ttfc=${s.ttfcMs}ms total=${s.totalMs}ms frames=${s.dataLines.length}`);

  assert.equal(s.status, 200, s.raw.slice(0, 300));
  assert.match(s.contentType, /^text\/event-stream/);
  assert.equal(s.headers.get("cache-control"), "no-cache");
  assert.equal(s.headers.get("x-routed-provider"), "ollama");
  assert.equal(s.headers.get("x-routed-model"), CHAT_TAG);

  assert.deepEqual(s.unparsable, [], "every non-[DONE] data: frame must be JSON");
  assert.ok(s.chunks.length > 0, "no chunks at all");
  assert.ok(s.sawDone, "stream did not end with data: [DONE]");
  assert.equal(s.dataLines[s.dataLines.length - 1], "[DONE]", "[DONE] was not the last frame");
});

test("every chunk is a chat.completion.chunk with the OpenAI delta shape", async (t) => {
  if (!need(t)) return;
  const s = await chatStream({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} Reply with exactly one word: PONG` }],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  assert.equal(s.status, 200);
  for (const c of s.chunks) {
    assert.equal(c.object, "chat.completion.chunk", `bad object: ${JSON.stringify(c).slice(0, 200)}`);
    assert.equal(typeof c.id, "string");
    assert.equal(typeof c.created, "number");
    assert.equal(typeof c.model, "string");
    assert.ok(Array.isArray(c.choices) && c.choices.length >= 1, `chunk without choices: ${JSON.stringify(c).slice(0, 200)}`);
    assert.equal(c.choices[0].index, 0);
    assert.equal(typeof c.choices[0].delta, "object");
  }
  // Same id across the whole stream, as an SDK expects.
  assert.equal(new Set(s.chunks.map((c) => c.id)).size, 1, "chunk ids were not stable across the stream");
});

test("deltas concatenate to non-empty assistant text and the stream terminates", async (t) => {
  if (!need(t)) return;
  // FINISH_BUDGET: the only streaming assertion that needs a COMPLETED turn.
  const s = await chatStream({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `Reply with exactly one word: PONG (req ${nonce()})` }],
    max_tokens: FINISH_BUDGET,
    temperature: 0.7,
  });
  assert.equal(s.status, 200);
  assert.ok(s.content.trim().length > 0, `concatenated deltas were empty; frames=${s.dataLines.length}`);
  assert.deepEqual(s.finishReasons, ["stop"], `expected exactly one finish_reason=stop, got ${JSON.stringify(s.finishReasons)}`);
});

test("time to first byte is well under the 60s budget", async (t) => {
  if (!need(t)) return;
  const s = await chatStream({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} say ok` }],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  assert.equal(s.status, 200);
  t.diagnostic(`ttfb=${s.ttfbMs}ms ttfc=${s.ttfcMs}ms total=${s.totalMs}ms`);
  assert.ok(s.ttfbMs !== null && s.ttfbMs < 30_000, `time to first SSE byte was ${s.ttfbMs}ms`);
  assert.ok(s.totalMs < 60_000, `stream took ${s.totalMs}ms`);
});

test("the final chunk carries usage, flagged estimated (ZMLR does not ask Ollama for it)", async (t) => {
  if (!need(t)) return;
  const s = await chatStream({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: `${nonce()} say ok` }],
    max_tokens: CONTENT_BUDGET,
    temperature: 0.7,
  });
  assert.equal(s.status, 200);
  const last = s.chunks[s.chunks.length - 1];
  assert.ok(last.usage, `last chunk has no usage: ${JSON.stringify(last).slice(0, 250)}`);
  assert.equal(typeof last.usage.prompt_tokens, "number");
  assert.equal(typeof last.usage.completion_tokens, "number");
  // open-sse/utils/stream.js injects estimateUsage() on the finish chunk because
  // ZMLR never sends stream_options:{include_usage:true} upstream.
  assert.equal(last.usage.estimated, true, "streaming usage stopped being estimated — update the contract doc");
});

test("stream:false is the default when `stream` is omitted", async (t) => {
  if (!need(t)) return;
  const base = (process.env.ZMLR_E2E_BASE_URL || "").replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: "user", content: `${nonce()} hi` }], max_tokens: 16, temperature: 0.7 }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  await res.arrayBuffer();
});
