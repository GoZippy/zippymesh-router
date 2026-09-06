/**
 * scripts/lib/zipScan.cjs — the gate that stands between a stray `db.json` and
 * a public release artifact.
 *
 * THE BUG (adversarial review 2026-08-30 — security/install slice, C-2): the
 * scan in scripts/package-release.cjs shelled out, and on Windows it was INERT.
 * The pattern was interpolated into a PowerShell single-quoted string and the
 * whole command was then JSON.stringify'd, doubling every backslash; PowerShell
 * reads `\\` inside '...' literally, so .NET regex saw "a literal backslash
 * followed by any character" and every alternative containing `\.` became
 * unmatchable — `.env`, `bootstrap.secret`, `db.json`, `oauth-secrets.json`,
 * `router-config.json`. Only `data/` survived. Reproduced against the file's own
 * constant: the only match was `data/x`.
 *
 * The scan is now pure Node against the zip's central directory. These tests
 * build real zips (via the same platform tooling package-release.cjs uses) and
 * assert both directions.
 *
 * Run ONLY: npx vitest run tests/unit/releaseLeakScan.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { LEAK_PATTERN, zipEntryNames, scanZipForLeaks } = require("../../scripts/lib/zipScan.cjs");

let tmp;

/** Build a zip whose ROOT holds the given relative paths. Returns its path. */
function makeZip(name, relPaths) {
  const src = fs.mkdtempSync(path.join(tmp, "src-"));
  for (const rel of relPaths) {
    const full = path.join(src, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `content of ${rel}\n`);
  }
  const zipPath = path.join(tmp, name);
  if (process.platform === "win32") {
    const ps =
      `$items = Get-ChildItem -Force -Path '${src.replace(/'/g, "''")}'; ` +
      `Compress-Archive -Path $items.FullName -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "pipe" });
  } else {
    execFileSync("zip", ["-r", "-q", "--symlinks", zipPath, "."], { cwd: src, stdio: "pipe" });
  }
  return zipPath;
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zmlr-zipscan-"));
});

afterAll(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("LEAK_PATTERN", () => {
  it("REGRESSION: matches every name the Windows path used to miss", () => {
    // These five were unmatchable through the old PowerShell round-trip.
    for (const n of [".env", "bootstrap.secret", "db.json", "oauth-secrets.json", "router-config.json"]) {
      expect(LEAK_PATTERN.test(n), n).toBe(true);
    }
    expect(LEAK_PATTERN.test("data/db.json")).toBe(true);
  });

  it("does not flag what SHOULD ship", () => {
    for (const n of [
      ".env.example",
      "server.js",
      "README.md",
      "node_modules/caniuse-lite/data/regions/US.js", // the reason it is root-anchored
      "public/data.json",
      "open-sse/handlers/chatCore.js",
    ]) {
      expect(LEAK_PATTERN.test(n), n).toBe(false);
    }
  });

  it("is a real RegExp, not a string handed to a shell", () => {
    // The whole class of bug was a regex crossing a quoting boundary.
    expect(LEAK_PATTERN).toBeInstanceOf(RegExp);
  });
});

describe("scanZipForLeaks() against real archives", () => {
  it("catches root-level secrets in an archive built by this platform's own tooling", () => {
    const zip = makeZip("leaky.zip", [
      ".env",
      "bootstrap.secret",
      "db.json",
      "server.js",
      "data/db.json",
    ]);
    const { entries, leaked } = scanZipForLeaks(zip);
    expect(entries.length).toBeGreaterThan(0);
    expect(leaked).toEqual(expect.arrayContaining([".env", "bootstrap.secret", "db.json"]));
    expect(leaked.some((n) => n.startsWith("data/"))).toBe(true);
    expect(leaked).not.toContain("server.js");
  });

  it("passes a clean archive, and keeps .env.example", () => {
    const zip = makeZip("clean.zip", [".env.example", "server.js", "public/logo.txt"]);
    const { entries, leaked } = scanZipForLeaks(zip);
    expect(leaked).toEqual([]);
    expect(entries).toEqual(expect.arrayContaining([".env.example", "server.js"]));
  });

  it("normalises backslash separators, which Compress-Archive may emit", () => {
    // Not all PowerShell majors write '/'; the gate must not depend on which.
    const zip = makeZip("sep.zip", [path.join("data", "db.json")]);
    const names = zipEntryNames(zip);
    expect(names.every((n) => !n.includes("\\"))).toBe(true);
    expect(scanZipForLeaks(zip).leaked.length).toBeGreaterThan(0);
  });

  it("THROWS on a file that is not a readable zip — 'cannot verify' must fail the release", () => {
    const notAZip = path.join(tmp, "not-a-zip.zip");
    fs.writeFileSync(notAZip, "this is not a zip archive at all");
    expect(() => scanZipForLeaks(notAZip)).toThrow(/not a zip file/);
  });
});
