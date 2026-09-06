/**
 * Edge middleware posture for the vault surface, plus a whole-surface sweep
 * that no response body ever carries an agent token, its SHA-256, its
 * limiter fingerprint, or a stored plaintext where it does not belong.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { api } from "../../_lib/client.mjs";
import {
  FIXTURES, FIXTURE_NAMES, bootstrapVault, fixtureValue, issueRawToken,
  readWithToken, listWithToken, mcp, tokenSha256, tokenFingerprint, assertNoSecrets,
} from "../_helpers.mjs";

describe("middleware posture and leak sweep", () => {
  let cookie, token, tokenId;

  before(async () => {
    ({ cookie } = await bootstrapVault());
    ({ raw: token, id: tokenId } = await issueRawToken(cookie, "e2e-middleware", ["*"]));
  });

  test("both token routes work with NO cookie", async () => {
    const read = await readWithToken(token, FIXTURE_NAMES[0]);
    assert.equal(read.status, 200, "read-with-token is on the middleware public list");
    assert.equal(read.json.ok, true);

    const list = await listWithToken(token);
    assert.equal(list.status, 200, "list-with-token is on the middleware public list");
    assert.equal(list.json.ok, true);
  });

  test("the session-only vault management routes are 401 without a cookie", async () => {
    const cases = [
      ["GET", "/api/vault"],
      ["GET", "/api/vault/entries"],
      ["GET", "/api/vault/tokens"],
    ];
    for (const [method, path] of cases) {
      const res = await api(path, { method });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.json?.error, "Unauthorized", `${method} ${path} body`);
    }

    const post = await api("/api/vault/tokens", { method: "POST", body: { name: "nope", scopes: ["*"] } });
    assert.equal(post.status, 401, "POST /api/vault/tokens without a cookie");
    assert.equal(post.json?.rawToken, undefined, "no token is minted for an unauthenticated caller");
  });

  test("DELETE /api/vault/tokens/:id without a cookie is 401 and does NOT revoke", async () => {
    const res = await api(`/api/vault/tokens/${tokenId}`, { method: "DELETE" });
    assert.equal(res.status, 401);
    assert.equal(res.json?.ok, undefined);

    const stillWorks = await readWithToken(token, FIXTURE_NAMES[0]);
    assert.equal(stillWorks.status, 200, "the token survived the unauthenticated delete");
  });

  test("a bogus 'Bearer' does not bypass the cookie gate on a management route", async () => {
    const res = await api("/api/vault/tokens", { headers: { authorization: "Bearer sk-not-a-real-router-key-000000000" } });
    assert.equal(res.status, 401);
    assert.equal(res.json?.error, "Unauthorized");
  });

  test("the public endpoints the runner relies on stay public", async () => {
    const health = await api("/api/health");
    assert.equal(health.status, 200);

    const settings = await api("/api/settings");
    assert.equal(settings.status, 200);
    assert.equal(settings.json?.password, undefined);
  });

  test("sweep: no response echoes the token, its hash or its fingerprint", async () => {
    const secrets = [
      ["rawToken", token],
      ["sha256(token)", tokenSha256(token)],
      ["fingerprint", tokenFingerprint(token)],
    ];

    const responses = [
      ["read 200", await readWithToken(token, FIXTURE_NAMES[0])],
      ["read 404", await readWithToken(token, "e2e-absent-sweep")],
      ["list 200", await listWithToken(token)],
      ["tokens list", await api("/api/vault/tokens", { cookie })],
      ["entries list", await api("/api/vault/entries", { cookie })],
      ["vault status", await api("/api/vault", { cookie })],
      ["mcp vault_list", await mcp("vault_list", {}, { cookie, vaultToken: token })],
      ["mcp vault_status", await mcp("vault_status", {}, { cookie, vaultToken: token })],
    ];

    for (const [label, res] of responses) assertNoSecrets(res.text, secrets, label);
  });

  test("sweep: stored plaintexts appear only in read-with-token's 200 body", async () => {
    const values = FIXTURES.map((f) => [`value of ${f.name}`, fixtureValue(f.name)]);

    const mustNotLeak = [
      ["list-with-token", await listWithToken(token)],
      ["tokens list", await api("/api/vault/tokens", { cookie })],
      ["entries list", await api("/api/vault/entries", { cookie })],
      ["vault status", await api("/api/vault", { cookie })],
      ["mcp vault_list", await mcp("vault_list", {}, { cookie, vaultToken: token })],
      ["mcp vault_status", await mcp("vault_status", {}, { cookie, vaultToken: token })],
      ["settings", await api("/api/settings", { cookie })],
    ];
    for (const [label, res] of mustNotLeak) assertNoSecrets(res.text, values, label);

    // The one endpoint that is *supposed* to return a value still returns only
    // the requested entry's value, never another entry's.
    const read = await readWithToken(token, FIXTURE_NAMES[0]);
    assert.equal(read.json.value === fixtureValue(FIXTURE_NAMES[0]), true);
    assertNoSecrets(
      read.text,
      values.filter(([label]) => !label.endsWith(FIXTURE_NAMES[0])),
      "read-with-token 200 body",
    );
  });
});
