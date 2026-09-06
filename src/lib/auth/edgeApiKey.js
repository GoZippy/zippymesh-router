/**
 * Edge-safe, STATELESS verification of router API keys (security fix F3).
 *
 * The Next.js edge middleware cannot reach the database, so it previously
 * accepted ANY `Bearer` token of length >= 20 as valid — a trivial auth bypass
 * for management APIs. New-format router keys are self-verifying though:
 *
 *     sk-{machineId}-{keyId}-{crc8}
 *
 * where crc8 = HMAC-SHA256(machineId + keyId, API_KEY_SECRET).slice(0, 8)
 * (see src/shared/utils/apiKey.js generateCrc). That HMAC can be checked
 * cryptographically with Web Crypto — which IS available in the edge runtime —
 * with NO database lookup. An attacker cannot forge a valid crc without the
 * secret, so junk/length-only tokens are rejected.
 *
 * This module uses ONLY Web Crypto (globalThis.crypto.subtle) + TextEncoder, so
 * it is safe to import from edge middleware. Do NOT add Node-only imports here.
 *
 * NOTE: this verifies key AUTHENTICITY (HMAC), not REVOCATION. A
 * cryptographically valid but revoked/blacklisted key is still rejected at the
 * route layer (DB-backed). The edge check exists only to stop forged tokens.
 */

/** Hex-encode an ArrayBuffer/Uint8Array. */
function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** HMAC-SHA256(message) -> lowercase hex, using Web Crypto. */
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

/** Constant-time string compare (equal length only). */
function timingSafeStrEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify a router API key string statelessly (HMAC crc only).
 *
 * Only NEW-format keys (sk-{machineId}-{keyId}-{crc8}) can be verified without a
 * DB; old-format keys (sk-{random8}) and anything else are rejected here and
 * must fall back to session-cookie auth. Fails closed when no secret is set.
 *
 * @param {string} token  the raw key (no "Bearer " prefix)
 * @param {string} [secret] HMAC secret; defaults to process.env.API_KEY_SECRET
 * @returns {Promise<boolean>}
 */
export async function verifyRouterApiKeyStateless(token, secret = process.env.API_KEY_SECRET) {
  if (!token || typeof token !== "string") return false;
  if (!secret || typeof secret !== "string") return false; // fail closed: no secret => no edge bypass
  if (!token.startsWith("sk-")) return false;

  const parts = token.split("-");
  // Require the new self-verifying format: sk, machineId, keyId, crc8.
  if (parts.length !== 4) return false;
  const [, machineId, keyId, crc] = parts;
  if (!machineId || !keyId || !crc || crc.length !== 8) return false;

  let expected;
  try {
    expected = (await hmacSha256Hex(secret, machineId + keyId)).slice(0, 8);
  } catch {
    return false; // any crypto failure => fail closed
  }
  return timingSafeStrEqual(crc, expected);
}

/**
 * Convenience: extract a Bearer token from an Authorization header and verify it.
 * Returns false for missing/non-Bearer headers.
 *
 * @param {string|null|undefined} authHeader
 * @returns {Promise<boolean>}
 */
export async function verifyBearerApiKey(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return false;
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  return verifyRouterApiKeyStateless(token);
}
