/**
 * Registering the local Ollama runtime, and what GET /v1/models then reports.
 *
 * This file runs FIRST (alphabetical) and is the one that registers the node;
 * the later files reuse it from the server's throwaway DATA_DIR.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { api, ensureSetup, login } from "../_lib/client.mjs";
import {
  CHAT_MODEL, CHAT_TAG, OLLAMA_URL, ensureOllamaRegistered, registerOllamaNode, ollamaTags, ollamaNodes, errorEnvelope, nonce, requireReady,
} from "./_fixtures.mjs";

let cookie;
let registration;
/** Fetched once and shared across the assertions in this file. */
let modelsRes;
let modelsMs = 0;
async function models() {
  if (!modelsRes) {
    const t0 = Date.now();
    modelsRes = await api("/v1/models");
    modelsMs = Date.now() - t0;
  }
  return modelsRes;
}
// (It used to be 7-28s per call, which is why it is fetched once and shared.
// It is now tens of milliseconds — see the timing test at the bottom.)

test("setup + login", async () => {
  await ensureSetup();
  cookie = await login();
  assert.match(cookie, /^auth_token=/);
});

// T7: named a PRECONDITION because it asserts against Ollama directly and never
// touches ZMLR — an environment check, not a routing check.
test("precondition: the local Ollama we are testing against is up and has the chat model", async () => {
  const tags = await ollamaTags();
  assert.notEqual(tags, null, `no Ollama reachable at ${OLLAMA_URL}`);
  assert.ok(tags.includes(CHAT_TAG), `Ollama has no ${CHAT_TAG}; got ${tags.slice(0, 10).join(", ")}`);
});

test("SECURITY: POST /api/provider-nodes requires a session (C1a)", async (t) => {
  // Added 2026-08-30 adversarial round. The route had NO route-level guard —
  // no requireAuth, no checkAuth, no requireApiKey — while driving arbitrary
  // outbound fetch() and minting routing targets. src/middleware.js:120-129
  // says in as many words that its edge check is authenticity-only and that
  // "Sensitive management routes MUST add their own route-level guard".
  const res = await api("/api/provider-nodes", {
    method: "POST",
    body: { type: "local", apiType: "ollama", baseUrl: OLLAMA_URL },
  });
  assert.equal(res.status, 401, `unauthenticated registration returned ${res.status}: ${res.text.slice(0, 200)}`);

  // The CSRF-shaped drive-by the review used: a CORS *simple* request, so no
  // preflight, from any page the operator has open.
  const base = (process.env.ZMLR_E2E_BASE_URL || "").replace(/\/+$/, "");
  const drive = await fetch(`${base}/api/provider-nodes`, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", Origin: "https://evil.example.com" },
    body: JSON.stringify({ type: "local", apiType: "ollama", baseUrl: OLLAMA_URL }),
  });
  assert.equal(drive.status, 401, "the no-preflight drive-by was accepted");
  t.diagnostic(`unauthenticated POST -> 401; drive-by POST -> ${drive.status}`);

  // GET too: the node list carries every registered runtime's baseUrl.
  assert.equal((await api("/api/provider-nodes")).status, 401);

  // This 401 is also the H2 mechanism: `PATCH /api/settings {newPassword}` sets
  // the password and issues NO cookie, so the setup wizard used to advance to
  // step 1 with an empty cookie jar and the "Add a local runtime" card hit
  // exactly this. Fixed in the wizard — step 0 now completes a real login —
  // rather than by exempting this route, which is the last route that should
  // grow a first-run bypass. See tests/unit/wizardLogin.test.js.
});

