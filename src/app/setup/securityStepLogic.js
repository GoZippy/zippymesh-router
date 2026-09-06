/**
 * The setup wizard's step-0 sequence, as a pure async function.
 *
 * Split out of `page.js` (2026-08-30, fix for H2) so it can be exercised in the
 * repo's Node vitest environment — there is no jsdom / testing-library here, so
 * the React component itself is not renderable in a test. Same convention as
 * AddLocalRuntime.js + addLocalRuntimeLogic.js.
 *
 * ## What it does, and why the second call exists
 *
 * `PATCH /api/settings {newPassword}` sets the dashboard password and returns
 * **no `Set-Cookie`**: it is a public route with a `firstRun` exemption, not a
 * login. Before this, the wizard advanced to step 1 with an empty cookie jar,
 * so the "Add a local runtime" card 401'd on `POST /api/provider-nodes` and
 * `router.push("/login")` ejected the user out of setup mid-flow — on a fresh
 * install, i.e. the only install that ever runs the wizard.
 *
 * So step 0 is: set the password, then actually log in with it.
 *
 * A failed auto-login is reported, never thrown and never a redirect: the
 * password IS set at that point, so refusing to advance would strand the user
 * on a step whose second attempt hits `firstRun:false` and 401s.
 */

/** Minimum password length the wizard enforces client-side. */
export const MIN_PASSWORD_LENGTH = 4;

/**
 * Validate the two password fields.
 * @returns {{ok: true}|{ok: false, error: string}}
 */
export function validatePasswordPair(password, confirmPassword) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: "Passwords do not match." };
  }
  return { ok: true };
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Set the password, then sign in with it.
 *
 * @param {object} input
 * @param {string} input.password
 * @param {string} input.confirmPassword
 * @param {Function} [input.fetchImpl] - injected for tests; defaults to global fetch
 * @returns {Promise<{
 *   ok: boolean,            // the PASSWORD step succeeded (may advance)
 *   error: string,          // why it did not, when ok is false
 *   sessionOk: boolean,     // a session cookie was issued
 *   sessionError: string,   // why it was not, when sessionOk is false
 * }>}
 */
export async function completePasswordStep({ password, confirmPassword, fetchImpl } = {}) {
  const valid = validatePasswordPair(password, confirmPassword);
  if (!valid.ok) return { ok: false, error: valid.error, sessionOk: false, sessionError: "" };

  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return { ok: false, error: "Failed to set password.", sessionOk: false, sessionError: "" };

  let setRes;
  try {
    setRes = await doFetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: password }),
    });
  } catch (err) {
    return { ok: false, error: err?.message || "Failed to set password.", sessionOk: false, sessionError: "" };
  }

  if (!setRes?.ok) {
    const data = await readJson(setRes);
    return {
      ok: false,
      error: data?.error?.message ?? data?.error ?? "Failed to set password.",
      sessionOk: false,
      sessionError: "",
    };
  }

  // The password is set from here on. Everything below can only downgrade
  // `sessionOk`; it can never turn the step into a failure.
  let sessionOk = false;
  let sessionError = "";
  try {
    const login = await doFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });
    const data = await readJson(login);
    sessionOk = !!login?.ok && data?.success === true;
    if (!sessionOk) {
      sessionError = data?.error?.message || data?.error || `sign-in returned ${login?.status ?? "no response"}`;
    }
  } catch (err) {
    sessionError = err?.message || "sign-in request failed";
  }

  return { ok: true, error: "", sessionOk, sessionError };
}
