/**
 * ZMLR's routing extensions: the `auto` model, the zippymesh/* playbooks, and
 * the X-* routing headers.
 *
 * `auto` and the playbook ids 404'd on dev-beta until 2026-08-30 (two
 * independent defects: null constraints crashing the recommender, and
 * `new Request(nextRequest, init)` throwing so the rewritten model never
 * reached the provider). They now serve a real completion; the assertions below
 * pin that. See docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §6.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { api, ensureSetup, login } from "../_lib/client.mjs";
import { AUTO_BUDGET, chat, CHAT_MODEL, CHAT_TAG, CONTENT_BUDGET, errorEnvelope, nonce, ollamaNodes, requireReady } from "./_fixtures.mjs";

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

test("X-Intent: code does not break an explicitly-modelled request", async (t) => {
  if (!need(t)) return;
  const res = await chat(
    { model: CHAT_MODEL, messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: 64, temperature: 0.7 },
    { headers: { "X-Intent": "code" } },
  );
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.object, "chat.completion");
  assert.equal(res.headers.get("x-routed-model"), CHAT_TAG);
});

test("X-Intent: chat does not break an explicitly-modelled request", async (t) => {
  if (!need(t)) return;
  const res = await chat(
    { model: CHAT_MODEL, messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: 64, temperature: 0.7 },
    { headers: { "X-Intent": "chat" } },
  );
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.object, "chat.completion");
});

test("the constraint headers are accepted and do not break an explicit model", async (t) => {
  if (!need(t)) return;
  const res = await chat(
    { model: CHAT_MODEL, messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: 64, temperature: 0.7 },
    { headers: { "X-Prefer-Local": "true", "X-Max-Latency-Ms": "60000", "X-Min-Context-Window": "4096" } },
  );
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.headers.get("x-routed-provider"), "ollama");
});

test("model:\"auto\" serves a real completion with NO routing header at all (fixed 2026-08-30)", async (t) => {
  if (!need(t)) return;
  // The bare case: no X-* header, which is exactly what used to crash the
  // recommender (constraints was null) and send the literal "auto" upstream.
  const t0 = Date.now();
  const res = await chat({
    model: "auto",
    // AUTO_BUDGET, not CONTENT_BUDGET: `auto` may pick a thinking model and
    // this test is about the headers, not the text. See _fixtures.mjs.
    messages: [{ role: "user", content: `${nonce()} say ok` }],
    max_tokens: AUTO_BUDGET,
    temperature: 0.7,
  });
  const ms = Date.now() - t0;
  assert.equal(res.status, 200, res.text.slice(0, 400));
  assert.equal(res.json.object, "chat.completion");
  assert.equal(res.json.choices[0].message.role, "assistant");

  // x-selected-model is the router's pick, provider-QUALIFIED...
  const selected = res.headers.get("x-selected-model");
  assert.ok(selected, "no x-selected-model header on the success path");
  // T7, tightened 2026-08-30: this asserted `/^ollama\//` while _fixtures.mjs
  // states that WHICH model `auto` picks is explicitly not part of the contract.
  // The contract-true statement is that the pick must be a model this install
  // can actually serve — so check it against GET /v1/models, which §9 names as
  // the source of routable ids.
  const servable = await api("/v1/models");
  assert.equal(servable.status, 200);
  const ids = (servable.json?.data || []).map((m) => m.id);
  assert.ok(ids.includes(selected), `auto picked ${selected}, which GET /v1/models does not advertise`);
  // ...and x-routed-model is what actually served it, provider-LOCAL (no slash
  // prefix), so the two together name the model unambiguously.
  const routed = res.headers.get("x-routed-model");
  assert.equal(res.headers.get("x-routed-provider"), "ollama");
  assert.ok(routed, "no x-routed-model header");
  assert.ok(selected.endsWith(`/${routed}`), `x-selected-model ${selected} does not name x-routed-model ${routed}`);
  t.diagnostic(`auto -> selected=${selected} routed=${routed} in ${ms}ms`);
});

test("AUTO: a plain text prompt gets a NON-EMPTY content, on a small budget", async (t) => {
  if (!need(t)) return;
  // Added 2026-08-30 adversarial round (finding H6). `{"model":"auto"}` on
  // "Say OK" answered 200 with `content: ""`: the recommender awarded +5 for
  // vision capability on a text-only prompt (`x-routing-reason: Has vision
  // capability (+5)`, `x-routing-score: 56`) and so picked the box's slowest
  // model — a THINKING model, whose text lands in the non-standard
  // `message.reasoning` while `message.content` stays "". Every OpenAI SDK reads
  // `choices[0].message.content`.
  //
  // Two independent repairs have to hold for this to pass: the vision bonus is
  // now gated on the request actually carrying an image, and a thinking model is
  // deprioritised for a plain intent (src/lib/discovery/recommendationService.js).
  // If both somehow fail, the route folds the truncated reasoning into `content`
  // and says so with `x-zmlr-content-source: reasoning` — so an empty `content`
  // here means the whole AUTO fix is gone.
  const t0 = Date.now();
  const res = await chat({
    model: "auto",
    messages: [{ role: "user", content: `Say OK (${nonce()})` }],
    max_tokens: AUTO_BUDGET,
    temperature: 0.7,
  });
  assert.equal(res.status, 200, res.text.slice(0, 400));
  const choice = res.json.choices[0];
  t.diagnostic(
    `auto: selected=${res.headers.get("x-selected-model")} reason=${res.headers.get("x-routing-reason")} ` +
    `finish=${choice.finish_reason} source=${res.headers.get("x-zmlr-content-source") || "content"} in ${Date.now() - t0}ms`
  );
  assert.equal(typeof choice.message.content, "string");
  assert.ok(choice.message.content.trim().length > 0,
    `model:"auto" returned empty content on a ${AUTO_BUDGET}-token budget (H6 is back). ` +
    `selected=${res.headers.get("x-selected-model")} reason=${res.headers.get("x-routing-reason")}`);
});

test("AUTO: the vision bonus is not awarded to a text-only prompt", async (t) => {
  if (!need(t)) return;
  // The reason string the review captured on the wire. Its absence is the
  // cheapest direct evidence the scoring change is live.
  const res = await chat(
    { model: "auto", messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: AUTO_BUDGET, temperature: 0.7 },
    { headers: { "X-Prefer-Local": "true" } },
  );
  assert.equal(res.status, 200, res.text.slice(0, 400));
  const reason = res.headers.get("x-routing-reason") || "";
  assert.doesNotMatch(reason, /Has vision capability/i,
    `a text-only prompt was routed on a vision bonus: ${reason}`);
});

test("a playbook model id serves a real completion too", async (t) => {
  if (!need(t)) return;
  // Playbooks resolve to modelStr "auto" (src/sse/handlers/chat.js), which the
  // orchestrator now turns into a model the registered runtime actually serves.
  const res = await chat({
    model: "local/privacy-strict",
    messages: [{ role: "user", content: `${nonce()} say ok` }],
    max_tokens: AUTO_BUDGET,
    temperature: 0.7,
  });
  assert.equal(res.status, 200, res.text.slice(0, 400));
  assert.equal(res.json.object, "chat.completion");
  assert.equal(res.headers.get("x-routed-provider"), "ollama");
  assert.ok(res.headers.get("x-routed-model"), "no x-routed-model header on the playbook path");
});

test("smart routing reports its pick in x-selected-model", async (t) => {
  if (!need(t)) return;
  const res = await chat(
    { model: "auto", messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: AUTO_BUDGET, temperature: 0.7 },
    { headers: { "X-Prefer-Local": "true" } },
  );
  assert.equal(res.status, 200, res.text.slice(0, 400));
  const selected = res.headers.get("x-selected-model");
  assert.ok(selected, "no x-selected-model header — smart routing did not run at all");
  assert.match(selected, /\//, `x-selected-model should be provider-qualified, got ${selected}`);
  assert.ok(res.headers.get("x-routing-intent"), "no x-routing-intent header");
  // The provider-local half of the pair, on the same success response.
  const routed = res.headers.get("x-routed-model");
  assert.ok(routed, "no x-routed-model header");
  assert.ok(!routed.includes("/"), `x-routed-model must be the provider-LOCAL id, got ${routed}`);
  t.diagnostic(`auto + X-Prefer-Local selected ${selected} routed ${routed} (intent ${res.headers.get("x-routing-intent")}), response ${res.status}`);
});

test("X-Intent steers the smart-router selection", async (t) => {
  if (!need(t)) return;
  const code = await chat(
    { model: "auto", messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: AUTO_BUDGET, temperature: 0.7 },
    { headers: { "X-Prefer-Local": "true", "X-Intent": "code" } },
  );
  assert.equal(code.status, 200, code.text.slice(0, 400));
  assert.equal(code.headers.get("x-routing-intent"), "code");
  t.diagnostic(`X-Intent:code selected ${code.headers.get("x-selected-model")}`);
});

test("the BARE provider-local tag resolves when one provider serves it", async (t) => {
  if (!need(t)) return;
  // A client that feeds `response.model` back used to get a 404, because the
  // response carried the provider-local tag (`qwen3.5:4b`) and only the
  // qualified id (`ollama/qwen3.5:4b`) resolved. Both halves are now fixed:
  // the response echoes the qualified id, AND the bare tag resolves whenever
  // exactly one registered provider serves it.
  const res = await chat({
    model: CHAT_TAG, messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: CONTENT_BUDGET, temperature: 0.7,
  });
  assert.equal(res.status, 200, `bare tag ${CHAT_TAG} gave ${res.status}: ${res.text.slice(0, 300)}`);
  assert.equal(res.json.object, "chat.completion");
  assert.equal(res.headers.get("x-routed-provider"), "ollama");
  assert.equal(res.headers.get("x-routed-model"), CHAT_TAG);
  t.diagnostic(`bare "${CHAT_TAG}" -> ${res.headers.get("x-routed-model")}, response.model=${JSON.stringify(res.json.model)}`);
});

test("whatever the response reports as `model` can be sent straight back", async (t) => {
  if (!need(t)) return;
  const first = await chat({
    model: CHAT_MODEL, messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: CONTENT_BUDGET, temperature: 0.7,
  });
  assert.equal(first.status, 200, first.text.slice(0, 300));
  const echoed = first.json.model;
  assert.equal(typeof echoed, "string");

  const second = await chat({
    model: echoed, messages: [{ role: "user", content: `${nonce()} say ok` }], max_tokens: CONTENT_BUDGET, temperature: 0.7,
  });
  assert.equal(second.status, 200, `round-tripping response.model=${echoed} gave ${second.status}: ${second.text.slice(0, 300)}`);
  assert.equal(second.headers.get("x-routed-provider"), "ollama");
  t.diagnostic(`response.model=${JSON.stringify(echoed)} round-tripped to ${second.headers.get("x-routed-model")}`);
});

test("bare-tag resolution never invents a model that nobody serves", async (t) => {
  if (!need(t)) return;
  const missing = await chat({ model: "does-not-exist:0b", messages: [{ role: "user", content: "hi" }] });
  assert.equal(missing.status, 404);
  assert.equal(errorEnvelope(missing.json).code, "model_not_found");
});

test("GET /v1 returns a hardcoded 4-model list, not the real catalogue", async () => {
  const res = await api("/v1");
  assert.equal(res.status, 200);
  assert.equal(res.json?.object, "list");
  const ids = (res.json.data || []).map((m) => m.id);
  // Deviation worth knowing about: a client that probes the base path gets a
  // static list of cloud models that this install may not have at all.
  assert.ok(!ids.includes(CHAT_MODEL), `GET /v1 unexpectedly lists ${CHAT_MODEL}`);
  assert.ok(ids.length > 0);
});
