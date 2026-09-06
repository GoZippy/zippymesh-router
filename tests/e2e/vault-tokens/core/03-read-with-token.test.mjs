/**
 * POST /api/vault/read-with-token — the frozen contract Kiro Crew depends on.
 * `{token, entry}` -> `{ok, name, label, category, value}` with 400/401/403/404.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../_lib/client.mjs";
import {
  FIXTURES, FIXTURE_NAMES, MISSING_ENTRY, READ_PATH, bootstrapVault, fixtureValue,
  issueRawToken, readWithToken, tokenSha256, tokenFingerprint,
  assertKeys, assertNoSecrets, sleep,
} from "../_helpers.mjs";

describe("read-with-token", () => {
  let cookie, wildcard, pair, single;

  before(async () => {
    ({ cookie } = await bootstrapVault());
    wildcard = (await issueRawToken(cookie, "e2e-read-wildcard", ["*"])).raw;
    pair = (await issueRawToken(cookie, "e2e-read-pair", [FIXTURE_NAMES[0], FIXTURE_NAMES[1]])).raw;
    single = (await issueRawToken(cookie, "e2e-read-single", [FIXTURE_NAMES[2]])).raw;
  });

  test("happy path returns exactly {ok,name,label,category,value}", async () => {
    const f = FIXTURES[0];
    const res = await readWithToken(wildcard, f.name);
    assert.equal(res.status, 200);
    assertKeys(res.json, ["ok", "name", "label", "category", "value"], "read-with-token 200 body");
    assert.equal(res.json.ok, true);
    assert.equal(res.json.name, f.name);
    assert.equal(res.json.label, f.label);
    assert.equal(res.json.category, f.category);
    assert.equal(typeof res.json.value, "string");
    // boolean comparison: a failure must never print the plaintext
    assert.equal(res.json.value === fixtureValue(f.name), true, "value round-trips");
  });

  test("a wildcard token reads every entry and each value round-trips", async () => {
    for (const f of FIXTURES) {
      const res = await readWithToken(wildcard, f.name);
      assert.equal(res.status, 200, `read ${f.name}`);
      assert.equal(res.json.value === fixtureValue(f.name), true, `value round-trips for ${f.name}`);
    }
  });

  test("a two-scope token reads both of its entries", async () => {
    for (const name of [FIXTURE_NAMES[0], FIXTURE_NAMES[1]]) {
      const res = await readWithToken(pair, name);
      assert.equal(res.status, 200, `pair token reads ${name}`);
      assert.equal(res.json.value === fixtureValue(name), true);
    }
  });

  test("a scope miss is 403 and the message does not reveal whether the entry exists", async () => {
    const existing = await readWithToken(single, FIXTURE_NAMES[0]);
    const absent = await readWithToken(single, MISSING_ENTRY);

    assert.equal(existing.status, 403);
    assert.equal(absent.status, 403);
    assert.equal(existing.json.ok, false);
    assert.equal(absent.json.ok, false);

    // Same sentence modulo the caller-supplied entry name -> no existence oracle.
    // (The entry name is echoed back, so strip it before comparing/word-checking.)
    const normalise = (msg, name) => msg.split(name).join("<ENTRY>");
    const normExisting = normalise(existing.json.error, FIXTURE_NAMES[0]);
    const normAbsent = normalise(absent.json.error, MISSING_ENTRY);
    assert.equal(normExisting, normAbsent, "403 text differs between an existing and a non-existent entry");
    for (const msg of [normExisting, normAbsent]) {
      assert.equal(/not found/i.test(msg), false, "403 must not say 'not found'");
      assert.equal(/exist/i.test(msg), false, "403 must not talk about existence");
    }
    assert.equal(existing.json.value, undefined);
  });

  test("a missing entry inside scope is 404", async () => {
    const res = await readWithToken(wildcard, MISSING_ENTRY);
    assert.equal(res.status, 404);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error, `Entry not found: ${MISSING_ENTRY}`);
    assert.equal(res.json.value, undefined);
  });

  test("an unknown or garbage token is 401 'Invalid token'", async () => {
    const garbage = await readWithToken("not-a-token", FIXTURE_NAMES[0]);
    assert.equal(garbage.status, 401);
    assert.equal(garbage.json.error, "Invalid token");
    assert.equal(garbage.json.ok, false);

    const wellFormedButUnknown = await readWithToken("0".repeat(64), FIXTURE_NAMES[0]);
    assert.equal(wellFormedButUnknown.status, 401);
    assert.equal(wellFormedButUnknown.json.error, "Invalid token");
  });

  test("a short-TTL token works, then is 401 'Token has expired'", async () => {
    const { raw } = await issueRawToken(cookie, "e2e-read-ttl", ["*"], 1200);

    const before = await readWithToken(raw, FIXTURE_NAMES[0]);
    assert.equal(before.status, 200, "valid before the TTL elapses");

    await sleep(1500);

    const after = await readWithToken(raw, FIXTURE_NAMES[0]);
    assert.equal(after.status, 401);
    assert.equal(after.json.error, "Token has expired");
    assert.equal(after.json.value, undefined);
  });

  test("bad request bodies are 400 before any token lookup", async () => {
    const badJson = await api(READ_PATH, { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.json.error, "Invalid JSON body");

    const empty = await api(READ_PATH, { method: "POST", body: {} });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error, "token is required");

    const noEntry = await readWithToken(wildcard, undefined);
    assert.equal(noEntry.status, 400);
    assert.equal(noEntry.json.error, "entry is required");

    const numericToken = await api(READ_PATH, { method: "POST", body: { token: 12345, entry: FIXTURE_NAMES[0] } });
    assert.equal(numericToken.status, 400);
    assert.equal(numericToken.json.error, "token is required");

    const numericEntry = await api(READ_PATH, { method: "POST", body: { token: wildcard, entry: 42 } });
    assert.equal(numericEntry.status, 400);
    assert.equal(numericEntry.json.error, "entry is required");

    const nullBody = await api(READ_PATH, { method: "POST", body: "null", headers: { "content-type": "application/json" } });
    assert.equal(nullBody.status, 400);

    for (const r of [badJson, empty, noEntry, numericToken, numericEntry, nullBody]) {
      assert.equal(r.json?.ok, false, "every 400 keeps the {ok:false,error} shape");
    }
  });

  test("no response ever echoes the token, its SHA-256 or its fingerprint", async () => {
    const secrets = [
      ["rawToken", wildcard],
      ["sha256(token)", tokenSha256(wildcard)],
      ["fingerprint", tokenFingerprint(wildcard)],
    ];
    const ok = await readWithToken(wildcard, FIXTURE_NAMES[0]);
    const notFound = await readWithToken(wildcard, MISSING_ENTRY);
    const forbidden = await readWithToken(single, FIXTURE_NAMES[0]);

    assertNoSecrets(ok.text, secrets, "200 read-with-token");
    assertNoSecrets(notFound.text, secrets, "404 read-with-token");
    assertNoSecrets(forbidden.text, [["rawToken", single], ["sha256(token)", tokenSha256(single)], ["fingerprint", tokenFingerprint(single)]], "403 read-with-token");
  });
});
