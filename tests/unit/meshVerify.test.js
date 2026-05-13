/**
 * Unit tests for src/lib/meshVerify.js
 *
 * Generates a real Ed25519 keypair, replicates the digest the Rust sidecar
 * computes (SHA256 of request_body || \x00 || nonce || \x00 || response_body),
 * signs it, and confirms the verifier accepts the good case and rejects the
 * tampered cases.
 *
 * No network, no DB.
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyMeshResponse } from "../../src/lib/meshVerify.js";

function sidecarStyleDigest({ requestBody, nonce, responseBody }) {
  const h = crypto.createHash("sha256");
  h.update(Buffer.from(requestBody, "utf8"));
  h.update(Buffer.from([0]));
  h.update(Buffer.from(nonce, "utf8"));
  h.update(Buffer.from([0]));
  h.update(responseBody);
  return h.digest();
}

function rawPubkeyFromKeyObject(keyObject) {
  const jwk = keyObject.export({ format: "jwk" });
  // base64url without padding → Buffer
  const padded = jwk.x + "=".repeat((4 - (jwk.x.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function b64(buf) { return Buffer.from(buf).toString("base64"); }

function signedResponseFixture(requestBody, nonce, responseBody) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const digest = sidecarStyleDigest({ requestBody, nonce, responseBody });
  const signature = crypto.sign(null, digest, privateKey);
  const rawPub = rawPubkeyFromKeyObject(publicKey);
  return {
    responseHeaders: {
      "X-Zippy-Signature": b64(signature),
      "X-Zippy-Pubkey": b64(rawPub),
      "X-Zippy-Request-Digest": b64(digest),
    },
    responseBody,
  };
}

describe("verifyMeshResponse", () => {
  const requestBody = JSON.stringify({ model: "p2p/llama3", messages: [{ role: "user", content: "hi" }] });
  const nonce = "abc-123";
  const responseBody = Buffer.from(
    JSON.stringify({ id: "chatcmpl-1", choices: [{ message: { content: "hello" } }], usage: { total_tokens: 5 } }),
  );

  it("accepts a correctly signed response", () => {
    const fx = signedResponseFixture(requestBody, nonce, responseBody);
    const verdict = verifyMeshResponse({ requestBody, nonce, responseBody: fx.responseBody, responseHeaders: fx.responseHeaders });
    expect(verdict.status).toBe("valid");
  });

  it("flags tampered response body as invalid", () => {
    const fx = signedResponseFixture(requestBody, nonce, responseBody);
    const tampered = Buffer.from(responseBody.toString("utf8").replace("hello", "goodbye"));
    const verdict = verifyMeshResponse({ requestBody, nonce, responseBody: tampered, responseHeaders: fx.responseHeaders });
    expect(verdict.status).toBe("invalid");
  });

  it("flags a mismatched nonce as invalid", () => {
    const fx = signedResponseFixture(requestBody, nonce, responseBody);
    const verdict = verifyMeshResponse({ requestBody, nonce: "different-nonce", responseBody: fx.responseBody, responseHeaders: fx.responseHeaders });
    expect(verdict.status).toBe("invalid");
  });

  it("flags a mismatched request body as invalid", () => {
    const fx = signedResponseFixture(requestBody, nonce, responseBody);
    const otherRequest = JSON.stringify({ model: "p2p/llama3", messages: [{ role: "user", content: "something else" }] });
    const verdict = verifyMeshResponse({ requestBody: otherRequest, nonce, responseBody: fx.responseBody, responseHeaders: fx.responseHeaders });
    expect(verdict.status).toBe("invalid");
  });

  it("returns 'missing' when headers are absent", () => {
    const verdict = verifyMeshResponse({ requestBody, nonce, responseBody, responseHeaders: {} });
    expect(verdict.status).toBe("missing");
  });

  it("returns 'invalid' when signature is malformed", () => {
    const fx = signedResponseFixture(requestBody, nonce, responseBody);
    fx.responseHeaders["X-Zippy-Signature"] = "not-base64-valid-signature";
    const verdict = verifyMeshResponse({ requestBody, nonce, responseBody: fx.responseBody, responseHeaders: fx.responseHeaders });
    expect(verdict.status).toBe("invalid");
  });

  it("rejects when another party tries to substitute their own pubkey over the same signature", () => {
    // Attacker can't forge a sig for a given body without the real private key.
    const fx = signedResponseFixture(requestBody, nonce, responseBody);
    const { publicKey: impostorPub } = crypto.generateKeyPairSync("ed25519");
    fx.responseHeaders["X-Zippy-Pubkey"] = b64(rawPubkeyFromKeyObject(impostorPub));
    const verdict = verifyMeshResponse({ requestBody, nonce, responseBody: fx.responseBody, responseHeaders: fx.responseHeaders });
    expect(verdict.status).toBe("invalid");
  });
});
