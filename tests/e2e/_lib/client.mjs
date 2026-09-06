/**
 * Shared HTTP client for the ZMLR production-build e2e suites.
 *
 * Every helper here talks to a server that scripts/e2e/run-standalone.mjs
 * already started against a throwaway DATA_DIR. Nothing in this file starts,
 * stops or configures a server, and nothing writes to disk.
 *
 * Contract (other e2e suites import these names — do not rename):
 *
 *   baseUrl()                              -> "http://127.0.0.1:<port>", throws if unset
 *   adminPassword()                        -> ZMLR_E2E_ADMIN_PASSWORD, throws if unset
 *   api(path, opts)                        -> { status, headers, json, text }, never throws on non-2xx
 *   ensureSetup(password = adminPassword()) -> completes first-run, idempotent
 *   login(password = adminPassword())      -> "auth_token=..." for a Cookie header
 *
 * `api` options: { method = 'GET', body, headers = {}, cookie }
 *   - body: a plain object is JSON-encoded with content-type application/json;
 *     a string is sent verbatim with no content-type (so a suite can post
 *     deliberately malformed JSON and assert the 400).
 *   - cookie: a cookie string, e.g. the return value of login().
 *   - headers: merged last, so a test can override anything above.
 *   - `headers` in the RESULT is the live fetch Headers object (use .get()).
 *   - `json` is the parsed body, or null when the body is not JSON.
 *   - Non-2xx is a normal result. Only transport failures throw.
 *
 * login() no longer sends a synthetic x-forwarded-for. It used to, because
 * /api/auth/login once rate-limited 5 attempts per 15 minutes on a key the
 * caller could choose, and a six-file suite would burn the shared budget. Both
 * halves of that are gone: the key is clientPeer() (a caller-supplied header
 * cannot pick a bucket without TRUST_PROXY), and the policy is a per-account
 * progressive delay with a coarse 100-failure ceiling, so a SUCCESSFUL login is
 * never delayed and never limited however many failures preceded it
 * (adversarial review 2026-08-30, item 15; src/lib/auth/loginBackoff.js).
 */

/** Base URL of the server under test. */
export function baseUrl() {
  const v = process.env.ZMLR_E2E_BASE_URL;
  if (!v) throw new Error("ZMLR_E2E_BASE_URL is not set — run via scripts/e2e/run-standalone.mjs");
  return v.replace(/\/+$/, "");
}

/** Dashboard password the runner generated for this pass. */
export function adminPassword() {
  const v = process.env.ZMLR_E2E_ADMIN_PASSWORD;
  if (!v) throw new Error("ZMLR_E2E_ADMIN_PASSWORD is not set — run via scripts/e2e/run-standalone.mjs");
  return v;
}

/**
 * One request. Returns a plain result object; never throws for a non-2xx.
 *
 * @param {string} path e.g. "/api/vault/read-with-token"
 * @param {{method?:string, body?:any, headers?:Record<string,string>, cookie?:string}} [opts]
 * @returns {Promise<{status:number, headers:Headers, json:any, text:string}>}
 */
export async function api(path, { method = "GET", body, headers = {}, cookie } = {}) {
  const init = { method, headers: {} };

  if (body !== undefined) {
    if (typeof body === "string") {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }
  }
  if (cookie) init.headers.cookie = cookie;
  Object.assign(init.headers, headers);

  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...init, redirect: "manual" });
  } catch (err) {
    throw new Error(`${method} ${path} failed at the transport level: ${err?.message ?? err}`);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, headers: res.headers, json, text };
}

/**
 * Complete first-run setup so a password exists. Idempotent: if the instance
 * already has a password hash this is a no-op and returns { alreadySetUp: true }.
 *
 * First run is PATCH /api/settings { newPassword } — the route treats
 * "no password hash stored" as first run and skips its auth gate, and
 * /api/settings is on the middleware's public list, so no cookie is needed.
 */
export async function ensureSetup(password = adminPassword()) {
  const before = await api("/api/settings");
  if (before.status !== 200) {
    throw new Error(`GET /api/settings during setup returned ${before.status}: ${before.text.slice(0, 200)}`);
  }
  if (before.json?.hasPassword === true) return { alreadySetUp: true };

  const res = await api("/api/settings", { method: "PATCH", body: { newPassword: password } });
  if (res.status !== 200) {
    throw new Error(`first-run PATCH /api/settings returned ${res.status}: ${res.text.slice(0, 200)}`);
  }
  return { alreadySetUp: false };
}

/**
 * Log in and return the auth_token cookie pair ("auth_token=<jwt>") suitable
 * for a Cookie header. Throws if the login did not succeed or set no cookie.
 */
export async function login(password = adminPassword()) {
  const res = await api("/api/auth/login", {
    method: "POST",
    body: { password },
  });
  if (res.status !== 200 || res.json?.success !== true) {
    throw new Error(`login failed: ${res.status} ${res.text.slice(0, 200)}`);
  }
  const cookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  const authCookie = cookies.map((c) => String(c).split(";")[0].trim()).find((c) => c.startsWith("auth_token="));
  if (!authCookie) throw new Error("login succeeded but no auth_token cookie was set");
  return authCookie;
}
