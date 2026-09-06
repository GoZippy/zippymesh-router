/**
 * A locked vault must answer 401 "Vault is locked" and must NOT spend the
 * peer's 30-per-minute auth-failure budget. Otherwise one agent polling a
 * locked vault would lock every other caller on the box out.
 *
 * Proof: 35 reads with a VALID token against a locked vault (more than the
 * 30-failure budget) all come back 401-locked and none is 429; a subsequent
 * BAD token still gets its ordinary 401 instead of the pre-lookup 429.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  FIXTURE_NAMES, bootstrapVault, issueRawToken, readWithToken, listWithToken,
  lockVault, unlockVault,
} from "../_helpers.mjs";

const LOCKED_ATTEMPTS = 35;               // > VAULT_AUTH_FAIL_RATE_LIMIT_MAX (30)

describe("a locked vault does not consume the auth-fail budget", () => {
  let cookie, token;

  before(async () => {
    ({ cookie } = await bootstrapVault());
    token = (await issueRawToken(cookie, "e2e-locked-probe", ["*"])).raw;
    const warm = await readWithToken(token, FIXTURE_NAMES[0]);
    assert.equal(warm.status, 200, "token works while unlocked");
    await lockVault(cookie);
  });

  after(async () => { await unlockVault(cookie); });

  test(`${LOCKED_ATTEMPTS} reads against a locked vault are all 401 "Vault is locked"`, async () => {
    const statuses = [];
    const errors = new Set();
    for (let i = 0; i < LOCKED_ATTEMPTS; i++) {
      const res = await readWithToken(token, FIXTURE_NAMES[0]);
      statuses.push(res.status);
      errors.add(res.json?.error);
      assert.equal(res.json?.value, undefined, `attempt ${i + 1} returned no value`);
    }
    assert.equal(statuses.length, LOCKED_ATTEMPTS);
    assert.equal(statuses.every((s) => s === 401), true, `saw statuses ${[...new Set(statuses)].join(",")}`);
    assert.equal(statuses.includes(429), false, "a locked vault never rate-limits the caller");
    assert.deepEqual([...errors], ["Vault is locked"], "the exact text the Kiro Crew bridge matches on");
  });

  test("list-with-token still works while locked and reports unlocked:false", async () => {
    const { raw } = await issueRawToken(cookie, "e2e-locked-list", ["*"]);

    const list = await listWithToken(raw);
    assert.equal(list.status, 200, "metadata is stored in the clear");
    assert.equal(list.json.unlocked, false, "the caller is told a read would fail");
    assert.equal(list.json.entries.length > 0, true);

    const read = await readWithToken(raw, FIXTURE_NAMES[0]);
    assert.equal(read.status, 401);
    assert.equal(read.json.error, "Vault is locked");
  });

  test("after all those locked answers a BAD token still gets 401, not 429", async () => {
    const res = await readWithToken("definitely-not-a-token", FIXTURE_NAMES[0]);
    assert.equal(res.status, 401, "the auth-fail budget was untouched by the locked answers");
    assert.equal(res.json.error, "Invalid token");
    assert.equal(res.headers.get("retry-after"), null, "no Retry-After on a plain 401");
  });

  test("unlocking restores reads immediately", async () => {
    await unlockVault(cookie);
    const res = await readWithToken(token, FIXTURE_NAMES[0]);
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });
});
