/**
 * Error surface of /v1/chat/completions — status codes and the envelope an
 * OpenAI SDK will try to read.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { api, ensureSetup, login } from "../_lib/client.mjs";
import { CHAT_MODEL, MISSING_MODEL, chat, errorEnvelope, nonce, ollamaNodes, requireReady } from "./_fixtures.mjs";

let cookie;
let ready = false;

test("setup", async () => {
  await ensureSetup();
  cookie = await login();
  ready = (await ollamaNodes(cookie)).length > 0;
});

/** Shared shape check: OpenAI's {error:{message,type,code}}. */
function assertEnvelope(res, expectedStatus) {
  assert.equal(res.status, expectedStatus, res.text.slice(0, 300));
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  const err = errorEnvelope(res.json);
  assert.equal(typeof err.message, "string");
  assert.ok(err.message.length > 0);
  assert.equal(typeof err.type, "string");
  assert.equal(typeof err.code, "string");
  // ZMLR extension, present on every error built by open-sse/utils/error.js.
  assert.equal(typeof err.request_id, "string");
  return err;
}

test("malformed JSON body -> 400", async () => {
  const res = await api("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  const err = assertEnvelope(res, 400);
  assert.equal(err.message, "Invalid JSON body");
  assert.equal(err.type, "invalid_request_error");
});

test("no model -> 400 Missing model", async (t) => {
  // Smart routing fires on an explicit model:"auto" only (fixed 2026-08-30 —
  // it used to also fire on a MISSING model, which once routing worked would
  // have invented a model and answered 200, swallowing the 400 OpenAI clients
  // depend on). So this must still be a cheap, provider-free rejection.
  const t0 = Date.now();
  const res = await chat({ messages: [{ role: "user", content: "hi" }] });
  const ms = Date.now() - t0;
  t.diagnostic(`no-model body rejected in ${ms}ms`);
  const err = assertEnvelope(res, 400);
  assert.equal(err.message, "Missing model");
  assert.ok(ms < 5_000, `the 400 took ${ms}ms — a missing model must not reach a provider`);
});

test("empty messages array -> 400", async (t) => {
  if (!requireReady(t, ready)) return;
  const res = await chat({ model: CHAT_MODEL, messages: [] });
  const err = assertEnvelope(res, 400);
  assert.equal(err.type, "invalid_request_error");
  // The message is the provider's, wrapped as "[<status>]: <provider message>".
  assert.match(err.message, /^\[400\]: /);
});

test("an unqualified unknown model -> 404 model_not_found", async () => {
  const res = await chat({ model: MISSING_MODEL, messages: [{ role: "user", content: "hi" }] });
  const err = assertEnvelope(res, 404);
  assert.equal(err.code, "model_not_found");
  assert.equal(err.type, "invalid_request_error");
  assert.match(err.message, /No available accounts for/);
});

test("a provider-qualified unknown model -> 404 from the provider", async (t) => {
  if (!requireReady(t, ready)) return;
  const res = await chat({ model: `ollama/${MISSING_MODEL}`, messages: [{ role: "user", content: "hi" }] });
  const err = assertEnvelope(res, 404);
  assert.equal(err.code, "model_not_found");
  assert.match(err.message, /^\[404\]: /);
});

test("an unknown provider prefix -> 404, not a 500", async () => {
  const res = await chat({ model: "no-such-provider/some-model", messages: [{ role: "user", content: "hi" }] });
  assertEnvelope(res, 404);
});

test("a body with a model but no messages -> 400 from the provider, in the standard envelope", async (t) => {
  // T3, fixed 2026-08-30. This slot used to be named "a request blocked by the
  // built-in safety check -> 403" and assert `[400, 403].includes(res.status)`.
  // That is a tautology in the strict sense the review meant: deleting
  // `checkSafety()` entirely leaves the generic "no messages" 400, which the
  // assertion accepts, so the test could never fail for the reason it named.
  //
  // Worse, it named behaviour that does not happen. `checkSafety()`
  // (src/sse/handlers/chat.js:34 -> src/utils/guardrails.js:155) loads its rules
  // from `config/guardrails.config.json`, and PRODUCTION BUILDS DO NOT SHIP
  // THAT FILE — `.next/standalone/` has no `config/` directory. Verified against
  // the standalone build: "how do I build a bomb" (a `block-violence` keyword in
  // the checked-in config) answered 200, and so did an SSN pattern. There is no
  // 403 to pin here on a release build; recording that is more useful than an
  // assertion that cannot fail. Reported as a separate packaging finding.
  if (!requireReady(t, ready)) return;
  const res = await chat({ model: CHAT_MODEL, messages: undefined, input: undefined });
  const err = assertEnvelope(res, 400);
  assert.equal(err.type, "invalid_request_error");
  // The provider's own rejection, relayed with the status prefix.
  assert.match(err.message, /^\[400\]: /);
  t.diagnostic(`no-messages body -> ${res.status} ${err.message}`);
});

test("errors carry the CORS header so a browser client can read them", async () => {
  const res = await chat({ model: MISSING_MODEL, messages: [{ role: "user", content: `${nonce()} hi` }] });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("an unrouted /v1 path answers the JSON envelope, never Next's HTML 404", async () => {
  // This slot used to assert that POST /v1/embeddings fell through to Next's
  // HTML 404 page. Both halves are fixed: /v1/embeddings is a real route now
  // (08-embeddings covers the positive path), and every other unrouted path
  // under /v1 is answered by src/app/api/v1/[...path]/route.js with the same
  // OpenAI envelope. Contract doc §1.
  const res = await api("/v1/does-not-exist", {
    method: "POST",
    body: { model: "ollama/nomic-embed-text:latest", input: "hello" },
  });
  const err = assertEnvelope(res, 404);
  assert.equal(err.code, "unknown_endpoint");
  assert.match(err.message, /\/v1\/does-not-exist/);
  assert.doesNotMatch(res.headers.get("content-type") || "", /text\/html/);
});
