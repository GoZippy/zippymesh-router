const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Only the Playwright browser flow lives in *.spec.cjs. The node:test
  // production-build suites (tests/e2e/**/*.test.mjs) are run by
  // scripts/e2e/run-standalone.mjs and must not be picked up here.
  testMatch: '**/*.spec.cjs',
  // H-10: the spec mutates the target (it sets an admin password), and there is
  // no webServer here. globalSetup refuses to run unless the operator points at
  // a THROWAWAY instance with ZMLR_E2E_BASE_URL and opts in with
  // PLAYWRIGHT_ALLOW_REAL=1, so a bare `npx playwright test` can no longer
  // rewrite a real install. See tests/e2e/globalSetup.cjs for how to run it.
  globalSetup: require.resolve('./tests/e2e/globalSetup.cjs'),
  timeout: 45000,
  expect: {
    timeout: 10000
  },
  fullyParallel: false, // Run tests sequentially to avoid DB lock issues with the same SQLite instance
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Ensure sequential execution for E2E SQLite consistency
  reporter: 'list',
  use: {
    actionTimeout: 0,
    trace: 'on-first-retry',
    // Prefer the throwaway target the guard requires; the literal default is
    // unreachable once the guard is active (it demands an explicit base URL).
    baseURL: process.env.ZMLR_E2E_BASE_URL || process.env.BASE_URL || 'http://localhost:20128',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
