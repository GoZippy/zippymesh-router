/**
 * The internal-path leak gate.
 *
 * WHAT THIS FILE IS FOR. Two scanners guard the open-core boundary:
 * `secrets-check.cjs` on every pull request, and
 * `scripts/validate-open-core.cjs` at tag time against the built community
 * tree. Each used to carry its own copy of the path patterns, and a comment
 * claimed the copies were "kept IDENTICAL in shape". They were not: a fix
 * applied to one was never applied to the other, so the scanner guarding the
 * public push was blind to the very path the other had just learned to catch.
 *
 * HOW THIS FILE PASSED WHILE THE GATE WAS BLIND. It spelled each path out as a
 * JavaScript string literal and fed the pattern the PARSED value — one
 * backslash per separator. The scanner reads a file off disk and applies the
 * pattern to the WRITTEN form, where a backslash inside a source literal is
 * stored doubled. The two never met. A test that constructs its own input in a
 * different shape than production does is not covering production.
 *
 * SO THE RULES HERE ARE:
 *   1. No needle is spelled in this file. Every fixture comes from
 *      scripts/leak-patterns.cjs, which assembles them from inert fragments —
 *      otherwise this file becomes a leak, and then an exemption, and then a
 *      blind spot.
 *   2. Parity is proved by identity, not by inspection. Both scanners must
 *      resolve to the SAME array from the shared module. Comparing two lists
 *      for "the same families" is what let them drift.
 *   3. Every pattern is exercised in both the prose form and the written-
 *      literal form, because the scanner only ever sees the latter.
 *
 * Run ONLY: npx vitest run tests/unit/secretsCheckPaths.test.js
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

const shared = require("../../scripts/leak-patterns.cjs");
const { LEAK_PATTERNS, positives, negatives, selfTest, appliesTo, isTestPath } = shared;

const secretsCheck = require("../../secrets-check.cjs");

// scripts/validate-open-core.cjs runs its scan and calls process.exit() on
// load, so it cannot be imported. Its wiring is asserted from its source.
const VALIDATOR_REL = "scripts/validate-open-core.cjs";

const { pathPatterns, collectFiles, KNOWN_PREEXISTING, PATTERN_DEFINING_FILES } = secretsCheck;

const REPO = process.cwd();

/** Apply one pattern to text the way a scanner does: fresh, and /g-safe. */
function hits(re, text) {
  re.lastIndex = 0;
  return (text.match(re) || []).length;
}

