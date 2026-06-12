/**
 * Verify Ed25519 signatures on mesh inference responses.
 *
 * The sidecar (sidecar/src/main.rs proxy_chat) signs
 *   SHA256(request_body || \x00 || nonce || \x00 || response_body)
 * with a persistent Ed25519 key. The signature, pubkey, and digest are
 * returned in response headers so the paying peer can detect tampering.
 *
 * This module runs server-side (Node crypto). Keep it pure — no network,
 * no DB — so the caller can decide what to do with an invalid result.
 */

import crypto from "crypto";

/**
 * Verdict shape: { status, reason? }
 *   status: "valid" | "invalid" | "missing" | "error"
 *   reason: human-readable detail (for logs / debug headers)
 */

/**
 * Decode base64 (standard, with padding) to a Buffer.
 * Returns null if the input is not valid base64 of the expected length.
 */
function decodeBase64(str, expectedLen) {
  if (typeof str !== "string" || str.length === 0) return null;
  let buf;
  try { buf = Buffer.from(str, "base64"); } catch { return null; }
  if (typeof expectedLen === "number" && buf.length !== expectedLen) return null;
  return buf;
}

/**
 * Convert a raw 32-byte Ed25519 public key into a Node KeyObject.
 * Uses JWK format, which Node 18+ supports natively for Ed25519.
 */
function rawToEd25519PublicKey(rawBytes) {
  // base64url without padding
  const x = rawBytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return crypto.createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x },
    format: "jwk",
  });
}

/**
 * Verify a sidecar mesh response signature.
 *
 * @param {object} params
 * @param {string} params.requestBody  — the exact UTF-8 request string that was POSTed to the sidecar
 * @param {string} [params.nonce]      — value of X-Zippy-Nonce that was sent with the request (empty string if none)
 * @param {Buffer|Uint8Array} params.responseBody  — the raw response body bytes
 * @param {Headers|object} params.responseHeaders  — fetch Headers or a plain object
 * @returns {{status: "valid"|"invalid"|"missing"|"error", reason?: string}}
 */
export function verifyMeshResponse({ requestBody, nonce = "", responseBody, responseHeaders }) {
  const getHeader = (name) => {
    if (!responseHeaders) return null;
    if (typeof responseHeaders.get === "function") return responseHeaders.get(name);
    const lower = name.toLowerCase();
    for (const k of Object.keys(responseHeaders)) {
      if (k.toLowerCase() === lower) return responseHeaders[k];
    }
    return null;
  };

  const sigB64 = getHeader("X-Zippy-Signature");
  const pubkeyB64 = getHeader("X-Zippy-Pubkey");
  const digestB64 = getHeader("X-Zippy-Request-Digest");

  if (!sigB64 || !pubkeyB64) {
    return { status: "missing", reason: "response lacks signature or pubkey" };
  }

  const signature = decodeBase64(sigB64, 64);
  const pubkeyBytes = decodeBase64(pubkeyB64, 32);
  if (!signature || !pubkeyBytes) {
    return { status: "invalid", reason: "malformed signature or pubkey" };
  }

  // Recompute the digest the sidecar claims it signed.
  const hasher = crypto.createHash("sha256");
  hasher.update(Buffer.from(requestBody, "utf8"));
  hasher.update(Buffer.from([0]));
  hasher.update(Buffer.from(nonce || "", "utf8"));
  hasher.update(Buffer.from([0]));
  hasher.update(Buffer.isBuffer(responseBody) ? responseBody : Buffer.from(responseBody));
  const expectedDigest = hasher.digest();

  // The sidecar also sends what it thinks it signed. Cross-check so we get a
  // clearer failure mode if body bytes diverged in transit (e.g. a proxy
  // re-serialized the JSON) vs. a real signature forgery.
  if (digestB64) {
    const advertisedDigest = decodeBase64(digestB64, 32);
    if (!advertisedDigest || !advertisedDigest.equals(expectedDigest)) {
      return {
        status: "invalid",
        reason: "response body differs from what the node says it signed",
      };
    }
  }

  let pubkey;
  try {
    pubkey = rawToEd25519PublicKey(pubkeyBytes);
  } catch (e) {
    return { status: "error", reason: `pubkey import failed: ${e.message}` };
  }

  let ok;
  try {
    // Ed25519 in Node: pass null algorithm; the key type determines it.
    ok = crypto.verify(null, expectedDigest, pubkey, signature);
  } catch (e) {
    return { status: "error", reason: `verify threw: ${e.message}` };
  }

  return ok
    ? { status: "valid" }
    : { status: "invalid", reason: "signature does not match digest" };
}
