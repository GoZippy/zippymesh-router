"use strict";

// Preload for the plain-node test runners: `node -r ./tests/_env.cjs <file>`.
// Mirrors tests/unit/_setup/dataDir.mjs for `npm test` / `npm run
// test:providers`, which run tests/*.test.js directly with `node` (no
// vitest, so no setupFiles). `-r` preloads run before the main ESM module is
// evaluated, which is what makes this land before any test file imports
// src/lib/localDb.js — DATA_DIR is resolved and the dir created at that
// module's import time.
//
// This is what stops `npm test` / `npm run test:providers` from ever
// reading or writing the operator's real %APPDATA%\zippy-mesh store.
// See docs/_internal/KIROCREW_INTEGRATION_HANDOFF.md §4 and §7.
//
// Opt out (e.g. to debug against a real store) with ZMLR_TEST_KEEP_DATA_DIR=1.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

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
  process.env.ZIPPY_OFFLINE = "true";
}
