"use strict";

/**
 * leak-patterns.cjs — the one definition of the internal-infrastructure strings
 * that must never reach a shippable file.
 *
 * WHY ONE FILE. These lived in two copies: scripts/validate-open-core.cjs, which
 * gates the public push at tag time, and secrets-check.cjs, which gates every
 * pull request. A comment in the second promised the two were "kept IDENTICAL in
 * shape". They were not. The word-boundary that made the POSIX home pattern
 * unmatchable was removed from one copy and never ported to the other, so the
 * gate guarding the public push stayed blind to the exact path the other gate
 * had just been fixed to catch. Two copies cannot be held in step by a comment.
 *
 * WHY A SCANNER READS THE WRITTEN FORM, NOT THE PARSED ONE. A Windows path
 * inside a JS or JSON string literal is stored on disk with its backslashes
 * DOUBLED. A pattern written for a single backslash cannot match it. The test
 * that was supposed to cover this fed each pattern the path as PARSED, with one
 * backslash per separator, and passed; the scanner was applying that same
 * pattern to the path as WRITTEN, with two, and missed. Every separator below is
 * therefore a class of one-or-more backslashes or forward slashes, and every
 * fixture appears in BOTH forms. (Neither form is spelled out anywhere in this
 * file, for the reason given in the next paragraph.)
 *
 * WHY THE NEEDLES ARE ASSEMBLED AT RUNTIME. A pattern file that spells its own
 * needles in full must be exempted from every scan, and an exemption is a hole:
 * whatever else lands in that file goes unscanned with it. Assembling each
 * needle from inert fragments means this module, both scanners and the fixtures
 * all scan clean, no exemption is required, and the published community tree
 * stops carrying the identifiers at all.
 *
 * Run the self-test alone:  node scripts/leak-patterns.cjs --self-test
 */

// ── needles ──────────────────────────────────────────────────────────────────
const POSIX_USER = "sys" + "op";
const WIN_USER = "got" + "ad";
const DEV_DRIVES = ["k", "s"];

// Regex source fragments.
const SEP = "[\\\\/]+"; // one or more backslashes or forward slashes
const END = "(?![\\w-])"; // not followed by another name character

/**
 * True for a path under a test tree, or a test/spec file anywhere.
 * Accepts either separator: callers pass a repo-relative path, and on Windows
 * that arrives with backslashes.
 */
function isTestPath(rel) {
  const r = String(rel).replace(/\\/g, "/");
  return /(^|\/)(tests?|__tests__|e2e)\//i.test(r) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(r);
}

const LEAK_PATTERNS = [
  // 10.0.x.x but never CIDR notation: an RFC1918 range in a trusted-LAN
  // allowlist is public knowledge, not a leak.
  //
  // SCOPED OUT OF TESTS, deliberately, and this is the one pattern that is.
  // The product ships `trustedLanCidrs` defaulting to 10.0.0.0/16, so a test
  // that exercises the default trusted-proxy path has to present an address
  // inside that range — the pattern is not satisfiable there. Every occurrence
  // this pattern found under tests/ was such a fixture, and those files already
  // use the RFC5737 documentation range (203.0.113.x) for the public addresses
  // they are contrasted against, so the choice was deliberate, not sloppy.
  //
  // What the pattern is actually for is an address baked into shipped runtime
  // code, config or docs, which means someone's machine leaked into the tree.
  // That is where it still runs, unchanged.
  //
  // Note the limit of this pattern in either scope: RFC1918 addresses are not
  // routable and one network's 10.0.x.x is indistinguishable from another's.
  // It catches a machine-specific value landing somewhere it should not; it is
  // not evidence that any particular address is sensitive.
  {
    name: "internal IP (10.0.x.x)",
    re: /\b10\.0\.\d{1,3}\.\d{1,3}(?!\/\d)\b/g,
    appliesTo: (rel) => !isTestPath(rel),
  },
  { name: "internal hostname (clawNNN)", re: /\bclaw\d{3}\b/g },
  {
    name: "internal user path (POSIX home)",
    re: new RegExp(SEP + "home" + SEP + POSIX_USER + END, "g"),
  },
  {
    name: "internal user path (Windows Users)",
    re: new RegExp("C:" + SEP + "Users" + SEP + WIN_USER + END, "gi"),
  },
  ...DEV_DRIVES.map((d) => ({
    name: "internal dev path (" + d.toUpperCase() + " drive Projects)",
    re: new RegExp("\\b" + d + ":" + SEP + "Projects" + SEP, "gi"),
  })),
];

