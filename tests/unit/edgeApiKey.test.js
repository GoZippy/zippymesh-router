/**
 * Tests for the edge-safe stateless router-API-key verifier (security fix F3).
 *
 * The production key format (src/shared/utils/apiKey.js) is
 *   sk-{machineId}-{keyId}-{crc8}, crc8 = HMAC-SHA256(machineId+keyId, secret).slice(0,8)
 * We generate a valid key with Node crypto (mirroring generateCrc) and assert
 * the Web-Crypto verifier accepts it, and rejects everything else.
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyRouterApiKeyStateless, verifyBearerApiKey } from "../../src/lib/auth/edgeApiKey.js";

const SECRET = "test-api-key-secret-abc123";

function crc(machineId, keyId, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(machineId + keyId).digest("hex").slice(0, 8);
}
function makeKey(machineId, keyId, secret = SECRET) {
  return `sk-${machineId}-${keyId}-${crc(machineId, keyId, secret)}`;
}

describe("verifyRouterApiKeyStateless — F3 edge key verification", () => {
  it("accepts a genuine new-format key (HMAC crc matches)", async () => {
    const key = makeKey("1234567890abcdef", "ab12cd");
    expect(await verifyRouterApiKeyStateless(key, SECRET)).toBe(true);
  });

  it("rejects a key with a tampered crc", async () => {
    const key = makeKey("1234567890abcdef", "ab12cd");
    const bad = key.slice(0, -1) + (key.endsWith("0") ? "1" : "0");
    expect(await verifyRouterApiKeyStateless(bad, SECRET)).toBe(false);
  });

  it("rejects a key minted with a DIFFERENT secret (forgery without API_KEY_SECRET)", async () => {
    const forged = makeKey("1234567890abcdef", "ab12cd", "attacker-secret");
    expect(await verifyRouterApiKeyStateless(forged, SECRET)).toBe(false);
  });

  it("rejects the old length-only bypass: any 20+ char junk token", async () => {
    expect(await verifyRouterApiKeyStateless("aaaaaaaaaaaaaaaaaaaa", SECRET)).toBe(false); // 20 chars
    expect(await verifyRouterApiKeyStateless("Bearer-looking-but-not-a-key-xxxxxxxx", SECRET)).toBe(false);
  });

  it("rejects old-format keys (sk-{random8}) — cannot be verified statelessly", async () => {
    expect(await verifyRouterApiKeyStateless("sk-abcd1234", SECRET)).toBe(false);
  });

  it("rejects malformed / empty / non-string tokens", async () => {
    expect(await verifyRouterApiKeyStateless("", SECRET)).toBe(false);
    expect(await verifyRouterApiKeyStateless(null, SECRET)).toBe(false);
    expect(await verifyRouterApiKeyStateless(undefined, SECRET)).toBe(false);
    expect(await verifyRouterApiKeyStateless("sk-only-three", SECRET)).toBe(false);
    expect(await verifyRouterApiKeyStateless(`sk-m-k-${"x".repeat(8)}`, SECRET)).toBe(false);
  });

  it("fails closed when no secret is configured", async () => {
    const key = makeKey("1234567890abcdef", "ab12cd");
    expect(await verifyRouterApiKeyStateless(key, "")).toBe(false);
    expect(await verifyRouterApiKeyStateless(key, undefined)).toBe(false);
  });

  it("uses process.env.API_KEY_SECRET by default", async () => {
    const prev = process.env.API_KEY_SECRET;
    process.env.API_KEY_SECRET = SECRET;
    try {
      const key = makeKey("1234567890abcdef", "ab12cd");
      expect(await verifyRouterApiKeyStateless(key)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.API_KEY_SECRET;
      else process.env.API_KEY_SECRET = prev;
    }
  });
});

describe("verifyBearerApiKey — Authorization header extraction", () => {
  it("accepts a valid 'Bearer <key>' header", async () => {
    const prev = process.env.API_KEY_SECRET;
    process.env.API_KEY_SECRET = SECRET;
    try {
      const key = makeKey("1234567890abcdef", "ab12cd");
      expect(await verifyBearerApiKey(`Bearer ${key}`)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.API_KEY_SECRET;
      else process.env.API_KEY_SECRET = prev;
    }
  });

  it("rejects missing / non-Bearer / junk headers", async () => {
    expect(await verifyBearerApiKey(null)).toBe(false);
    expect(await verifyBearerApiKey("Basic abc")).toBe(false);
    expect(await verifyBearerApiKey("Bearer aaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});
