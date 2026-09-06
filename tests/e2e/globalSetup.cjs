/**
 * Playwright globalSetup — refuse to run the browser E2E flow against a real
 * ZMLR install (H-10).
 *
 * `tests/e2e/zmlr.spec.cjs` is NOT read-only: it drives the setup wizard, SETS
 * AN ADMIN PASSWORD, adds a provider and mints a virtual key. With no
 * `webServer` in the config, a bare `npx playwright test` would attach to
 * whatever is listening on the default port (http://localhost:20128) — the
 * operator's normal instance, backed by the real %APPDATA%\zippy-mesh /
 * ~/.zippy-mesh store — and mutate it.
 *
 * This gate makes a bare run fail before any test executes. To run the flow you
 * must point it at a THROWAWAY instance and opt in explicitly:
 *
 *   1. Start ZMLR against an isolated data dir with its own port + secret, e.g.
 *        DATA_DIR="$(mktemp -d)" PORT=20999 JWT_SECRET="$(openssl rand -hex 32)" npm start
 *   2. ZMLR_E2E_BASE_URL=http://localhost:20999 PLAYWRIGHT_ALLOW_REAL=1 npx playwright test
 *
 * BOTH are required: `ZMLR_E2E_BASE_URL` names the disposable target and
 * `PLAYWRIGHT_ALLOW_REAL=1` is the explicit acknowledgement that the flow will
 * write to it. `npx playwright test --list` still works (globalSetup does not
 * run for --list), so discovery is unaffected.
 */
module.exports = async () => {
  const base = process.env.ZMLR_E2E_BASE_URL || process.env.BASE_URL;
  const allowReal = process.env.PLAYWRIGHT_ALLOW_REAL === "1";

  if (base && allowReal) return; // operator opted in against a stated target

  const lines = [
    "",
    "Refusing to run the Playwright E2E flow (tests/e2e/zmlr.spec.cjs).",
    "It drives the setup wizard and SETS AN ADMIN PASSWORD, so pointing it at a real",
    "ZMLR install (default http://localhost:20128, backed by %APPDATA%\\zippy-mesh) would",
    "mutate real data.",
    "",
    "Run it only against a throwaway instance, and opt in explicitly:",
    "  1. DATA_DIR=$(mktemp -d) PORT=20999 JWT_SECRET=$(openssl rand -hex 32) npm start",
    "  2. ZMLR_E2E_BASE_URL=http://localhost:20999 PLAYWRIGHT_ALLOW_REAL=1 npx playwright test",
    "",
    "Both ZMLR_E2E_BASE_URL and PLAYWRIGHT_ALLOW_REAL=1 are required.",
  ];
  if (base && !allowReal) {
    lines.push(
      "",
      `A base URL (${base}) was supplied but PLAYWRIGHT_ALLOW_REAL is not set. Set`,
      "PLAYWRIGHT_ALLOW_REAL=1 to confirm that target is a disposable instance.",
    );
  }
  throw new Error(lines.join("\n"));
};