// ── fixtures ─────────────────────────────────────────────────────────────────
const B = "\\"; // one backslash, as prose and YAML store it
const BB = B + B; // two, as a JS or JSON string literal stores it
const IP = "10.0." + "11.2"; // assembled: see the needles note above
const HOST = "claw" + "042";

/** Every pattern's positives, in both the prose form and the written-literal form. */
function positives() {
  const home = "/home/" + POSIX_USER;
  const out = {
    "internal IP (10.0.x.x)": ["host " + IP + " answers", "http://" + IP + ":11434"],
    "internal hostname (clawNNN)": [HOST, "node " + HOST + " is down"],
    "internal user path (POSIX home)": [
      "cd " + home + "/projects && npm run build",
      '{"outputFileTracingRoot":"' + home + '/projects/x"}',
      '{"root":"' + home.replace(/\//g, B + "/") + '/x"}', // JSON with escaped slashes
    ],
    "internal user path (Windows Users)": [
      "see C:" + B + "Users" + B + WIN_USER + B + "Projects",
      'const p = "C:' + BB + "Users" + BB + WIN_USER + BB + 'Projects";',
    ],
  };
  for (const d of DEV_DRIVES) {
    out["internal dev path (" + d.toUpperCase() + " drive Projects)"] = [
      d.toUpperCase() + ":" + B + "Projects" + B + "ZippyMesh",
      '"cwd": "' + d + ":" + BB + "Projects" + BB + 'ZippyMesh"',
    ];
  }
  return out;
}

/** Strings no pattern may match. Each one is a false positive someone would have to live with. */
function negatives() {
  return [
    "allow 10.0.0.0/8",
    "10.0.0.0/16",
    "/home/" + POSIX_USER + "ian/notes", // longer name, not the account
    "disk:" + B + "Projects" + B, // drive letter must stand alone
    "C:" + B + "Users" + B + WIN_USER + "ski", // longer name again
  ];
}

/**
 * Whether `pattern` should run against the repo-relative path `rel`.
 * A pattern with no `appliesTo` runs everywhere; that is the default and every
 * pattern but one uses it.
 */
function appliesTo(pattern, rel) {
  return typeof pattern.appliesTo !== "function" || pattern.appliesTo(rel);
}

/**
 * Throws unless every pattern matches every one of its positives and no pattern
 * matches any negative. Both scanners call this before they scan, so a pattern
 * that has gone dead fails the gate loudly instead of passing it silently.
 */
function selfTest() {
  const pos = positives();
  const failures = [];
  for (const p of LEAK_PATTERNS) {
    const cases = pos[p.name];
    if (!cases || cases.length === 0) {
      failures.push(`pattern "${p.name}" has no fixture — add one before it can be trusted`);
      continue;
    }
    for (const text of cases) {
      p.re.lastIndex = 0;
      if (!p.re.test(text)) failures.push(`pattern "${p.name}" did not match its own fixture`);
    }
  }
  for (const text of negatives()) {
    for (const p of LEAK_PATTERNS) {
      p.re.lastIndex = 0;
      if (p.re.test(text)) failures.push(`pattern "${p.name}" matched a string it must not`);
    }
  }
  // A scope predicate is a hole if it is wider than it claims. Pin both edges.
  const inScope = ["src/lib/sidecar.js", "docs/ZVAULT_RUN.md", "server.js", "next.config.mjs"];
  const outOfScope = [
    "tests/unit/proxyTrust.test.js",
    "tests/e2e/routing/07-auth.test.mjs",
    "tests" + B + "unit" + B + "proxyTrust.test.js", // Windows separator
    "src/lib/routing/engine.test.js",
  ];
  for (const p of LEAK_PATTERNS) {
    if (typeof p.appliesTo !== "function") continue;
    for (const rel of inScope) {
      if (!p.appliesTo(rel)) failures.push(`pattern "${p.name}" skips ${rel}, which it must scan`);
    }
    for (const rel of outOfScope) {
      if (p.appliesTo(rel)) failures.push(`pattern "${p.name}" scans ${rel}, which is out of its scope`);
    }
  }

  if (failures.length) {
    throw new Error("leak-patterns self-test FAILED:\n  - " + failures.join("\n  - "));
  }
  return LEAK_PATTERNS.length;
}

module.exports = { LEAK_PATTERNS, selfTest, positives, negatives, isTestPath, appliesTo };

if (require.main === module) {
  const n = selfTest();
  console.log(`leak-patterns: self-test PASS — ${n} patterns, all fixtures matched`);
}
