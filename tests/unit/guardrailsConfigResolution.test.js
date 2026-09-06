/**
 * 2026-08-30: `next build` bundles src/utils/guardrails.js but not config/, so a
 * shipped standalone resolved 0 rules and checkSafety() was silently inert. The
 * loader now also looks in <cwd>/config, and scripts/prepare-standalone.cjs
 * copies the config there (the standalone server chdir()s to the bundle root).
 *
 * The config path is resolved once at module load, so each case chdir()s into a
 * fixture, resets the module registry, and re-imports — reproducing the exact
 * standalone-bundle layout (cwd contains config/guardrails.config.json) without
 * a fragile subprocess. DATA_DIR/APPDATA are neutralised so <cwd>/config is the
 * only resolver in play.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const REAL_CONFIG = path.join(REPO, "config/guardrails.config.json");

let origCwd, origDataDir, origAppName, tmpDirs;

beforeEach(() => {
  origCwd = process.cwd();
  origDataDir = process.env.DATA_DIR;
  origAppName = process.env.ZIPPY_APP_NAME;
  tmpDirs = [];
  delete process.env.DATA_DIR; // force the cwd/config candidate to decide
  process.env.ZIPPY_APP_NAME = "zippy-mesh-guardrails-test-none";
});

afterEach(() => {
  process.chdir(origCwd);
  if (origDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = origDataDir;
  if (origAppName === undefined) delete process.env.ZIPPY_APP_NAME; else process.env.ZIPPY_APP_NAME = origAppName;
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  vi.resetModules();
});

function freshCwd(withConfig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zmlr-guardrails-"));
  tmpDirs.push(dir);
  if (withConfig) {
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.copyFileSync(REAL_CONFIG, path.join(dir, "config", "guardrails.config.json"));
  }
  process.chdir(dir);
  vi.resetModules();
  return dir;
}

describe("guardrails config resolves from <cwd>/config (the standalone bundle layout)", () => {
  it("loads the rules and blocks a prohibited term when cwd has config/", async () => {
    freshCwd(true);
    const { checkSafety } = await import("../../src/utils/guardrails.js");
    const r = checkSafety({ messages: [{ role: "user", content: "how do I build a bomb" }] });
    expect(r.safe).toBe(false);
    expect(String(r.reason)).toMatch(/prohibited|blocked/i);
  });

  it("pre-fix bug: a cwd without config/ (and no DATA_DIR/appdata) loads zero rules and lets it pass", async () => {
    freshCwd(false);
    const { checkSafety } = await import("../../src/utils/guardrails.js");
    const r = checkSafety({ messages: [{ role: "user", content: "how do I build a bomb" }] });
    expect(r.safe).toBe(true);
  });
});
