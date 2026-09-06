/**
 * The setup wizard's step 0 (adversarial review 2026-08-30, finding H2).
 *
 * `StepSecurity` set the password with `PATCH /api/settings {newPassword}` and
 * **did not log in**: that route is public with a `firstRun` exemption and
 * returns no `Set-Cookie`. So on a fresh install the wizard advanced to step 1
 * with an empty cookie jar and the new "Add a local runtime" card — the headline
 * feature of the commit that added it, placed "first in the setup wizard" —
 * posted to `POST /api/provider-nodes` with `credentials:"include"`, hit the
 * middleware cookie gate, got a 401, and `router.push("/login")` ejected the
 * user out of setup mid-flow. Verified against a fresh DATA_DIR:
 *
 *     GET   /api/settings/require-login          -> {"requireLogin":true}
 *     PATCH /api/settings {"newPassword":"…"}    -> 200, cookie jar EMPTY
 *     POST  /api/provider-nodes {type:"local"}   -> 401 {"error":"Unauthorized"}
 *
 * CI could not see it: tests/e2e/zmlr.spec.cjs:34 skips wizard step 1 outright,
 * and tests/unit/addLocalRuntime.test.js mocks fetch, so it asserted that the
 * 401 BRANCH renders nicely rather than that the happy path was reachable.
 *
 * The fix is in the wizard, not in the route: `POST /api/provider-nodes` now
 * drives outbound fetches and mints routing targets (finding C1), so it is the
 * last route that should grow a first-run auth bypass.
 */

import { describe, it, expect, vi } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  completePasswordStep,
  validatePasswordPair,
} from "../../src/app/setup/securityStepLogic.js";

/** A fetch double that records calls and answers per path. */
function fakeFetch(handlers) {
  const calls = [];
  const impl = vi.fn(async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const h = handlers[url];
    if (!h) throw new Error(`unexpected fetch ${url}`);
    return typeof h === "function" ? h(init) : h;
  });
  impl.calls = calls;
  return impl;
}

const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const fail = (status, json) => ({ ok: false, status, json: async () => json });

describe("validatePasswordPair", () => {
  it("rejects a short password and a mismatch, with the wizard's own wording", () => {
    expect(validatePasswordPair("abc", "abc")).toEqual({
      ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
    expect(validatePasswordPair("abcd", "abce")).toEqual({ ok: false, error: "Passwords do not match." });
    expect(validatePasswordPair(undefined, undefined).ok).toBe(false);
    expect(validatePasswordPair("abcd", "abcd")).toEqual({ ok: true });
  });
});

describe("completePasswordStep — H2", () => {
  it("sets the password AND logs in, in that order", async () => {
    const fetchImpl = fakeFetch({
      "/api/settings": ok({ success: true }),
      "/api/auth/login": ok({ success: true }),
    });
    const r = await completePasswordStep({ password: "admin123", confirmPassword: "admin123", fetchImpl });

    expect(r).toEqual({ ok: true, error: "", sessionOk: true, sessionError: "" });
    expect(fetchImpl.calls.map((c) => c.url)).toEqual(["/api/settings", "/api/auth/login"]);
    // The login must carry the password the user just chose, and must ask for
    // the cookie to be stored — that cookie is the entire point of this fix.
    expect(fetchImpl.calls[1].body).toEqual({ password: "admin123" });
    expect(fetchImpl.calls[1].init.credentials).toBe("include");
  });

  it("does not attempt a login when the password could not be set", async () => {
    const fetchImpl = fakeFetch({
      "/api/settings": fail(401, { error: { message: "Unauthorized" } }),
    });
    const r = await completePasswordStep({ password: "admin123", confirmPassword: "admin123", fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Unauthorized");
    expect(fetchImpl.calls.map((c) => c.url)).toEqual(["/api/settings"]);
  });

  it("validates before it touches the network at all", async () => {
    const fetchImpl = fakeFetch({});
    const r = await completePasswordStep({ password: "no", confirmPassword: "no", fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl.calls).toEqual([]);
  });

  it("a FAILED auto-login still advances the wizard, and reports why", async () => {
    // The password IS set at this point. Refusing to advance would strand the
    // user: a second PATCH hits firstRun:false and 401s.
    const fetchImpl = fakeFetch({
      "/api/settings": ok({ success: true }),
      "/api/auth/login": fail(429, { error: { message: "Too many attempts" } }),
    });
    const r = await completePasswordStep({ password: "admin123", confirmPassword: "admin123", fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.sessionOk).toBe(false);
    expect(r.sessionError).toBe("Too many attempts");
  });

  it("a login that 200s without success:true is not a session", async () => {
    const fetchImpl = fakeFetch({
      "/api/settings": ok({ success: true }),
      "/api/auth/login": ok({ success: false }),
    });
    const r = await completePasswordStep({ password: "admin123", confirmPassword: "admin123", fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.sessionOk).toBe(false);
    expect(r.sessionError).toMatch(/sign-in returned 200/);
  });

  it("a thrown login (offline, aborted) is reported, never propagated", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === "/api/settings") return ok({ success: true });
      throw new Error("Failed to fetch");
    });
    const r = await completePasswordStep({ password: "admin123", confirmPassword: "admin123", fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.sessionOk).toBe(false);
    expect(r.sessionError).toBe("Failed to fetch");
  });

  it("a non-JSON login body does not blow up the step", async () => {
    const fetchImpl = fakeFetch({
      "/api/settings": ok({ success: true }),
      "/api/auth/login": { ok: true, status: 200, json: async () => { throw new Error("not json"); } },
    });
    const r = await completePasswordStep({ password: "admin123", confirmPassword: "admin123", fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.sessionOk).toBe(false);
  });
});
