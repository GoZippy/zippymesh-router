/**
 * POST /api/vault/list-with-token — the second frozen contract:
 * `{token}` -> `{ok, scopes, unlocked, entries[{name,label,category,tags,updated_at}]}`.
 * Metadata only: no value, and none of the ciphertext columns.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../_lib/client.mjs";
import {
  FIXTURES, FIXTURE_NAMES, LIST_PATH, bootstrapVault, fixtureValue,
  issueRawToken, listWithToken, lockVault, unlockVault,
  tokenSha256, tokenFingerprint, assertKeys, assertNoKeysAnywhere, assertNoSecrets,
} from "../_helpers.mjs";

const ENTRY_KEYS = ["name", "label", "category", "tags", "updated_at"];
const SECRET_KEYS = ["value", "encrypted_value", "salt", "iv", "tag"];

describe("list-with-token", () => {
  let cookie, wildcard, pair;

  before(async () => {
    ({ cookie } = await bootstrapVault());
    wildcard = (await issueRawToken(cookie, "e2e-list-wildcard", ["*"])).raw;
    pair = (await issueRawToken(cookie, "e2e-list-pair", [FIXTURE_NAMES[0], FIXTURE_NAMES[2]])).raw;
  });

  after(async () => { await unlockVault(cookie); });

  test("a wildcard token sees every entry with exactly the contract keys", async () => {
    const res = await listWithToken(wildcard);
    assert.equal(res.status, 200);
    assertKeys(res.json, ["ok", "scopes", "unlocked", "entries"], "list-with-token 200 body");
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.scopes, ["*"]);
    assert.equal(res.json.unlocked, true);
    assert.equal(res.json.entries.length, FIXTURES.length);

    for (const entry of res.json.entries) {
      assertKeys(entry, ENTRY_KEYS, `entry ${entry.name}`);
      const fixture = FIXTURES.find((f) => f.name === entry.name);
      assert.ok(fixture, `unexpected entry ${entry.name}`);
      assert.equal(entry.label, fixture.label);
      assert.equal(entry.category, fixture.category);
      assert.deepEqual(entry.tags, fixture.tags);
      // updated_at is SQLite datetime('now') TEXT — "YYYY-MM-DD HH:MM:SS" in UTC,
      // second resolution, no timezone marker. Pinned here because the contract
      // is frozen and a consumer parses this field.
      assert.equal(typeof entry.updated_at, "string");
      assert.match(entry.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });

  test("no ciphertext column or plaintext value appears anywhere in the response", async () => {
    const res = await listWithToken(wildcard);
    assertNoKeysAnywhere(res.json, SECRET_KEYS, "list-with-token body");
    for (const key of ["\"value\"", "\"encrypted_value\"", "\"salt\"", "\"iv\"", "\"tag\":"]) {
      assert.equal(res.text.includes(key), false, `raw body must not contain ${key}`);
    }
    assertNoSecrets(
      res.text,
      FIXTURES.map((f) => [`value of ${f.name}`, fixtureValue(f.name)]),
      "list-with-token body",
    );
    assertNoSecrets(
      res.text,
      [["rawToken", wildcard], ["sha256(token)", tokenSha256(wildcard)], ["fingerprint", tokenFingerprint(wildcard)]],
      "list-with-token body",
    );
  });

  test("a scoped token sees only the entries in its scope", async () => {
    const res = await listWithToken(pair);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.scopes, [FIXTURE_NAMES[0], FIXTURE_NAMES[2]]);
    assert.deepEqual(res.json.entries.map((e) => e.name).sort(), [FIXTURE_NAMES[0], FIXTURE_NAMES[2]].sort());
    assert.equal(res.json.entries.some((e) => e.name === FIXTURE_NAMES[1]), false, "out-of-scope entry is hidden");
    for (const entry of res.json.entries) assertKeys(entry, ENTRY_KEYS, `scoped entry ${entry.name}`);
  });

  test("`unlocked` follows the vault, and listing keeps working while locked", async () => {
    await lockVault(cookie);

    const locked = await listWithToken(wildcard);
    assert.equal(locked.status, 200, "metadata is stored in the clear -> listing survives a lock");
    assert.equal(locked.json.unlocked, false);
    assert.equal(locked.json.entries.length, FIXTURES.length);
    assertNoKeysAnywhere(locked.json, SECRET_KEYS, "locked list-with-token body");

    await unlockVault(cookie);

    const unlocked = await listWithToken(wildcard);
    assert.equal(unlocked.json.unlocked, true);
  });

  test("a bad token is 401 and a bad body is 400", async () => {
    const badToken = await listWithToken("nope");
    assert.equal(badToken.status, 401);
    assert.equal(badToken.json.ok, false);
    assert.equal(badToken.json.error, "Invalid token");
    assert.equal(badToken.json.entries, undefined);

    const badJson = await api(LIST_PATH, { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.json.error, "Invalid JSON body");

    const empty = await api(LIST_PATH, { method: "POST", body: {} });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error, "token is required");

    const numeric = await api(LIST_PATH, { method: "POST", body: { token: 42 } });
    assert.equal(numeric.status, 400);
    assert.equal(numeric.json.error, "token is required");
  });
});
