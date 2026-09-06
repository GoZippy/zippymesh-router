/**
 * ZippyVault-specific e2e helpers built on tests/e2e/_lib/client.mjs.
 *
 * Secret hygiene rules this file exists to enforce:
 *   - Fixture entry VALUES are derived from ZMLR_E2E_SECRET_SEED (set per pass
 *     by the runner) so every test file in a pass can recompute the expected
 *     plaintext without any file printing or logging it.
 *   - No helper here ever returns a value inside an assertion message; callers
 *     compare with a bare strictEqual on booleans, never on the secret itself.
 *   - `assertNoSecrets(text, secrets)` is the shared "must not appear anywhere
 *     in this response" check; it reports only WHICH labelled secret leaked.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { api, ensureSetup, login } from "../_lib/client.mjs";

export const READ_PATH = "/api/vault/read-with-token";
export const LIST_PATH = "/api/vault/list-with-token";
export const MCP_PATH = "/api/mcp";

/** The three fixture entries every suite stores. Names avoid the substrings the leak checks grep for. */
export const FIXTURES = [
  { name: "e2e-alpha", label: "Alpha Credential", category: "api-key", tags: ["e2e", "alpha"] },
  { name: "e2e-bravo", label: "Bravo Credential", category: "provider", tags: ["e2e"] },
  { name: "e2e-charlie", label: "Charlie Credential", category: "password", tags: [] },
];

export const FIXTURE_NAMES = FIXTURES.map((f) => f.name);
export const MISSING_ENTRY = "e2e-does-not-exist";

/** Vault master password for this pass. */
export function vaultPassword() {
  const v = process.env.ZMLR_E2E_VAULT_PASSWORD;
  if (!v) throw new Error("ZMLR_E2E_VAULT_PASSWORD is not set — run via scripts/e2e/run-standalone.mjs");
  return v;
}

/** Deterministic per-pass plaintext for a fixture entry. Never printed. */
export function fixtureValue(name) {
  const seed = process.env.ZMLR_E2E_SECRET_SEED;
  if (!seed) throw new Error("ZMLR_E2E_SECRET_SEED is not set — run via scripts/e2e/run-standalone.mjs");
  return createHash("sha256").update(`${seed}:${name}`).digest("hex");
}

/** SHA-256 hex of a raw agent token — what the server persists instead of the token. */
export function tokenSha256(rawToken) {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** The limiter-only 16-hex fingerprint of a token (src/lib/vaultRateLimit.js). Must never be returned. */
export function tokenFingerprint(rawToken) {
  return tokenSha256(rawToken).slice(0, 16);
}

/**
 * Bring the instance to the state every vault test needs:
 * setup done, logged in, vault unlocked, the three fixtures stored.
 * Idempotent — safe to call from every test file in a pass.
 *
 * @returns {Promise<{cookie: string}>}
 */
export async function bootstrapVault() {
  await ensureSetup();
  const cookie = await login();
  await unlockVault(cookie);
  for (const f of FIXTURES) {
    const res = await api("/api/vault/entries", {
      method: "POST",
      cookie,
      body: { name: f.name, value: fixtureValue(f.name), label: f.label, category: f.category, tags: f.tags },
    });
    assert.equal(res.status, 200, `storing fixture ${f.name} returned ${res.status}`);
  }
  return { cookie };
}

export async function unlockVault(cookie) {
  const res = await api("/api/vault", { method: "POST", cookie, body: { action: "unlock", password: vaultPassword() } });
  assert.equal(res.status, 200, `vault unlock returned ${res.status}`);
  assert.equal(res.json?.unlocked, true, "vault unlock did not report unlocked");
  return res;
}

export async function lockVault(cookie) {
  const res = await api("/api/vault", { method: "POST", cookie, body: { action: "lock" } });
  assert.equal(res.status, 200, `vault lock returned ${res.status}`);
  assert.equal(res.json?.unlocked, false, "vault lock did not report locked");
  return res;
}

/** Issue an agent token. Returns the POST result; caller asserts on it. */
export function issueToken(cookie, { name, scopes, expiresInMs } = {}) {
  const body = { name, scopes };
  if (expiresInMs !== undefined) body.expiresInMs = expiresInMs;
  return api("/api/vault/tokens", { method: "POST", cookie, body });
}

/** Issue a token and return only its raw value, failing the test if issuance failed. */
export async function issueRawToken(cookie, name, scopes, expiresInMs) {
  const res = await issueToken(cookie, { name, scopes, expiresInMs });
  assert.equal(res.status, 200, `issuing token "${name}" returned ${res.status}`);
  assert.equal(typeof res.json?.rawToken, "string", `issuing token "${name}" returned no rawToken`);
  return { raw: res.json.rawToken, id: res.json.tokenId, res };
}

/** POST /api/vault/read-with-token. `token`/`entry` are passed through untouched so 400 cases work. */
export function readWithToken(token, entry, extra = {}) {
  const body = {};
  if (token !== undefined) body.token = token;
  if (entry !== undefined) body.entry = entry;
  return api(READ_PATH, { method: "POST", body, ...extra });
}

/** POST /api/vault/list-with-token. */
export function listWithToken(token, extra = {}) {
  const body = {};
  if (token !== undefined) body.token = token;
  return api(LIST_PATH, { method: "POST", body, ...extra });
}

/** POST /api/mcp { tool, input } with optional vault-token / cookie headers. */
export function mcp(tool, input = {}, { cookie, vaultToken, authorization, headers = {} } = {}) {
  const h = { ...headers };
  if (vaultToken) h["x-zippyvault-token"] = vaultToken;
  if (authorization) h.authorization = authorization;
  return api(MCP_PATH, { method: "POST", cookie, headers: h, body: { tool, input } });
}

/** Exact own-key-set assertion. */
export function assertKeys(obj, expected, what) {
  assert.ok(obj && typeof obj === "object", `${what}: expected an object`);
  assert.deepEqual([...Object.keys(obj)].sort(), [...expected].sort(), `${what}: unexpected key set`);
}

/** Recursively assert none of `banned` appears as a key anywhere in `value`. */
export function assertNoKeysAnywhere(value, banned, what) {
  const bad = [];
  (function walk(node, pathStr) {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${pathStr}[${i}]`));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (banned.includes(k)) bad.push(`${pathStr}.${k}`);
        walk(v, `${pathStr}.${k}`);
      }
    }
  })(value, "$");
  assert.deepEqual(bad, [], `${what}: forbidden key(s) present`);
}

/**
 * Assert none of the labelled secrets appear in `text`.
 * @param {string} text raw response body
 * @param {Array<[string,string]>} secrets [label, secretValue] pairs — only the LABEL is ever printed
 */
export function assertNoSecrets(text, secrets, what) {
  const leaked = secrets.filter(([, v]) => v && text.includes(v)).map(([label]) => label);
  assert.deepEqual(leaked, [], `${what}: response body contained ${leaked.join(", ")}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
