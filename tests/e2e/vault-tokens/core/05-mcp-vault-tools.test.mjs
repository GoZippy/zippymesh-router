/**
 * /api/mcp vault_* tools. The route gates the whole endpoint like any
 * management API (session cookie or router key) and additionally requires a
 * scoped ZippyVault agent token for vault_get / vault_list / vault_store.
 * A router-style `sk-` bearer must never be mistaken for a vault token.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../_lib/client.mjs";
import {
  FIXTURES, FIXTURE_NAMES, MISSING_ENTRY, bootstrapVault, fixtureValue,
  issueRawToken, mcp, assertNoKeysAnywhere, assertNoSecrets,
  tokenSha256, tokenFingerprint, lockVault, unlockVault,
} from "../_helpers.mjs";

describe("MCP vault tools over /api/mcp", () => {
  let cookie, wildcard, scoped;

  before(async () => {
    ({ cookie } = await bootstrapVault());
    wildcard = (await issueRawToken(cookie, "e2e-mcp-wildcard", ["*"])).raw;
    scoped = (await issueRawToken(cookie, "e2e-mcp-scoped", [FIXTURE_NAMES[1]])).raw;
  });

  test("GET /api/mcp advertises the four vault tools", async () => {
    const res = await api("/api/mcp", { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    for (const tool of ["vault_status", "vault_list", "vault_get", "vault_store"]) {
      assert.equal(res.json.tools.includes(tool), true, `${tool} is advertised`);
    }
  });

  test("/api/mcp without a session cookie is 401", async () => {
    const res = await api("/api/mcp", { method: "POST", body: { tool: "vault_status", input: {} } });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "Unauthorized");
  });

  test("vault_status works on the session alone and returns no secret material", async () => {
    const res = await mcp("vault_status", {}, { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.unlocked, true);
    assert.equal(res.json.entryCount, FIXTURES.length);
    assertNoKeysAnywhere(res.json, ["value", "encrypted_value", "salt", "iv", "tag"], "vault_status");
  });

  test("vault_get with x-zippyvault-token returns the value", async () => {
    const f = FIXTURES[0];
    const res = await mcp("vault_get", { name: f.name }, { cookie, vaultToken: wildcard });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.name, f.name);
    assert.equal(res.json.label, f.label);
    assert.equal(res.json.category, f.category);
    assert.equal(typeof res.json.value, "string", "a value is present");
    assert.equal(res.json.value === fixtureValue(f.name), true, "value round-trips");
  });

  test("a non-'sk-' bearer is accepted as the vault token", async () => {
    const f = FIXTURES[1];
    const res = await mcp("vault_get", { name: f.name }, { cookie, authorization: `Bearer ${scoped}` });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.value === fixtureValue(f.name), true);
  });

  test("'Authorization: Bearer sk-…' is NOT treated as a vault token", async () => {
    const res = await mcp("vault_get", { name: FIXTURE_NAMES[0] }, {
      cookie,
      authorization: "Bearer sk-anything-that-looks-like-a-router-key",
    });
    assert.equal(res.status, 502, "handler-reported failure");
    assert.equal(res.json.success, false);
    assert.equal(res.json.requires_token, true);
    assert.match(res.json.error, /agent token required/i);
    assert.equal(res.json.value, undefined, "no value is returned");
  });

  test("vault_get with no token at all asks for one", async () => {
    const res = await mcp("vault_get", { name: FIXTURE_NAMES[0] }, { cookie });
    assert.equal(res.status, 502);
    assert.equal(res.json.success, false);
    assert.equal(res.json.requires_token, true);
    assert.equal(res.json.value, undefined);
  });

  test("vault_get validates its input and enforces scope", async () => {
    const noName = await mcp("vault_get", {}, { cookie, vaultToken: wildcard });
    assert.equal(noName.json.success, false);
    assert.equal(noName.json.error, "name is required");

    const outOfScope = await mcp("vault_get", { name: FIXTURE_NAMES[0] }, { cookie, vaultToken: scoped });
    assert.equal(outOfScope.json.success, false);
    assert.match(outOfScope.json.error, /not scoped/i);
    assert.equal(outOfScope.json.value, undefined);

    const missing = await mcp("vault_get", { name: MISSING_ENTRY }, { cookie, vaultToken: wildcard });
    assert.equal(missing.json.success, false);
    assert.equal(missing.json.value, undefined);
  });

  test("vault_list is scoped and leaks no values", async () => {
    const all = await mcp("vault_list", {}, { cookie, vaultToken: wildcard });
    assert.equal(all.status, 200);
    assert.equal(all.json.success, true);
    assert.equal(all.json.unlocked, true);
    assert.deepEqual(all.json.scopes, ["*"]);
    assert.equal(all.json.count, FIXTURES.length);

    const one = await mcp("vault_list", {}, { cookie, vaultToken: scoped });
    assert.equal(one.json.count, 1);
    assert.deepEqual(one.json.entries.map((e) => e.name), [FIXTURE_NAMES[1]]);
    for (const entry of one.json.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ["category", "label", "name", "tags", "updated_at"]);
    }

    for (const res of [all, one]) {
      assertNoKeysAnywhere(res.json, ["value", "encrypted_value", "salt", "iv", "tag"], "vault_list");
      assertNoSecrets(res.text, FIXTURES.map((f) => [`value of ${f.name}`, fixtureValue(f.name)]), "vault_list");
    }

    const badToken = await mcp("vault_list", {}, { cookie, vaultToken: "not-a-real-token" });
    assert.equal(badToken.json.success, false);
    assert.equal(badToken.json.requires_token, true);
  });

  // ── vault_store ────────────────────────────────────────────────────────────
  //
  // Added 2026-08-30 (adversarial review, item 10b). `vault_store` was the only
  // vault tool with no end-to-end assertion, and it is the one that MUTATES:
  // src/lib/vaultTokens.js:234-247 requires a token scoped to "*" AND an
  // unlocked vault, and the review's decision on the missing
  // POST /api/vault/store-with-token route rests on "vault_store already works
  // over /api/mcp" — a claim nothing was checking.
  //
  // Entry names here are prefixed `e2e-store-` so they never collide with the
  // three fixtures the other files count.

  test("vault_store requires an agent token", async () => {
    const res = await mcp("vault_store", { name: "e2e-store-no-token", value: "x" }, { cookie });
    assert.equal(res.status, 502);
    assert.equal(res.json.success, false);
    assert.equal(res.json.requires_token, true);

    // Nothing was written.
    const check = await mcp("vault_get", { name: "e2e-store-no-token" }, { cookie, vaultToken: wildcard });
    assert.equal(check.json.success, false, "the rejected write stored nothing");
  });

  test("vault_store REJECTS a token that is not scoped to '*'", async () => {
    // `scoped` carries exactly one entry name, so it can READ that entry...
    const canRead = await mcp("vault_get", { name: FIXTURE_NAMES[1] }, { cookie, vaultToken: scoped });
    assert.equal(canRead.json.success, true, "precondition: the scoped token reads its own entry");

    // ...and must still not be able to write, even to that same entry.
    const sameEntry = await mcp(
      "vault_store",
      { name: FIXTURE_NAMES[1], value: "overwritten-by-a-scoped-token" },
      { cookie, vaultToken: scoped },
    );
    assert.equal(sameEntry.json.success, false);
    assert.match(sameEntry.json.error, /scoped to '\*'/i);

    const newEntry = await mcp(
      "vault_store",
      { name: "e2e-store-scoped-attempt", value: "should-not-exist" },
      { cookie, vaultToken: scoped },
    );
    assert.equal(newEntry.json.success, false);
    assert.match(newEntry.json.error, /scoped to '\*'/i);

    // The in-scope entry's value is untouched — the rejection was not partial.
    const after = await mcp("vault_get", { name: FIXTURE_NAMES[1] }, { cookie, vaultToken: wildcard });
    assert.equal(after.json.success, true);
    assert.equal(after.json.value === fixtureValue(FIXTURE_NAMES[1]), true, "value survived the rejected write");

    const missing = await mcp("vault_get", { name: "e2e-store-scoped-attempt" }, { cookie, vaultToken: wildcard });
    assert.equal(missing.json.success, false, "no entry was created");
  });

  test("a router-key bearer cannot stand in for the vault token on a WRITE", async () => {
    const res = await mcp(
      "vault_store",
      { name: "e2e-store-sk-attempt", value: "should-not-exist" },
      { cookie, authorization: "Bearer sk-anything-that-looks-like-a-router-key" },
    );
    assert.equal(res.status, 502);
    assert.equal(res.json.success, false);
    assert.equal(res.json.requires_token, true);

    const check = await mcp("vault_get", { name: "e2e-store-sk-attempt" }, { cookie, vaultToken: wildcard });
    assert.equal(check.json.success, false, "no entry was created");
  });

  test("vault_store with a '*' token writes, and the value round-trips through vault_get", async () => {
    const name = "e2e-store-roundtrip";
    const value = fixtureValue(name); // derived from the pass seed; never printed

    const stored = await mcp(
      "vault_store",
      { name, value, label: "Stored By MCP", category: "token", tags: ["e2e", "store"] },
      { cookie, vaultToken: wildcard },
    );
    assert.equal(stored.status, 200);
    assert.equal(stored.json.success, true);
    assert.equal(stored.json.name, name);
    // The write response must not echo the secret back.
    assertNoKeysAnywhere(stored.json, ["value", "encrypted_value", "salt", "iv", "tag"], "vault_store");
    assertNoSecrets(stored.text, [[`value of ${name}`, value]], "vault_store");

    const read = await mcp("vault_get", { name }, { cookie, vaultToken: wildcard });
    assert.equal(read.json.success, true);
    assert.equal(read.json.value === value, true, "the stored value round-trips");
    assert.equal(read.json.label, "Stored By MCP");
    assert.equal(read.json.category, "token");
  });

  test("vault_store UPDATES an existing entry in place", async () => {
    const name = "e2e-store-roundtrip";
    const updated = fixtureValue(`${name}:v2`);

    const res = await mcp("vault_store", { name, value: updated }, { cookie, vaultToken: wildcard });
    assert.equal(res.json.success, true);

    const read = await mcp("vault_get", { name }, { cookie, vaultToken: wildcard });
    assert.equal(read.json.value === updated, true, "the entry now holds the new value");

    const list = await mcp("vault_list", {}, { cookie, vaultToken: wildcard });
    assert.equal(
      list.json.entries.filter((e) => e.name === name).length,
      1,
      "an update creates no duplicate row",
    );
  });

  test("vault_store REFUSES to write while the vault is LOCKED", async () => {
    await lockVault(cookie);
    try {
      const res = await mcp(
        "vault_store",
        { name: "e2e-store-while-locked", value: "should-not-exist" },
        { cookie, vaultToken: wildcard },
      );
      assert.equal(res.json.success, false);
      assert.match(res.json.error, /locked/i);
    } finally {
      await unlockVault(cookie);
    }

    const check = await mcp("vault_get", { name: "e2e-store-while-locked" }, { cookie, vaultToken: wildcard });
    assert.equal(check.json.success, false, "nothing was written while locked");
  });

  test("no MCP response echoes the presented token, its SHA-256 or its fingerprint", async () => {
    const secrets = [
      ["rawToken", wildcard],
      ["sha256(token)", tokenSha256(wildcard)],
      ["fingerprint", tokenFingerprint(wildcard)],
    ];
    const get = await mcp("vault_get", { name: FIXTURE_NAMES[0] }, { cookie, vaultToken: wildcard });
    const list = await mcp("vault_list", {}, { cookie, vaultToken: wildcard });
    const status = await mcp("vault_status", {}, { cookie, vaultToken: wildcard });
    assertNoSecrets(get.text, secrets, "vault_get");
    assertNoSecrets(list.text, secrets, "vault_list");
    assertNoSecrets(status.text, secrets, "vault_status");
  });
});
