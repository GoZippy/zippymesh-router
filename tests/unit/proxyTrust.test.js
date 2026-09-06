/**
 * src/lib/net/proxyTrust.js — the single proxy-trust decision.
 *
 * The property under test is not "parses x-forwarded-for correctly" but
 * "cannot be talked into believing an address it was not given by trusted
 * infrastructure". Every case below sends headers a hostile caller could send
 * and asserts the module still reports DIRECT_PEER / not-known.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isTrustedProxy,
  clientPeer,
  isKnownPeer,
  DIRECT_PEER,
} from "../../src/lib/net/proxyTrust.js";

/** Minimal Request stand-in: only `headers.get` is used. */
function req(headers = {}) {
  const h = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { headers: { get: (k) => h[k.toLowerCase()] ?? null } };
}

const ORIGINAL = process.env.TRUST_PROXY;

beforeEach(() => { delete process.env.TRUST_PROXY; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = ORIGINAL;
});

describe("isTrustedProxy", () => {
  it("is false when TRUST_PROXY is unset — proxy trust is opt-in", () => {
    expect(isTrustedProxy()).toBe(false);
  });

  it("accepts 1 / true in any case, with surrounding whitespace", () => {
    for (const v of ["1", "true", "TRUE", "True", " true ", "\t1\n"]) {
      process.env.TRUST_PROXY = v;
      expect(isTrustedProxy(), `TRUST_PROXY=${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("rejects every other value rather than treating it as truthy", () => {
    for (const v of ["0", "false", "no", "yes", "on", "", "2", "trueish", "null", "undefined"]) {
      process.env.TRUST_PROXY = v;
      expect(isTrustedProxy(), `TRUST_PROXY=${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("is read per call, not captured at import", () => {
    expect(isTrustedProxy()).toBe(false);
    process.env.TRUST_PROXY = "1";
    expect(isTrustedProxy()).toBe(true);
    delete process.env.TRUST_PROXY;
    expect(isTrustedProxy()).toBe(false);
  });
});

describe("clientPeer without a trusted proxy", () => {
  it("is DIRECT_PEER no matter what the caller claims", () => {
    const hostile = [
      { "x-real-ip": "127.0.0.1" },
      { "x-real-ip": "10.0.0.5" },
      { "x-real-ip": "::1" },
      { "x-forwarded-for": "127.0.0.1" },
      { "x-forwarded-for": "10.0.0.5, 203.0.113.1" },
      { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" },
      { "remote_addr": "127.0.0.1" },
      { "x-real-ip": "127.0.0.1", "x-forwarded-for": "127.0.0.1", "remote_addr": "127.0.0.1" },
    ];
    for (const headers of hostile) {
      expect(clientPeer(req(headers)), JSON.stringify(headers)).toBe(DIRECT_PEER);
    }
  });

  it("is DIRECT_PEER for a request with no headers at all", () => {
    expect(clientPeer(req())).toBe(DIRECT_PEER);
  });

  it("DIRECT_PEER is the literal 'direct' and is not IP-shaped", () => {
    expect(DIRECT_PEER).toBe("direct");
    expect(DIRECT_PEER).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(DIRECT_PEER).not.toContain(":");
  });
});

describe("clientPeer with TRUST_PROXY=1", () => {
  beforeEach(() => { process.env.TRUST_PROXY = "1"; });

  it("takes the first hop of x-forwarded-for — the original client", () => {
    expect(clientPeer(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" })))
      .toBe("203.0.113.9");
  });

  it("trims whitespace around the first hop", () => {
    expect(clientPeer(req({ "x-forwarded-for": "  203.0.113.9  , 10.0.0.1" })))
      .toBe("203.0.113.9");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent or empty", () => {
    expect(clientPeer(req({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientPeer(req({ "x-forwarded-for": "", "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientPeer(req({ "x-forwarded-for": "  ", "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    expect(clientPeer(req({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.1" })))
      .toBe("203.0.113.9");
  });

  it("is still DIRECT_PEER when the proxy sent no address headers", () => {
    expect(clientPeer(req())).toBe(DIRECT_PEER);
    expect(clientPeer(req({ "x-forwarded-for": "" }))).toBe(DIRECT_PEER);
  });
});

describe("isKnownPeer", () => {
  it("is false for every peer while TRUST_PROXY is unset", () => {
    expect(isKnownPeer(DIRECT_PEER)).toBe(false);
    // Even if a caller somehow hands it a real-looking address, the absence of
    // a declared proxy means no address can be believed.
    expect(isKnownPeer("127.0.0.1")).toBe(false);
    expect(isKnownPeer("10.0.0.5")).toBe(false);
  });

  it("with a trusted proxy, is true for an address and false for DIRECT_PEER", () => {
    process.env.TRUST_PROXY = "1";
    expect(isKnownPeer("203.0.113.9")).toBe(true);
    expect(isKnownPeer("10.0.0.5")).toBe(true);
    expect(isKnownPeer(DIRECT_PEER)).toBe(false);
    expect(isKnownPeer("")).toBe(false);
    expect(isKnownPeer(null)).toBe(false);
    expect(isKnownPeer(undefined)).toBe(false);
  });

  it("agrees with clientPeer end to end", () => {
    expect(isKnownPeer(clientPeer(req({ "x-real-ip": "127.0.0.1" })))).toBe(false);
    process.env.TRUST_PROXY = "1";
    expect(isKnownPeer(clientPeer(req({ "x-real-ip": "127.0.0.1" })))).toBe(true);
    expect(isKnownPeer(clientPeer(req()))).toBe(false);
  });
});

describe("vaultRateLimit re-exports the same decision", () => {
  it("peerKey and isTrustedProxy are the proxyTrust implementations", async () => {
    const rl = await import("../../src/lib/vaultRateLimit.js");
    expect(rl.isTrustedProxy).toBe(isTrustedProxy);
    expect(rl.peerKey).toBe(clientPeer);
    // and therefore behave identically
    expect(rl.peerKey(req({ "x-forwarded-for": "10.1.1.1" }))).toBe(DIRECT_PEER);
    process.env.TRUST_PROXY = "1";
    expect(rl.peerKey(req({ "x-forwarded-for": "10.1.1.1" }))).toBe("10.1.1.1");
  });
});
