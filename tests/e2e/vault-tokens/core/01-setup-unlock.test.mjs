/**
 * First run, login, vault lock/unlock, entry storage — against the production
 * standalone build. Also covers the handoff's `next dev` regression: after an
 * unlock the very FIRST token read must succeed, not report a locked vault.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { api, ensureSetup, login, adminPassword, baseUrl } from "../../_lib/client.mjs";
import {
  FIXTURES, fixtureValue, vaultPassword, unlockVault, lockVault,
  issueRawToken, readWithToken, assertNoKeysAnywhere,
} from "../_helpers.mjs";

describe("first run, login, vault lifecycle", () => {
  let cookie;
  let wildcardToken;

  before(async () => {
    assert.match(baseUrl(), /^http:\/\/127\.0\.0\.1:\d+$/, "runner must bind loopback");
  });

  test("GET /api/health is 200 and reports ok", async () => {
    const res = await api("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.json?.ok, true);
    assert.equal(res.json?.status, "ok");
  });

  test("first-run PATCH /api/settings sets a password without a cookie", async () => {
    const before = await api("/api/settings");
    assert.equal(before.status, 200, "GET /api/settings is public");

    const result = await ensureSetup();
    assert.equal(typeof result.alreadySetUp, "boolean");

    const after = await api("/api/settings");
    assert.equal(after.status, 200);
    assert.equal(after.json?.hasPassword, true, "a password hash exists after setup");
    assert.equal(after.json?.password, undefined, "GET /api/settings never returns the hash");
  });

  test("login with the wrong password is 401", async () => {
    const res = await api("/api/auth/login", {
      method: "POST",
      body: { password: `${adminPassword()}-wrong` },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json?.success, undefined);
  });

  /**
   * REGRESSION for the adversarial review's item 15.
   *
   * The lockout was 5 failures / 15 minutes on a bucket keyed by clientPeer(),
   * which without TRUST_PROXY is the single literal string "direct" — so five
   * unauthenticated POSTs from anyone who could reach the port locked the
   * operator out of their own dashboard, and the route's claim that "a
   * successful login clears the streak" was unreachable because the 429 was
   * returned before authenticate() ran.
   *
   * This drives the peer straight past the OLD threshold and then logs in.
   * It is also why tests/e2e/_lib/client.mjs no longer sends a synthetic
   * x-forwarded-for: that header was a workaround for this bug.
   *
   * Each failure now costs a per-account backoff (250 ms doubling), so six
   * failures is a few seconds — deliberately kept below the 30 s cap.
   */
  test("five wrong passwords do NOT lock the operator out", async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: { password: `${adminPassword()}-wrong-${i}` },
      });
      assert.equal(res.status, 401, `failure ${i} must be a plain 401, not a 429`);
    }

    const good = await api("/api/auth/login", { method: "POST", body: { password: adminPassword() } });
    assert.equal(good.status, 200, "the correct password still works after 5 failures");
    assert.equal(good.json?.success, true);
  });

  test("login with the right password returns an auth_token cookie", async () => {
    cookie = await login();
    assert.match(cookie, /^auth_token=[\w-]+\.[\w-]+\.[\w-]+$/, "cookie carries a compact JWS");
  });

  test("GET /api/vault without a cookie is 401 (management API)", async () => {
    const res = await api("/api/vault");
    assert.equal(res.status, 401);
    assert.equal(res.json?.error, "Unauthorized");
  });

  test("GET /api/vault with a cookie reports a locked, empty vault", async () => {
    const res = await api("/api/vault", { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json?.unlocked, false);
    assert.equal(res.json?.entryCount, null, "entryCount is null while locked");
  });

  test("storing an entry while locked is 403 'Vault is locked'", async () => {
    const res = await api("/api/vault/entries", {
      method: "POST", cookie, body: { name: "e2e-should-not-exist", value: "x" },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json?.error, "Vault is locked");
  });

  test("POST /api/vault rejects a missing/unknown action", async () => {
    const noAction = await api("/api/vault", { method: "POST", cookie, body: {} });
    assert.equal(noAction.status, 400);
    assert.equal(noAction.json?.error, "action must be 'unlock' or 'lock'");

    const noPassword = await api("/api/vault", { method: "POST", cookie, body: { action: "unlock" } });
    assert.equal(noPassword.status, 400);
    assert.equal(noPassword.json?.error, "password required");
  });

  test("unlock succeeds and the three fixture entries store", async () => {
    await unlockVault(cookie);

    for (const f of FIXTURES) {
      const res = await api("/api/vault/entries", {
        method: "POST", cookie,
        body: { name: f.name, value: fixtureValue(f.name), label: f.label, category: f.category, tags: f.tags },
      });
      assert.equal(res.status, 200, `store ${f.name}`);
      assert.equal(res.json?.ok, true);
    }

    const status = await api("/api/vault", { cookie });
    assert.equal(status.json?.unlocked, true);
    assert.equal(status.json?.entryCount, FIXTURES.length);
  });

  test("GET /api/vault/entries returns metadata only — no ciphertext material", async () => {
    const res = await api("/api/vault/entries", { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json?.unlocked, true);
    assert.equal(res.json?.entries?.length, FIXTURES.length);
    assertNoKeysAnywhere(res.json, ["value", "encrypted_value", "salt", "iv", "tag"], "GET /api/vault/entries");
    for (const f of FIXTURES) {
      const found = res.json.entries.find((e) => e.name === f.name);
      assert.ok(found, `entry ${f.name} is listed`);
      assert.equal(found.label, f.label);
      assert.equal(found.category, f.category);
    }
  });

  test("locking clears the in-memory password and hides the entry count", async () => {
    wildcardToken = (await issueRawToken(cookie, "e2e-lifecycle-wildcard", ["*"])).raw;

    await lockVault(cookie);
    const status = await api("/api/vault", { cookie });
    assert.equal(status.json?.unlocked, false);
    assert.equal(status.json?.entryCount, null);
  });

  test("a locked vault rejects a wrong master password via the anchored verifier", async () => {
    const res = await api("/api/vault", {
      method: "POST", cookie, body: { action: "unlock", password: `${vaultPassword()}-wrong` },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json?.error, "Incorrect password");

    const stillLocked = await api("/api/vault", { cookie });
    assert.equal(stillLocked.json?.unlocked, false);
  });

  test("REGRESSION: the FIRST read-with-token after an unlock succeeds", async () => {
    // The handoff records that `next dev` re-evaluates vault.js per request and
    // drops the master password, so the first read after an unlock answered
    // "Vault is locked". A production build must not do that.
    const locked = await readWithToken(wildcardToken, FIXTURES[0].name);
    assert.equal(locked.status, 401, "sanity: still locked before the unlock");
    assert.equal(locked.json?.error, "Vault is locked");

    await unlockVault(cookie);

    const first = await readWithToken(wildcardToken, FIXTURES[0].name);
    assert.equal(first.status, 200, "first read after unlock must not be 401");
    assert.equal(first.json?.ok, true);
    assert.equal(first.json?.error, undefined);
    // Compare as a boolean so a failure never prints the plaintext.
    assert.equal(first.json?.value === fixtureValue(FIXTURES[0].name), true, "value round-trips");
  });
});