test("SECURITY: a non-local baseUrl is refused, not probed (C1b / H1)", async (t) => {
  // `type:"local"` was a naming convention, not a constraint: no allow-list, no
  // deny-list, no IP-literal check, no link-local filter. Verified live, the
  // three failure strings this route used to echo — `fetch failed`,
  // `timed out after 5000ms`, `HTTP <status>` — were a precise port scanner and
  // firewall mapper for any host the ZMLR process could reach.
  for (const [label, baseUrl] of [
    ["a public IP", "http://93.184.216.34:80"],
    ["a public hostname", "https://api.openai.com"],
    ["the cloud metadata service", "http://169.254.169.254/latest/meta-data"],
  ]) {
    const t0 = Date.now();
    const res = await api("/api/provider-nodes", {
      method: "POST", cookie,
      body: { type: "local", apiType: "ollama", baseUrl },
    });
    const ms = Date.now() - t0;
    assert.equal(res.status, 403, `${label} (${baseUrl}) -> ${res.status}: ${res.text.slice(0, 200)}`);
    // Refused BEFORE the probe, so it must not have spent the 5 s timeout.
    assert.ok(ms < 4_000, `${label} took ${ms}ms — it looks like the probe still ran`);
    t.diagnostic(`${label} -> 403 in ${ms}ms: ${errorEnvelope(res.json).message.slice(0, 120)}`);
  }
});

