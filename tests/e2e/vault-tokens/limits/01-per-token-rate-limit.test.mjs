/**
 * Per-token rate limit: 60 requests per minute per presented token
 * (src/lib/vaultRateLimit.js, VAULT_TOKEN_RATE_LIMIT_MAX).
 *
 * This file deliberately exhausts one token's window. It runs in the "limits"
 * pass, which gets its own server process and DATA_DIR so the in-memory
 * windows it fills cannot affect any other suite.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_NAMES, bootstrapVault, issueRawToken, readWithToken, listWithToken } from "../_helpers.mjs";

const MAX = 60;

describe("per-token rate limit", () => {
  let cookie, token, other;

  before(async () => {
    ({ cookie } = await bootstrapVault());
    token = (await issueRawToken(cookie, "e2e-rate-subject", ["*"])).raw;
    other = (await issueRawToken(cookie, "e2e-rate-bystander", ["*"])).raw;
  });

  test(`the first ${MAX} reads with one token all succeed`, async () => {
    const statuses = [];
    for (let i = 0; i < MAX; i++) {
      const res = await readWithToken(token, FIXTURE_NAMES[0]);
      statuses.push(res.status);
    }
    assert.equal(statuses.length, MAX);
    assert.equal(statuses.every((s) => s === 200), true, `saw non-200 statuses: ${[...new Set(statuses)].join(",")}`);
  });

  test(`request ${MAX + 1} is 429 with an integer Retry-After of at least 1 second`, async () => {
    const res = await readWithToken(token, FIXTURE_NAMES[0]);
    assert.equal(res.status, 429);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error, "Rate limit exceeded. Try again shortly.");
    assert.equal(res.json.value, undefined, "a throttled read returns no value");

    const retryAfter = res.headers.get("retry-after");
    assert.notEqual(retryAfter, null, "Retry-After header is present");
    assert.match(retryAfter, /^\d+$/, "Retry-After is an integer number of seconds");
    const seconds = Number(retryAfter);
    assert.ok(seconds >= 1, "Retry-After >= 1");
    assert.ok(seconds <= 60, "Retry-After <= the 60s window");
  });

  test("the limit follows the TOKEN, not the route: list-with-token is throttled too", async () => {
    const res = await listWithToken(token);
    assert.equal(res.status, 429, "the same token shares one bucket across both routes");
    assert.match(res.headers.get("retry-after") ?? "", /^\d+$/);
  });

  test("a different token from the same peer is unaffected", async () => {
    const read = await readWithToken(other, FIXTURE_NAMES[0]);
    assert.equal(read.status, 200, "the bucket is per token, not per peer");
    assert.equal(read.json.ok, true);

    const list = await listWithToken(other);
    assert.equal(list.status, 200);
    assert.equal(list.json.ok, true);
  });
});
