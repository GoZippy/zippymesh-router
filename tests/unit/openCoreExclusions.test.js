/**
 * The open-core exclusion lists.
 *
 * WHY THIS EXISTS. scripts/build-community.cjs decided what to copy into the
 * public payload and scripts/validate-open-core.cjs decided what to fail on,
 * and each kept its own hand-maintained list. Both listed agent and IDE state
 * directories. Neither listed `.clinerules/` — nine files of internal agent
 * steering — so the builder copied it into the payload and the validator
 * reported PASS on it. The validator also SKIPPED the internal directories it
 * was supposed to catch: its walker ignored `.claude`, `.autoclaw`, `plans`,
 * `archive` and others outright, and its only internal-directory check tested
 * exact paths at the tree root, so the same directory one level down was
 * invisible to both halves.
 *
 * These tests pin the three properties that make that unrepeatable: one list,
 * shared; internal directories caught at any depth; build artifacts not
 * mistaken for leaks.
 *
 * Run ONLY: npx vitest run tests/unit/openCoreExclusions.test.js
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const ex = require("../../scripts/open-core-exclusions.cjs");
const {
  INTERNAL_DIR_NAMES,
  BUILD_ARTIFACT_DIRS,
  INTERNAL_FILE_REGEXES,
  isInternalDirName,
  isInternalRelPath,
  isInternalFileName,
  selfTest,
} = ex;

const REPO = process.cwd();
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

describe("one list, shared by the builder and the validator", () => {
  it("the builder derives its exclusions from the shared module", () => {
    const src = read("scripts/build-community.cjs");
    expect(src).toMatch(/require\(\s*["']\.\/open-core-exclusions\.cjs["']\s*\)/);
    // No second copy: the sets must be built from the module, not re-typed.
    expect(src).not.toMatch(/const\s+EXCLUDE_DIRS\s*=\s*new Set\(\[\s*["']/);
    expect(src).not.toMatch(/const\s+EXCLUDE_FILE_PATTERNS\s*=\s*\[\s*\//);
  });

  it("the validator derives its exclusions from the shared module", () => {
    const src = read("scripts/validate-open-core.cjs");
    expect(src).toMatch(/require\(\s*["']\.\/open-core-exclusions\.cjs["']\s*\)/);
    expect(src).not.toMatch(/const\s+INTERNAL_DIRS\s*=\s*\[/);
    expect(src).not.toMatch(/const\s+INTERNAL_FILE_REGEXES\s*=\s*\[/);
  });

  it("both refuse to run on a list that has stopped covering its cases", () => {
    expect(() => selfTest()).not.toThrow();
    for (const rel of ["scripts/build-community.cjs", "scripts/validate-open-core.cjs"]) {
      expect(read(rel), rel).toMatch(/exclusionsSelfTest\(\)/);
    }
  });
});

describe("internal material is excluded", () => {
  it("excludes the agent-steering directory that was actually shipping", () => {
    expect(isInternalDirName(".clinerules")).toBe(true);
  });

  it("excludes every agent and IDE state directory we know of", () => {
    for (const d of [
      ".claude", ".cline", ".cursor", ".windsurf", ".kilo", ".kiro", ".roo",
      ".aider", ".continue", ".opencode", ".codex", ".gemini", ".zed",
      ".voidspec", ".autoclaw", ".fork", ".github",
    ]) {
      expect(isInternalDirName(d), d).toBe(true);
    }
  });

  it("excludes internal work directories and private source", () => {
    for (const d of ["plans", "experiments", "tester", "test-results", "data", "logs",
                     "archive", "_deprecated", "backup", "sidecar", "src-tauri"]) {
      expect(isInternalDirName(d), d).toBe(true);
    }
  });

  it("excludes agent-steering files, which read as documentation and get published by accident", () => {
    for (const f of ["CLAUDE.md", "AGENTS.md", "AGENT.md", "GEMINI.md", "QWEN.md",
                     ".cursorrules", ".windsurfrules", ".roomodes", ".kilocodemodes"]) {
      expect(isInternalFileName(f), f).toBe(true);
    }
  });

  it("excludes runtime state, dumps and env files", () => {
    for (const f of [".env", ".env.local", ".env.mesh", "app.log", "debug_session.txt",
                     "db.json", "oauth-secrets.json", "zippy.sqlite", ".zippy-private"]) {
      expect(isInternalFileName(f), f).toBe(true);
    }
  });

  it("excludes docs/_internal by path without excluding all of docs/", () => {
    expect(isInternalRelPath("docs/_internal")).toBe(true);
    expect(isInternalRelPath("docs\\_internal")).toBe(true); // Windows separator
    expect(isInternalRelPath("docs")).toBe(false);
    expect(isInternalDirName("docs")).toBe(false);
  });
});

describe("product material is not excluded", () => {
  it("keeps the source, docs and test trees", () => {
    for (const d of ["src", "docs", "scripts", "tests", "public", "config", "open-sse", "stubs"]) {
      expect(isInternalDirName(d), d).toBe(false);
    }
  });

  it("keeps the files a community edition has to ship", () => {
    for (const f of ["README.md", "CONTRIBUTING.md", "LICENSE", "NOTICE.md", "SECURITY.md",
                     "ARCHITECTURE.md", "CHANGELOG.md", "PRICING.md", "package.json",
                     ".env.example", "next.config.mjs", "server.js"]) {
      expect(isInternalFileName(f), f).toBe(false);
    }
  });

  it("keeps .env.example while excluding every other .env", () => {
    expect(isInternalFileName(".env.example")).toBe(false);
    expect(isInternalFileName(".env.examples")).toBe(true);
  });
});

describe("build artifacts are skipped, not reported as leaks", () => {
  it("names them separately from internal material", () => {
    for (const d of ["node_modules", ".next", ".git", "dist", "out", "community-dist"]) {
      expect(BUILD_ARTIFACT_DIRS, d).toContain(d);
      // The distinction is the point: the validator must skip these silently.
      // Reporting node_modules as an internal leak would make the gate useless.
      expect(isInternalDirName(d), d).toBe(false);
    }
  });

  it("the validator's walker skips only build artifacts", () => {
    const src = read("scripts/validate-open-core.cjs");
    expect(src).toMatch(/LEAK_SCAN_SKIP_DIRS\s*=\s*new Set\(BUILD_ARTIFACT_DIRS\)/);
  });

  it("no directory is on both lists", () => {
    const both = INTERNAL_DIR_NAMES.filter((d) => BUILD_ARTIFACT_DIRS.includes(d));
    expect(both).toEqual([]);
  });
});

describe("the lists stay honest", () => {
  it("has no duplicate directory entries", () => {
    expect(new Set(INTERNAL_DIR_NAMES).size).toBe(INTERNAL_DIR_NAMES.length);
    expect(new Set(BUILD_ARTIFACT_DIRS).size).toBe(BUILD_ARTIFACT_DIRS.length);
  });

  it("no file rule is broad enough to swallow ordinary product filenames", () => {
    // The syntactic question (is every rule anchored?) is the wrong one: the
    // merge-leftover rule is deliberately unanchored at the start so it catches
    // `foo.resolved.json`. What matters is that no rule reaches an ordinary
    // filename, so assert that against a corpus instead.
    const corpus = [
      "index.js", "page.js", "route.js", "layout.js", "middleware.js",
      "README.md", "index.d.ts", "styles.css", "logo.svg", "favicon.ico",
      "next.config.mjs", "package.json", "tsconfig.json", "vitest.config.js",
      "Dockerfile", "docker-compose.yml", "LICENSE", "NOTICE.md",
      "resolved.js", "envelope.js", "environment.ts", "logger.js", "catalog.json",
      "backup-strategy.md", "data-model.md", "logging.md", "plans.md",
    ];
    for (const name of corpus) {
      for (const re of INTERNAL_FILE_REGEXES) {
        re.lastIndex = 0;
        expect(re.test(name), `${re} excludes product file ${name}`).toBe(false);
      }
    }
  });

  it("every file rule is still a RegExp", () => {
    for (const re of INTERNAL_FILE_REGEXES) expect(re).toBeInstanceOf(RegExp);
  });

  it("this repository still carries the material the lists are for", () => {
    // If .clinerules/ or CLAUDE.md ever leaves the private repo, these rules
    // become dead weight and someone should say so deliberately rather than
    // discover it during a release.
    expect(fs.existsSync(path.join(REPO, ".clinerules"))).toBe(true);
    expect(fs.existsSync(path.join(REPO, "CLAUDE.md"))).toBe(true);
  });
});
