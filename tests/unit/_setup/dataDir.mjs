// Vitest setupFiles entry: forces every unit test file onto an isolated,
// throwaway DATA_DIR *before* the test file's own imports run. localDb.js
// resolves and creates its data directory at module-import time
// (`const DATA_DIR = getUserDataDir()`), so this env var must exist before
// anything imports src/lib/localDb.js (directly or transitively).
//
// This is what stops `npx vitest run tests/unit/` (and therefore
// `npm run test:unit`) from ever reading or writing the operator's real
// %APPDATA%\zippy-mesh (or ~/.zippy-mesh) store.
// See docs/_internal/KIROCREW_INTEGRATION_HANDOFF.md §4 and §7.
//
// Opt out (e.g. to debug against a real store) with ZMLR_TEST_KEEP_DATA_DIR=1.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Best-effort shared "suite start" marker: the first setupFiles run in a
// given worker process sets it; later test files in the same worker reuse
// it. Used by tests/unit/dataDirIsolation.test.js to check the real store
// was not touched during this run.
if (!process.env.ZMLR_TEST_SUITE_START_MS) {
  process.env.ZMLR_TEST_SUITE_START_MS = String(Date.now());
}

if (!process.env.ZMLR_TEST_KEEP_DATA_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zmlr-test-"));
  process.env.DATA_DIR = dir;

  process.once("exit", () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup only — never fail the test run over this
    }
  });
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
}

if (!process.env.ZIPPY_OFFLINE) {
  // Belt-and-suspenders: tests should never phone home even if a test
  // exercises a code path that would otherwise attempt telemetry/heartbeat.
  process.env.ZIPPY_OFFLINE = "true";
}