describe("one definition, shared — the drift that caused this cannot recur", () => {
  it("the PR-time gate derives its patterns from the shared module", () => {
    expect(pathPatterns).toHaveLength(LEAK_PATTERNS.length);
    for (const [i, p] of pathPatterns.entries()) {
      expect(p.name).toBe(LEAK_PATTERNS[i].name);
      // Identity, not equality: the same RegExp object, so a change to the
      // module cannot fail to reach this scanner.
      expect(p.regex).toBe(LEAK_PATTERNS[i].re);
    }
  });

  it("the tag-time validator derives its patterns from the same module", () => {
    const src = fs.readFileSync(path.join(process.cwd(), VALIDATOR_REL), "utf8");
    expect(src).toMatch(/require\(\s*["']\.\/leak-patterns\.cjs["']\s*\)/);
    expect(src).toMatch(/leakSelfTest\(\)/);
    // It must not have grown a second copy: no locally declared pattern array.
    expect(src).not.toMatch(/const\s+LEAK_PATTERNS\s*=\s*\[/);
    expect(src).not.toMatch(/const\s+pathPatterns\s*=\s*\[/);
  });

  it("the validator honours pattern scope rather than scanning blind", () => {
    const src = fs.readFileSync(path.join(process.cwd(), VALIDATOR_REL), "utf8");
    expect(src).toMatch(/leakAppliesTo\(/);
  });

  it("both scanners refuse to run on a dead pattern set", () => {
    // Each scanner calls selfTest() at load. If it ever stops throwing on a
    // pattern that no longer matches its own fixture, the gate reports PASS
    // while seeing nothing — the failure mode this whole file exists for.
    expect(() => selfTest()).not.toThrow();
    expect(selfTest()).toBe(LEAK_PATTERNS.length);
  });
});

describe("every pattern matches the form a scanner actually reads", () => {
  const pos = positives();

  for (const p of LEAK_PATTERNS) {
    it(`${p.name} — matches all of its fixtures`, () => {
      const cases = pos[p.name];
      expect(cases, `no fixture registered for ${p.name}`).toBeTruthy();
      expect(cases.length).toBeGreaterThan(1); // prose form and written-literal form
      for (const text of cases) expect(hits(p.re, text), text).toBeGreaterThan(0);
    });
  }

  it("no pattern matches a string that must stay clean", () => {
    for (const text of negatives()) {
      for (const p of LEAK_PATTERNS) {
        expect(hits(p.re, text), `${p.name} matched a negative fixture`).toBe(0);
      }
    }
  });

  it("a written-literal fixture really does differ from its prose form", () => {
    // Guards rule 3 above: if someone collapses the two forms into one, the
    // doubled-backslash case stops being covered and this test must fail.
    const win = LEAK_PATTERNS.find((p) => p.name.includes("Windows"));
    const forms = new Set(pos[win.name]);
    expect(forms.size).toBe(2);
    const [a, b] = [...forms];
    expect(a).not.toBe(b);
  });
});

describe("scope is narrow and pinned at both edges", () => {
  it("only the RFC1918 address pattern is scoped at all", () => {
    const scoped = LEAK_PATTERNS.filter((p) => typeof p.appliesTo === "function");
    expect(scoped).toHaveLength(1);
    expect(scoped[0].name).toContain("10.0");
  });

  it("scans shipped code, config and docs", () => {
    const ip = LEAK_PATTERNS.find((p) => p.name.includes("10.0"));
    for (const rel of ["server.js", "src/lib/sidecar.js", "docs/ZVAULT_RUN.md", "next.config.mjs"]) {
      expect(appliesTo(ip, rel), rel).toBe(true);
    }
  });

  it("skips test fixtures, which the product's own default trusted range forces", () => {
    const ip = LEAK_PATTERNS.find((p) => p.name.includes("10.0"));
    for (const rel of [
      "tests/unit/proxyTrust.test.js",
      "tests/e2e/routing/07-auth.test.mjs",
      "src/lib/routing/engine.test.js",
      ["tests", "unit", "a.test.js"].join("\\"), // Windows separator
    ]) {
      expect(appliesTo(ip, rel), rel).toBe(false);
    }
  });

  it("does not mistake a directory that merely contains 'test' for a test tree", () => {
    for (const rel of ["contest/x.js", "latest/x.js", "src/testimonials/page.js"]) {
      expect(isTestPath(rel), rel).toBe(false);
    }
  });

  it("an unscoped pattern runs everywhere, including tests", () => {
    const unscoped = LEAK_PATTERNS.filter((p) => typeof p.appliesTo !== "function");
    for (const p of unscoped) expect(appliesTo(p, "tests/unit/x.test.js")).toBe(true);
  });
});

describe("the gate looks where the leaks actually were", () => {
  const files = collectFiles().map((f) => path.relative(REPO, f).replace(/\\/g, "/"));

  it("scans the repo root, not just src/ and open-sse/", () => {
    expect(files).toContain("server.js");
    expect(files).toContain("FREE-TIER-FILES-OVERVIEW.txt");
  });

  it("still scans src/ and open-sse/", () => {
    expect(files.some((f) => f.startsWith("src/"))).toBe(true);
    expect(files.some((f) => f.startsWith("open-sse/"))).toBe(true);
  });

  it("does not walk node_modules, .next or community-dist", () => {
    for (const dir of ["node_modules/", ".next/", "community-dist/"]) {
      expect(files.some((f) => f.startsWith(dir)), dir).toBe(false);
    }
  });
});

describe("the files that were carrying a foreign path are clean", () => {
  // Asserted by running the real patterns, not by a substring the test spells
  // out — the same mistake in miniature.
  for (const rel of ["server.js", "FREE-TIER-FILES-OVERVIEW.txt"]) {
    it(`${rel} carries no internal path`, () => {
      const text = fs.readFileSync(path.join(REPO, rel), "utf8");
      for (const p of LEAK_PATTERNS) {
        if (!appliesTo(p, rel)) continue;
        expect(hits(p.re, text), `${rel} matched ${p.name}`).toBe(0);
      }
    });
  }

  it("server.js is still the real entry point, not a stub that was emptied to pass", () => {
    const src = fs.readFileSync(path.join(REPO, "server.js"), "utf8");
    expect(src).toContain("startServer");
    expect(src).toContain("resolveBindHost");
    // The two baked absolute paths now compute the live cwd instead.
    expect(src).toContain('"outputFileTracingRoot":process.cwd()');
    expect(src).toContain('"turbopack":{"root":process.cwd()}');
  });
});

describe("no scanner exempts itself", () => {
  it("the exemption list is empty", () => {
    // Every needle is assembled from fragments at runtime, so no file in the
    // repo contains one contiguously and none needs skipping. A returning
    // entry means someone spelled a needle in full again — and an exempted
    // file is unscanned for everything else too, not just for that needle.
    expect(PATTERN_DEFINING_FILES.size).toBe(0);
  });

  it("the pattern module and both scanners scan clean under their own patterns", () => {
    for (const rel of [
      "scripts/leak-patterns.cjs",
      "secrets-check.cjs",
      "scripts/validate-open-core.cjs",
      "tests/unit/secretsCheckPaths.test.js",
    ]) {
      const text = fs.readFileSync(path.join(REPO, rel), "utf8");
      for (const p of LEAK_PATTERNS) {
        if (!appliesTo(p, rel)) continue;
        expect(hits(p.re, text), `${rel} matched ${p.name}`).toBe(0);
      }
    }
  });

  it("every KNOWN_PREEXISTING entry names a file, a pattern and an owner", () => {
    for (const entry of KNOWN_PREEXISTING) {
      expect(typeof entry.file).toBe("string");
      expect(LEAK_PATTERNS.some((p) => p.name === entry.name), entry.name).toBe(true);
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });

  it("stays small — an allowlist that grows is a gate that has stopped meaning anything", () => {
    expect(KNOWN_PREEXISTING.length).toBeLessThanOrEqual(3);
  });
});
