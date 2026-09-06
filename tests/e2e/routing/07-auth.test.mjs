/**
 * Who may call /v1 — the `requireApiKey` setting, router API keys, and the
 * header forms that are (and are not) accepted.
 *
 * This file mutates a global setting. It runs last (alphabetically) and always
 * restores requireApiKey:false, so an aborted run leaves the throwaway
 * DATA_DIR the runner deletes anyway.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { api, ensureSetup, login } from "../_lib/client.mjs";
import { CHAT_MODEL, chat, errorEnvelope, nonce, ollamaNodes, requireReady } from "./_fixtures.mjs";

let cookie;
let ready = false;
let apiKey = null;

/** A cheap /v1 call: the auth gate runs before any provider work. */
const ping = (headers) => chat(
  { model: CHAT_MODEL, messages: [{ role: "user", content: `${nonce()} hi` }], max_tokens: 8, temperature: 0.7 },
  { headers },
);

async function setRequireApiKey(value) {
  const res = await api("/api/settings", { method: "PATCH", cookie, body: { requireApiKey: value } });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.equal(res.json?.requireApiKey, value);
  // src/sse/handlers/chat.js re-reads settings per request, but the
  // /v1/chat/completions module keeps a 60s settings cache for other purposes;
  // a short pause keeps this deterministic.
  await new Promise((r) => setTimeout(r, 250));
}

test("setup", async () => {
  await ensureSetup();
  cookie = await login();
  ready = (await ollamaNodes(cookie)).length > 0;
});

test("with requireApiKey off, /v1/chat/completions works with no credentials at all", async (t) => {
  if (!requireReady(t, ready)) return;
  const res = await ping();
  assert.equal(res.status, 200, res.text.slice(0, 200));
});

test("POST /api/keys mints a router API key (opaque base64, no zpc1/sk- prefix)", async () => {
  const res = await api("/api/keys", { method: "POST", cookie, body: { name: `routing-e2e-${nonce()}` } });
  assert.equal(res.status, 201, res.text.slice(0, 200));
  assert.equal(typeof res.json?.id, "string");
  assert.equal(typeof res.json?.key, "string");
  apiKey = res.json.key;
  assert.ok(apiKey.length >= 64, `key length ${apiKey.length}`);
  // Recorded because docs and tests/e2e/zmlr.spec.cjs:155 claim a "zpc1" prefix.
  // createRouterApiKey (src/lib/localDb.js:3155) is base64(uuid+uuid).
  assert.ok(!apiKey.startsWith("zpc1"), "key gained a zpc1 prefix — update the contract doc");
  assert.ok(!apiKey.startsWith("sk-"), "key gained an sk- prefix — update the contract doc");
});

test("the key is listed without its value ever being returned again", async () => {
  const res = await api("/api/keys", { cookie });
  assert.equal(res.status, 200);
  const keys = res.json?.keys || [];
  assert.ok(keys.length > 0);
  for (const k of keys) {
    assert.ok(!("key" in k), "GET /api/keys leaked a raw key");
    assert.ok(!("keyHash" in k), "GET /api/keys leaked the key hash");
  }
  assert.ok(!res.text.includes(apiKey), "GET /api/keys echoed the raw key");
});

test("with requireApiKey on: no key -> 401 in the OpenAI envelope", async (t) => {
  // T6: a 401 is decided before any provider work, so this needs no model.
  try {
    await setRequireApiKey(true);
    const res = await ping();
    assert.equal(res.status, 401, res.text.slice(0, 200));
    const err = errorEnvelope(res.json);
    assert.equal(err.message, "Missing API key");
    assert.equal(err.type, "authentication_error");
    assert.equal(err.code, "invalid_api_key");
  } finally {
    await setRequireApiKey(false);
  }
});

