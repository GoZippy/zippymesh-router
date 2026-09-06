/**
 * POST/GET /api/vault/tokens and DELETE /api/vault/tokens/:id — issuing,
 * listing and revoking scoped agent tokens through the session-cookie API.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../_lib/client.mjs";
import {
  FIXTURE_NAMES, bootstrapVault, issueToken, issueRawToken,
  readWithToken, tokenSha256, tokenFingerprint, assertNoSecrets,
} from "../_helpers.mjs";

describe("agent token issue / list / revoke", () => {
  let cookie;

  before(async () => { ({ cookie } = await bootstrapVault()); });

  test("issuing a single-scope token returns the raw token exactly once", async () => {
    const res = await issueToken(cookie, { name: "e2e-single", scopes: [FIXTURE_NAMES[0]] });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(typeof res.json.tokenId, "string");
    assert.match(res.json.rawToken, /^[0-9a-f]{64}$/, "32 random bytes, hex");
    assert.equal(res.json.name, "e2e-single");
    assert.deepEqual(res.json.scopes, [FIXTURE_NAMES[0]]);
    assert.equal(typeof res.json.createdAt, "number");
    assert.equal(res.json.expiresAt, null, "no TTL requested -> no expiry");

    const listed = await api("/api/vault/tokens", { cookie });
    const row = listed.json.tokens.find((t) => t.id === res.json.tokenId);
    assert.ok(row, "the new token appears in the list");
    assert.equal(row.rawToken, undefined, "listing never replays the raw token");
    assertNoSecrets(
      listed.text,
      [["rawToken", res.json.rawToken], ["sha256(token)", tokenSha256(res.json.rawToken)], ["fingerprint", tokenFingerprint(res.json.rawToken)]],
      "GET /api/vault/tokens",
    );
  });

  test("issuing a two-scope token records both scopes", async () => {
    const res = await issueToken(cookie, { name: "e2e-pair", scopes: [FIXTURE_NAMES[0], FIXTURE_NAMES[1]] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.scopes, [FIXTURE_NAMES[0], FIXTURE_NAMES[1]]);
  });

  test("issuing a wildcard token records ['*']", async () => {
    const res = await issueToken(cookie, { name: "e2e-wild", scopes: ["*"] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.scopes, ["*"]);
  });

  test("issuing with a TTL sets expiresAt = createdAt + expiresInMs", async () => {
    const res = await issueToken(cookie, { name: "e2e-ttl", scopes: ["*"], expiresInMs: 60_000 });
    assert.equal(res.status, 200);
    assert.equal(res.json.expiresAt - res.json.createdAt, 60_000);
  });

  test("issuing rejects a bad name, bad scopes and a bad TTL with 400", async () => {
    const noName = await issueToken(cookie, { scopes: ["*"] });
    assert.equal(noName.status, 400);
    assert.equal(noName.json.error, "name is required");

    const numericName = await api("/api/vault/tokens", { method: "POST", cookie, body: { name: 7, scopes: ["*"] } });
    assert.equal(numericName.status, 400);

    const noScopes = await issueToken(cookie, { name: "e2e-bad" });
    assert.equal(noScopes.status, 400);

    const emptyScopes = await issueToken(cookie, { name: "e2e-bad", scopes: [] });
    assert.equal(emptyScopes.status, 400);

    const stringScopes = await api("/api/vault/tokens", { method: "POST", cookie, body: { name: "e2e-bad", scopes: "*" } });
    assert.equal(stringScopes.status, 400);

    const nonStringScope = await api("/api/vault/tokens", { method: "POST", cookie, body: { name: "e2e-bad", scopes: [1] } });
    assert.equal(nonStringScope.status, 400);

    const textTtl = await api("/api/vault/tokens", { method: "POST", cookie, body: { name: "e2e-bad", scopes: ["*"], expiresInMs: "soon" } });
    assert.equal(textTtl.status, 400);
    assert.match(textTtl.json.error, /positive number of milliseconds/);

    const negativeTtl = await issueToken(cookie, { name: "e2e-bad", scopes: ["*"], expiresInMs: -1000 });
    assert.equal(negativeTtl.status, 400);
  });

  test("GET /api/vault/tokens returns metadata only", async () => {
    const res = await api("/api/vault/tokens", { cookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.tokens));
    assert.ok(res.json.tokens.length >= 4);
    for (const t of res.json.tokens) {
      assert.deepEqual(
        Object.keys(t).sort(),
        ["created_at", "expires_at", "id", "last_used_at", "name", "scopes"],
      );
    }
    assert.equal(/token_hash/.test(res.text), false, "no stored hash is ever exposed");
  });

  test("revoking a token makes it 401 immediately and drops it from the listing", async () => {
    const { raw, id } = await issueRawToken(cookie, "e2e-revokable", ["*"]);

    const before = await readWithToken(raw, FIXTURE_NAMES[0]);
    assert.equal(before.status, 200, "token works before revocation");

    const del = await api(`/api/vault/tokens/${id}`, { method: "DELETE", cookie });
    assert.equal(del.status, 200);
    assert.equal(del.json.ok, true);
    assert.equal(del.json.revoked, id);

    const after = await readWithToken(raw, FIXTURE_NAMES[0]);
    assert.equal(after.status, 401, "revocation is immediate");
    assert.equal(after.json.error, "Token has been revoked");

    const listed = await api("/api/vault/tokens", { cookie });
    assert.equal(listed.json.tokens.some((t) => t.id === id), false, "revoked tokens are not listed");
  });

  test("revoking an unknown or already-revoked id is 404", async () => {
    const res = await api("/api/vault/tokens/00000000-0000-4000-8000-000000000000", { method: "DELETE", cookie });
    assert.equal(res.status, 404);
    assert.equal(res.json.error, "Token not found or already revoked");
  });

  test("last_used_at is stamped after a read", async () => {
    const { raw, id } = await issueRawToken(cookie, "e2e-usage-stamp", ["*"]);
    const fresh = (await api("/api/vault/tokens", { cookie })).json.tokens.find((t) => t.id === id);
    assert.equal(fresh.last_used_at, null, "never used yet");

    const read = await readWithToken(raw, FIXTURE_NAMES[1]);
    assert.equal(read.status, 200);

    const used = (await api("/api/vault/tokens", { cookie })).json.tokens.find((t) => t.id === id);
    assert.equal(typeof used.last_used_at, "number");
    assert.ok(used.last_used_at >= used.created_at);
  });
});