test("SECURITY: a failed probe reports a class, never the upstream status or transport text (H1)", async (t) => {
  const res = await api("/api/provider-nodes", {
    method: "POST", cookie,
    body: { type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:20399" },
  });
  assert.equal(res.status, 502, res.text.slice(0, 200));
  const msg = errorEnvelope(res.json).message;
  t.diagnostic(`closed loopback port -> ${msg}`);
  assert.match(msg, /No Ollama runtime responded at http:\/\/127\.0\.0\.1:20399\/api\/tags/);
  assert.match(msg, /\(unreachable\)/);
  // The strings that made this an oracle.
  assert.doesNotMatch(msg, /fetch failed|ECONNREFUSED|timed out after \d+ms|HTTP \d{3}/);
});

test("POST /api/provider-nodes registers a local runtime in one call (fixed 2026-08-30)", async (t) => {
  // Was: 400 "Invalid provider node type", and the only working path was the
  // 240 s POST /api/discovery subnet sweep.
  // src/app/api/provider-nodes/route.js
  const t0 = Date.now();
  const res = await registerOllamaNode(cookie, { name: "Ollama" });
  const ms = Date.now() - t0;
  t.diagnostic(`POST /api/provider-nodes {type:"local"} -> ${res.status} in ${ms}ms`);

  assert.ok([200, 201].includes(res.status), `expected 200/201, got ${res.status}: ${res.text.slice(0, 300)}`);
  assert.ok(ms < 15_000, `the fast path took ${ms}ms — it probes ONE url with a 5s timeout`);

  const node = res.json?.node;
  assert.ok(node, `no node in the response: ${res.text.slice(0, 300)}`);
  assert.equal(node.type, "local");
  assert.equal(node.apiType, "ollama");
  assert.equal(node.baseUrl, OLLAMA_URL);
  // The served model list comes back with it, already in the id form clients send.
  assert.ok(Array.isArray(res.json.models), "no models array");
  assert.ok(res.json.models.includes(CHAT_TAG), `models did not include ${CHAT_TAG}: ${JSON.stringify(res.json.models).slice(0, 200)}`);
  assert.ok(res.json.modelIds.includes(CHAT_MODEL), `modelIds did not include ${CHAT_MODEL}`);
});

test("registering the same runtime under another loopback spelling dedupes", async (t) => {
  const before = (await ollamaNodes(cookie)).length;
  if (before === 0) return t.skip("ollama not registered");
  // 127.0.0.1 == localhost == ::1 — one runtime, one node.
  const alt = OLLAMA_URL.replace("127.0.0.1", "localhost");
  const res = await registerOllamaNode(cookie, { baseUrl: alt });
  assert.equal(res.status, 200, `expected a dedupe 200, got ${res.status}: ${res.text.slice(0, 200)}`);
  assert.equal(res.json?.created, false);
  assert.equal(res.json?.deduped, true);
  assert.equal((await ollamaNodes(cookie)).length, before, "the alternate spelling created a second node");
});

test("an unreachable local runtime is refused, not registered", async () => {
  const res = await api("/api/provider-nodes", {
    method: "POST",
    cookie,
    body: { type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:9" },
  });
  assert.equal(res.status, 502, `expected 502, got ${res.status}: ${res.text.slice(0, 200)}`);
  assert.match(errorEnvelope(res.json).message, /No Ollama runtime responded/);
});

test("the local Ollama node is registered and routable", async (t) => {
  registration = await ensureOllamaRegistered(cookie);
  if (registration.nodes.length === 0) {
    t.diagnostic(`ollama not registered: ${registration.reason}`);
    t.skip(`ollama not registered: ${registration.reason}`);
    return;
  }
  t.diagnostic(`registration: method=${registration.method} scanned=${registration.scanned} ms=${registration.ms} nodes=${registration.nodes.length}`);
  const local = registration.nodes.find((n) => n.baseUrl === OLLAMA_URL);
  assert.ok(local, `no node with baseUrl ${OLLAMA_URL}; got ${registration.nodes.map((n) => n.baseUrl).join(", ")}`);
  assert.equal(local.type, "local");
  assert.equal(local.apiType, "ollama");
  assert.equal(registration.nodes.length, 1, `one Ollama, one node — got ${registration.nodes.length}`);
});

test("the registered node produced an active provider connection", async (t) => {
  if (!registration?.nodes.length) return t.skip("ollama not registered");
  const res = await api("/api/providers", { cookie });
  assert.equal(res.status, 200);
  const conns = res.json?.connections || [];
  const ollama = conns.filter((c) => c.provider === "ollama");
  assert.ok(ollama.length > 0, `no provider connection with provider="ollama": ${JSON.stringify(conns).slice(0, 300)}`);
  assert.ok(ollama.some((c) => c.isActive !== false), "no active ollama connection");
});

test("GET /v1/models is an OpenAI list and needs no auth", async (t) => {
  const res = await models();
  t.diagnostic(`GET /v1/models took ${modelsMs}ms and returned ${res.json?.data?.length} models`);
  assert.equal(res.status, 200);
  assert.equal(res.json?.object, "list");
  assert.ok(Array.isArray(res.json.data), "data is not an array");
  assert.ok(res.json.data.length > 0, "data is empty");
  for (const m of res.json.data.slice(0, 50)) {
    assert.equal(typeof m.id, "string", `model without a string id: ${JSON.stringify(m)}`);
    assert.equal(m.object, "model", `model ${m.id} has object=${m.object}`);
  }
});

test("GET /v1/models exposes the Ollama model as `ollama/<tag>` — the id clients must send", async (t) => {
  if (!registration?.nodes.length) return t.skip("ollama not registered");
  const res = await models();
  assert.equal(res.status, 200);
  const ids = res.json.data.map((m) => m.id);
  assert.ok(ids.includes(CHAT_MODEL), `${CHAT_MODEL} missing; ollama ids present: ${ids.filter((i) => i.startsWith("ollama/")).slice(0, 8).join(", ")}`);
  assert.ok(!ids.includes(CHAT_TAG), `bare tag ${CHAT_TAG} must NOT be advertised — the prefix is part of the id`);

  const entry = res.json.data.find((m) => m.id === CHAT_MODEL);
  assert.equal(entry.object, "model");
  assert.equal(entry.owned_by, "ollama");
  assert.equal(entry.root, CHAT_TAG, "`root` carries the provider-local tag");
  assert.equal(typeof entry.created, "number");
});

test("GET /v1/models also advertises the zippymesh/* routing playbooks", async () => {
  const res = await models();
  const ids = res.json.data.map((m) => m.id);
  for (const id of ["auto", "zippymesh/code-focus", "local/privacy-strict"]) {
    assert.ok(ids.includes(id), `playbook model ${id} missing from /v1/models`);
  }
});

test("OPTIONS preflight is allowed on /v1/models and /v1/chat/completions", async () => {
  const base = (process.env.ZMLR_E2E_BASE_URL || "").replace(/\/+$/, "");
  for (const [path, methods] of [["/v1/models", "GET, OPTIONS"], ["/v1/chat/completions", "GET, POST, OPTIONS"]]) {
    const res = await fetch(`${base}${path}`, {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(res.status, 200, `OPTIONS ${path}`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*", `ACAO on ${path}`);
    assert.equal(res.headers.get("access-control-allow-methods"), methods, `ACAM on ${path}`);
    assert.equal(res.headers.get("access-control-allow-headers"), "*", `ACAH on ${path}`);
  }
});

test("both /v1/... and /api/v1/... reach the same models route", async (t) => {
  const a = await models();
  assert.equal(a.status, 200);
  const t0 = Date.now();
  const b = await api("/api/v1/models");
  t.diagnostic(`GET /api/v1/models took ${Date.now() - t0}ms`);
  assert.equal(b.status, 200);
  assert.equal(b.json?.object, "list");
});

test("GET /v1/models only lists what this install can serve", async (t) => {
  if (!registration?.nodes.length) return t.skip("ollama not registered");
  const res = await models();
  const data = res.json.data;
  const known = new Set(["ollama", "lmstudio", "p2p", "zippymesh", "combo"]);
  const strangers = data.filter((m) => !known.has(m.owned_by));
  t.diagnostic(`GET /v1/models returned ${data.length} models; owners: ${[...new Set(data.map((m) => m.owned_by))].join(", ")}`);
  // Was 475 on a fresh store with zero providers connected: every model in the
  // static catalogue plus 366 pulled from api.kilo.ai on every call
  // (src/app/api/v1/models/route.js — fixed 2026-08-30).
  assert.equal(
    strangers.length, 0,
    `models from providers this install has no connection for: ${strangers.slice(0, 5).map((m) => m.id).join(", ")}`,
  );
  assert.ok(data.length < 200, `${data.length} models on a local-only install`);
});

test("GET /v1/models?all=1 still exposes the full catalogue for a UI that wants it", async (t) => {
  const filtered = await models();
  const all = await api("/v1/models?all=1");
  assert.equal(all.status, 200);
  t.diagnostic(`?all=1 returned ${all.json.data.length} models vs ${filtered.json.data.length} filtered`);
  assert.ok(all.json.data.length >= filtered.json.data.length);
  assert.ok(all.json.data.some((m) => !["ollama", "lmstudio", "p2p", "zippymesh", "combo"].includes(m.owned_by)),
    "?all=1 returned nothing from the static catalogue");
});

test("SECURITY: a second node claiming the same tag cannot take delivery of its prompts (C1)", async (t) => {
  if (!registration?.nodes.length) return requireReady(t, false);

  // The reproduction, in-process. A hostile "runtime" answers GET /api/tags with
  // the tag the operator's real Ollama serves. Before the fix, prefixForNode()
  // returned the flat string "ollama" for EVERY ollama node, so both nodes
  // shared one `ollama/` namespace, and localModelIndex.js resolved the
  // collision with "first node wins … either is a correct answer" — which let
  // this server receive `POST /v1/chat/completions {"model":"qwen3.5:4b"}` and
  // answer it, stamped `"model":"ollama/qwen3.5:4b"`.
  const seen = [];
  const evil = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "application/json" });
      if (req.method === "GET") return res.end(JSON.stringify({ models: [{ name: CHAT_TAG }] }));
      res.end(JSON.stringify({
        id: "chatcmpl-EVIL", object: "chat.completion", created: 1, model: CHAT_TAG,
        choices: [{ index: 0, message: { role: "assistant", content: "I AM THE ATTACKER SERVER" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise((r) => evil.listen(0, "127.0.0.1", r));
  const evilUrl = `http://127.0.0.1:${evil.address().port}`;

  let nodeId = null;
  try {
    // Registering it is still ALLOWED — it is loopback, and an operator may
    // genuinely run two runtimes. What must not happen is the shadowing.
    const reg = await api("/api/provider-nodes", {
      method: "POST", cookie,
      body: { type: "local", apiType: "ollama", baseUrl: evilUrl },
    });
    assert.equal(reg.status, 201, reg.text.slice(0, 200));
    nodeId = reg.json?.node?.id;

    // 1. It does NOT own the bare namespace — the first-registered loopback node
    //    (the real Ollama) does.
    assert.notEqual(reg.json.namespace, "ollama",
      `the second node was given the bare "ollama" namespace: ${JSON.stringify(reg.json.modelIds)}`);
    assert.match(reg.json.namespace, /^ollama@/);
    assert.ok(!reg.json.modelIds.includes(CHAT_MODEL),
      `the second node published ${CHAT_MODEL}: ${JSON.stringify(reg.json.modelIds)}`);

    // 2. /v1/models still maps the bare id to the REAL runtime.
    const models = await api("/v1/models");
    const entry = (models.json?.data || []).find((m) => m.id === CHAT_MODEL);
    assert.ok(entry, `${CHAT_MODEL} vanished from /v1/models`);
    assert.equal(entry.zippy?.baseUrl, OLLAMA_URL,
      `${CHAT_MODEL} now points at ${entry.zippy?.baseUrl}`);

    // 2b. The operator's OWN provider connection still points at their own
    // runtime. This is the root cause the review's reproduction ran through:
    // `syncLocalProviderConnection` passed a `name` filter that
    // `getProviderConnections` silently ignores, so registering a second local
    // node found the FIRST node's connection and overwrote its metadata —
    // repointing the live Ollama connection at the newcomer's baseUrl. One
    // POST, and every `ollama/*` request went to the shadow.
    const providers = await api("/api/providers", { cookie });
    assert.equal(providers.status, 200);
    const ollamaConns = (providers.json?.connections || []).filter((c) => c.provider === "ollama");
    const meta = (c) => (typeof c.metadata === "string" ? JSON.parse(c.metadata || "{}") : (c.metadata || {}));
    assert.ok(ollamaConns.some((c) => meta(c).baseUrl === OLLAMA_URL),
      `no ollama connection points at ${OLLAMA_URL} any more; got ${JSON.stringify(ollamaConns.map((c) => meta(c).baseUrl))}`);
    assert.equal(ollamaConns.length, 2,
      `expected one connection per local node, got ${ollamaConns.length} — a node overwrote another's connection`);

    // 3. The prompt round-trip the review used goes to the real Ollama.
    const chatRes = await api("/v1/chat/completions", {
      method: "POST",
      body: { model: CHAT_TAG, messages: [{ role: "user", content: `${nonce()} hi` }], max_tokens: 8, temperature: 0.7 },
    });
    assert.equal(chatRes.status, 200, chatRes.text.slice(0, 300));
    assert.doesNotMatch(chatRes.text, /I AM THE ATTACKER SERVER/,
      "the operator's prompt was answered by the shadow node");
    assert.deepEqual(seen.filter((s) => s.startsWith("POST")), [],
      `the shadow node received the prompt: ${JSON.stringify(seen)}`);
    t.diagnostic(`shadow node namespace=${reg.json.namespace}; it saw ${JSON.stringify(seen)}`);
  } finally {
    if (nodeId) await api(`/api/provider-nodes/${nodeId}`, { method: "DELETE", cookie });
    await new Promise((r) => evil.close(r));
  }
});

test("GET /v1/models is fast enough to sit on a request path", async (t) => {
  await models();
  const t0 = Date.now();
  const warm = await api("/v1/models");
  const warmMs = Date.now() - t0;
  assert.equal(warm.status, 200);
  // Was 7.4-27.6s: the route awaited maybeAutoRefreshProviderCatalog() (0-30s of
  // deliberate jitter) and fetched api.kilo.ai on every call.
  t.diagnostic(`GET /v1/models cold ${modelsMs}ms, warm ${warmMs}ms`);
  assert.ok(warmMs < 2_000, `warm GET /v1/models took ${warmMs}ms (target < 500ms)`);
});
