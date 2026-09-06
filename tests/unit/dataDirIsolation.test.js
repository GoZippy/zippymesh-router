// Guards the fix for KIROCREW_INTEGRATION_HANDOFF.md §4 finding #1:
// `npm test` / `npm run test:unit` / `npm run test:providers` must NEVER
// touch the operator's real %APPDATA%\zippy-mesh (or ~/.zippy-mesh) store.
// tests/unit/_setup/dataDir.mjs (wired via vitest.config.js `setupFiles`) is
// what sets DATA_DIR before this file's own imports run — this test asserts
// that actually happened and that it stuck.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSqliteDb } from "../../src/lib/localDb.js";

const REAL_WINDOWS_DATA_DIR = process.env.APPDATA
  ? path.join(process.env.APPDATA, "zippy-mesh")
  : path.join(os.homedir(), "AppData", "Roaming", "zippy-mesh");
const REAL_UNIX_LEGACY_DATA_DIR = path.join(os.homedir(), ".zippy-mesh");

function isSameOrUnder(candidate, ancestor) {
  const rel = path.relative(ancestor, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue; // best-effort, read-only check
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          out.push({ file: full, mtimeMs: fs.statSync(full).mtimeMs });
        } catch {
          // file may have raced away between readdir and stat; ignore
        }
      }
    }
  }
  return out;
}

describe("test DATA_DIR isolation — never touch the operator's real store", () => {
  it("DATA_DIR is set to an absolute, real path (not the fallback getUserDataDir())", () => {
    expect(process.env.DATA_DIR).toBeTruthy();
    expect(path.isAbsolute(process.env.DATA_DIR)).toBe(true);
    expect(fs.existsSync(process.env.DATA_DIR)).toBe(true);
  });

  it("DATA_DIR is not the real Windows %APPDATA%\\zippy-mesh store, nor under it", () => {
    if (process.platform !== "win32" && !process.env.APPDATA) return; // n/a off Windows
    const dataDir = path.resolve(process.env.DATA_DIR);
    const realDir = path.resolve(REAL_WINDOWS_DATA_DIR);
    expect(isSameOrUnder(dataDir, realDir)).toBe(false);
  });

  it("DATA_DIR is not the real ~/.zippy-mesh legacy store, nor under it", () => {
    const dataDir = path.resolve(process.env.DATA_DIR);
    const realDir = path.resolve(REAL_UNIX_LEGACY_DATA_DIR);
    expect(isSameOrUnder(dataDir, realDir)).toBe(false);
  });

  it("localDb.js resolves its sqlite file to DATA_DIR, confirming the env var was honored at import time", () => {
    const db = getSqliteDb();
    expect(db).toBeTruthy();
    expect(typeof db.name).toBe("string");
    const dbDir = path.resolve(path.dirname(db.name));
    const expectedDir = path.resolve(process.env.DATA_DIR);
    expect(dbDir.toLowerCase()).toBe(expectedDir.toLowerCase());
    expect(fs.existsSync(db.name)).toBe(true);
  });

  it("the real store (if present on this machine) has no file written during this run", () => {
    const suiteStartMs = Number(process.env.ZMLR_TEST_SUITE_START_MS) || Date.now();
    for (const realDir of [REAL_WINDOWS_DATA_DIR, REAL_UNIX_LEGACY_DATA_DIR]) {
      if (!fs.existsSync(realDir)) continue; // nothing to check on this machine
      const touchedDuringRun = listFilesRecursive(realDir).filter(
        (f) => f.mtimeMs > suiteStartMs
      );
      expect(touchedDuringRun).toEqual([]);
    }
  });
});
