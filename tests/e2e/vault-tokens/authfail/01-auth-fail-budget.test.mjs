/**
 * The per-peer auth-failure budget: 30 token 401/403 answers per minute
 * (VAULT_AUTH_FAIL_RATE_LIMIT_MAX). Once exhausted the peer is refused BEFORE
 * any token lookup — which is what stops a guesser who presents a fresh
 * fingerprint (and therefore a fresh per-token bucket) on every attempt.
 *
 * This file owns its whole server pass ("authfail"): it deliberately exhausts
 * the one in-memory bucket for the peer, and once exhausted every vault token
 * request from that peer is refused for the rest of the 60s window. Nothing
 * else may share the process.
 *
 * TRUST_PROXY is unset in this pass, so every caller — whatever it puts in
 * x-forwarded-for — is the single "direct" peer. That is asserted here; the
 * "proxy" pass asserts the opposite with TRUST_PROXY=1.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_NAMES, bootstrapVault, issueRawToken, readWithToken, listWithToken } from "../_helpers.mjs";

const BUDGET = 30;

describe("per-peer auth-failure budget (TRUST_PROXY unset)", () => {
  let cookie, goodToken;
  const statuses = [];

  before(async () => {
    ({ cookie } = await bootstrapVault());
    goodToken = (await issueRawToken(cookie, "e2e-budget-good", ["*"])).raw;

    const warm = await readWithToken(goodToken, FIXTURE_NAMES[0]);
    assert.equal(warm.status, 200, "a good token works before the budget is spent");
    assert.equal(warm.headers.get("retry-after"), null, "a 200 carries no Retry-After");
  });

  test(`${BUDGET} distinct bad tokens each get their own 401`, async () => {
    for (let i = 0; i < BUDGET; i++) {
      // A fresh token per attempt => a fresh per-token bucket, so only the
      // auth-fail budget can ever slow this loop down.
      const res = await readWithToken(`e2e-guess-${i}-${"0".repeat(40)}`, FIXTURE_NAMES[0]);
      statuses.push(res.status);
      assert.equal(res.json?.value, undefined, `guess ${i} returned no value`);
    }
    assert.equal(statuses.length, BUDGET);
    assert.equal(statuses.every((s) => s === 401), true, `saw statuses ${[...new Set(statuses)].join(",")}`);
  });

  test(`attempt ${BUDGET + 1} is refused 429 before any lookup`, async () => {
    const res = await readWithToken(`e2e-guess-overflow-${"0".repeat(40)}`, FIXTURE_NAMES[0]);
    assert.equal(res.status, 429);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error, "Rate limit exceeded. Try again shortly.");
    assert.notEqual(res.json.error, "Invalid token", "the refusal happens before verification");
    assert.match(res.headers.get("retry-after") ?? "", /^\d+$/);
    assert.ok(Number(res.headers.get("retry-after")) >= 1);
  });

  test("a VALID token from the same peer is refused too — the budget is per peer", async () => {
    const res = await readWithToken(goodToken, FIXTURE_NAMES[0]);
    assert.equal(res.status, 429, "the peer is blocked, not the token");
    assert.equal(res.json.value, undefined, "no value escapes a throttled request");

    const list = await listWithToken(goodToken);
    assert.equal(list.status, 429, "both token routes share the peer budget");
  });

  test("without TRUST_PROXY a forged x-forwarded-for cannot buy a fresh bucket", async () => {
    for (const forged of ["203.0.113.1", "10.9.9.9, 172.16.0.1", "not-an-ip"]) {
      const res = await readWithToken(goodToken, FIXTURE_NAMES[0], { headers: { "x-forwarded-for": forged } });
      assert.equal(res.status, 429, `x-forwarded-for: ${forged} still maps to the "direct" peer`);
    }
    const viaRealIp = await readWithToken(goodToken, FIXTURE_NAMES[0], { headers: { "x-real-ip": "203.0.113.55" } });
    assert.equal(viaRealIp.status, 429, "x-real-ip is ignored too");
  });

  test("a 400 is still answered while the peer is throttled (validation runs first)", async () => {
    const res = await readWithToken(goodToken, undefined);
    assert.equal(res.status, 400, "body validation precedes the limiter");
    assert.equal(res.json.error, "entry is required");
  });
});
