/**
 * TRUST_PROXY=1: the vault limiter keys its buckets on the proxied client
 * address (first x-forwarded-for entry, then x-real-ip) instead of the single
 * "direct" peer. Two callers behind the trusted proxy therefore get separate
 * auth-failure budgets — one noisy client can no longer lock the box out.
 *
 * Runs in the "proxy" pass, which the runner starts with --env TRUST_PROXY=1
 * on its own server and DATA_DIR. Compare with the "authfail" pass, which
 * asserts the shared-"direct"-peer behaviour when TRUST_PROXY is unset.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_NAMES, bootstrapVault, issueRawToken, readWithToken, listWithToken } from "../_helpers.mjs";

const BUDGET = 30;
const PEER_A = "198.51.100.10";
const PEER_B = "198.51.100.20";
const PEER_C = "198.51.100.30";

const asPeer = (ip) => ({ headers: { "x-forwarded-for": ip } });

describe("TRUST_PROXY=1 gives each proxied client its own bucket", () => {
  let cookie, token;

  before(async () => {
    assert.equal(process.env.ZMLR_E2E_SUITE, "proxy", "this file must run in the TRUST_PROXY=1 pass");
    ({ cookie } = await bootstrapVault());
    token = (await issueRawToken(cookie, "e2e-proxy-token", ["*"])).raw;
  });

  test("peer A can spend its whole budget on bad tokens", async () => {
    const statuses = [];
    for (let i = 0; i < BUDGET; i++) {
      const res = await readWithToken(`e2e-proxy-guess-${i}`, FIXTURE_NAMES[0], asPeer(PEER_A));
      statuses.push(res.status);
    }
    assert.equal(statuses.every((s) => s === 401), true, `saw statuses ${[...new Set(statuses)].join(",")}`);

    const over = await readWithToken("e2e-proxy-guess-overflow", FIXTURE_NAMES[0], asPeer(PEER_A));
    assert.equal(over.status, 429, "peer A is now refused before lookup");
    assert.match(over.headers.get("retry-after") ?? "", /^\d+$/);
  });

  test("peer A is blocked even with a VALID token", async () => {
    const res = await readWithToken(token, FIXTURE_NAMES[0], asPeer(PEER_A));
    assert.equal(res.status, 429);
    assert.equal(res.json.value, undefined);
  });

  test("peer B is untouched: a bad token gets a plain 401 and a good one 200", async () => {
    const bad = await readWithToken("e2e-proxy-b-bad", FIXTURE_NAMES[0], asPeer(PEER_B));
    assert.equal(bad.status, 401, "peer B has its own auth-fail budget");
    assert.equal(bad.json.error, "Invalid token");
    assert.equal(bad.headers.get("retry-after"), null);

    const good = await readWithToken(token, FIXTURE_NAMES[0], asPeer(PEER_B));
    assert.equal(good.status, 200, "peer B can still read");
    assert.equal(good.json.ok, true);

    const list = await listWithToken(token, asPeer(PEER_B));
    assert.equal(list.status, 200);
    assert.equal(list.json.ok, true);
  });

  test("only the FIRST x-forwarded-for entry identifies the peer", async () => {
    const chained = await readWithToken(token, FIXTURE_NAMES[0], asPeer(`${PEER_A}, 10.1.1.1, 10.2.2.2`));
    assert.equal(chained.status, 429, "a chain starting at peer A is peer A");

    const otherChain = await readWithToken(token, FIXTURE_NAMES[0], asPeer(`${PEER_C}, ${PEER_A}`));
    assert.equal(otherChain.status, 200, "a chain starting at peer C is peer C, not peer A");
  });

  test("a caller sending no proxy headers has its own bucket and is unaffected by peer A", async () => {
    const res = await readWithToken(token, FIXTURE_NAMES[0]);
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  /**
   * Documents measured behaviour, not the module comment: Next injects
   * `x-forwarded-for: <socket address>` (127.0.0.1 here) on every request that
   * arrives without one, so peerKey()'s `x-real-ip` and `"direct"` fallbacks are
   * unreachable under TRUST_PROXY=1. Consequence for operators: a reverse proxy
   * that sets ONLY X-Real-IP puts every client in one bucket (the proxy's own
   * address). See docs/_internal/E2E_VAULT_TOKENS_2026-08-30.md, finding F1.
   */
  test("x-real-ip does not select the peer — Next injects x-forwarded-for", async () => {
    const statuses = [];
    for (let i = 0; i < BUDGET; i++) {
      statuses.push((await readWithToken(`e2e-noheader-guess-${i}`, FIXTURE_NAMES[0])).status);
    }
    assert.equal(statuses.every((s) => s === 401), true, `saw statuses ${[...new Set(statuses)].join(",")}`);

    const over = await readWithToken("e2e-noheader-overflow", FIXTURE_NAMES[0]);
    assert.equal(over.status, 429, "header-less callers do share one bucket");

    const realIpOnly = await readWithToken(token, FIXTURE_NAMES[0], { headers: { "x-real-ip": "203.0.113.99" } });
    assert.equal(realIpOnly.status, 429, "x-real-ip is never consulted: the injected x-forwarded-for wins");

    const asInjected = await readWithToken(token, FIXTURE_NAMES[0], asPeer("127.0.0.1"));
    assert.equal(asInjected.status, 429, "the injected value is the loopback socket address");

    const realProxiedClient = await readWithToken(token, FIXTURE_NAMES[0], asPeer(PEER_B));
    assert.equal(realProxiedClient.status, 200, "a genuinely proxied client still gets its own bucket");
  });
});