test("with requireApiKey on: bad bearer -> 401, good bearer -> 200", async (t) => {
  if (!requireReady(t, ready)) return;
  assert.ok(apiKey, "no key minted");
  try {
    await setRequireApiKey(true);
    const bad = await ping({ Authorization: "Bearer definitely-not-a-valid-router-key-0000000000" });
    assert.equal(bad.status, 401);
    assert.equal(errorEnvelope(bad.json).message, "Invalid API key");

    const good = await ping({ Authorization: `Bearer ${apiKey}` });
    assert.equal(good.status, 200, good.text.slice(0, 200));
  } finally {
    await setRequireApiKey(false);
  }
});

test("with requireApiKey on: x-api-key is NOT accepted, only Authorization: Bearer", async (t) => {
  // T6: also a 401, also decided before any provider work.
  assert.ok(apiKey, "no key minted");
  try {
    await setRequireApiKey(true);
    const res = await ping({ "x-api-key": apiKey });
    assert.equal(res.status, 401, "x-api-key started working — update the contract doc");
    assert.equal(errorEnvelope(res.json).message, "Missing API key");
  } finally {
    await setRequireApiKey(false);
  }
});

test("SECURITY: a forged x-real-ip does NOT bypass requireApiKey", async (t) => {
  // T6, fixed 2026-08-30: this sat behind `if (!ready) return t.skip(...)`, so
  // the regression test for an auth bypass fixed the same day was silently
  // disabled on any box without a local LLM. The gate it tests runs BEFORE any
  // provider work — a 401 needs no model — so the guard was never necessary.
  try {
    await setRequireApiKey(true);
    // Fixed 2026-08-30. src/lib/auth/apiKey.js used to take the client address
    // straight from the x-real-ip REQUEST HEADER and then let any address inside
    // settings.trustedLanCidrs (default 10.0.0.0/16, 127.0.0.0/8, ::1/128) skip
    // the key check — an outright auth bypass for anyone who could reach the
    // port. The address now comes from src/lib/net/proxyTrust.js, which yields
    // an address ONLY when the operator declared a reverse proxy with
    // TRUST_PROXY; otherwise the peer is the sentinel "direct" and no CIDR can
    // match it. The runner does not set TRUST_PROXY for this suite.
    for (const ip of ["127.0.0.1", "10.0.0.5"]) {
      const res = await ping({ "x-real-ip": ip });
      assert.equal(res.status, 401, `x-real-ip: ${ip} bought a bypass (${res.status}) — the LAN auth bypass is back`);
      const err = errorEnvelope(res.json);
      assert.equal(err.message, "Missing API key");
      assert.equal(err.type, "authentication_error");
    }
    // The same forged header does not help an x-forwarded-for either.
    const xff = await ping({ "x-real-ip": "127.0.0.1", "x-forwarded-for": "127.0.0.1" });
    assert.equal(xff.status, 401, "x-forwarded-for + x-real-ip bought a bypass");
  } finally {
    await setRequireApiKey(false);
  }
});

test("GET /v1/models honours requireApiKey (fixed 2026-08-30)", async () => {
  // It used to answer 200 with no credentials even with the setting on, leaking
  // the full provider inventory. Same gate as chat/completions now.
  try {
    await setRequireApiKey(true);
    const anon = await api("/v1/models");
    assert.equal(anon.status, 401, `GET /v1/models is ungated again: ${anon.text.slice(0, 200)}`);
    const err = errorEnvelope(anon.json);
    assert.equal(err.type, "authentication_error");
    assert.equal(err.code, "invalid_api_key");
    // Same envelope as every other /v1 error, request_id included.
    assert.equal(typeof err.request_id, "string");
    assert.equal(anon.headers.get("access-control-allow-origin"), "*");

    assert.ok(apiKey, "no key minted");
    const authed = await api("/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    assert.equal(authed.status, 200, authed.text.slice(0, 200));
    assert.equal(authed.json?.object, "list");
  } finally {
    await setRequireApiKey(false);
  }

  const off = await api("/v1/models");
  assert.equal(off.status, 200, "with requireApiKey off, /v1/models needs no credentials");
});

test("requireApiKey is back off at the end of the suite", async () => {
  const res = await api("/api/settings");
  assert.equal(res.status, 200);
  assert.equal(res.json?.requireApiKey, false);
});
