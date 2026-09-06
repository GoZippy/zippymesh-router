#!/usr/bin/env node
/**
 * validate-open-core.cjs
 *
 * Validates that a tree is safe to publish as open-core. Three checks:
 *
 *   1. Every path in .zippy-private is either absent OR is a stub (when run with
 *      --allow-stubs, which the community build uses).
 *   2. No internal-only paths leaked through (docs/_internal/, debug logs, .env
 *      variants, agent scratchpads, SQLite dumps, etc.).
 *   3. No internal leak-pattern strings (private hostnames, internal IPs, AI
 *      session IDs) in shippable text files.
 *
 * Usage:
 *   node scripts/validate-open-core.cjs               # strict
 *   node scripts/validate-open-core.cjs --allow-stubs # stubs OK for proprietary
 *   node scripts/validate-open-core.cjs --tree=community-dist  # validate a built tree
 *
 * Exit 0 = safe to publish.
 * Exit 1 = at least one violation; do NOT push.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ALLOW_STUBS = process.argv.includes("--allow-stubs");
const TREE_ARG    = process.argv.find((a) => a.startsWith("--tree="));
const ROOT        = TREE_ARG ? path.resolve(TREE_ARG.slice(7)) : process.cwd();

const STUB_MARKER = "OPEN_CORE_STUB";

// ── 1. Proprietary paths — read from .zippy-private (single source of truth) ──
// Falls back to the historical OPEN_CORE_MANIFEST.md list if .zippy-private is absent.
const FALLBACK_PROPRIETARY = [
  "src/lib/discovery/p2pDiscovery.js",
  "src/lib/discovery/gossipDiscovery.js",
  "src/lib/zippycoin-wallet.js",
  "src/lib/trustScore.js",
  "src/lib/wallet-management.js",
  "src/lib/routing/engine.js",
  "src/lib/sidecar.js",
  "open-sse/handlers/chatCore.js",
  "open-sse/translator/index.js",
  "src/app/(dashboard)/dashboard/wallet",
  "src/app/(dashboard)/dashboard/monetization",
  "src/app/(dashboard)/dashboard/network",
];

function loadProprietaryPaths() {
  // Prefer the source repo's .zippy-private (the manifest defines the boundary).
  // When validating a community-dist tree, .zippy-private is excluded from the
  // output by build-community.cjs, so fall back to looking next to this script.
  const candidates = [
    path.join(ROOT, ".zippy-private"),
    path.join(__dirname, "..", ".zippy-private"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/\/$/, ""))
        .filter((l) => l && !l.startsWith("#"));
    }
  }
  return FALLBACK_PROPRIETARY;
}

const PROPRIETARY_PATHS = loadProprietaryPaths();

// ── 2. Internal-only paths that must never reach the open-core tree ───────────
const {
  BUILD_ARTIFACT_DIRS,
  isInternalDirName,
  isInternalRelPath,
  isInternalFileName,
  readScannableText,
  selfTest: exclusionsSelfTest,
} = require("./open-core-exclusions.cjs");

// Same failure mode as a dead leak pattern: a list that no longer covers what
// it claims reports PASS. Prove it before scanning.
exclusionsSelfTest();

// ── 3. Leak-pattern strings that should never appear in shippable text ────────
// Shared with secrets-check.cjs, the PR-time gate. See scripts/leak-patterns.cjs
// for why there is one definition and not two, and for why the needles are
// assembled rather than spelled.
const {
  LEAK_PATTERNS,
  selfTest: leakSelfTest,
  appliesTo: leakAppliesTo,
} = require("./leak-patterns.cjs");

// This gate's failure mode is silence: a pattern that can no longer match prints
// PASS and the push goes out. Prove every pattern still bites before scanning.
leakSelfTest();

// Dirs the leak-scan walker skips entirely. These either get excluded by
// build-community.cjs already, are build-derived, or are vendor/lock.
// Dirs the walker skips outright. BUILD ARTIFACTS AND VENDOR ONLY.
//
// This list used to also name .claude, .cursor, .voidspec, .autoclaw, .kilo,
// plans, archive, sidecar, src-tauri and _internal — every one of them a
// directory the internal-only check exists to catch. Skipping them meant the
// walker could not report them, and the separate root-level path check saw
// only the top of the tree, so the same directory nested one level down was
// invisible to both. Anything internal belongs in open-core-exclusions.cjs, so
// that it is REPORTED here rather than passed over.
const LEAK_SCAN_SKIP_DIRS = new Set(BUILD_ARTIFACT_DIRS);

// ──────────────────────────────────────────────────────────────────────────────
function isDirEntry(rel) { return !path.extname(rel); }
function exists(abs)     { return fs.existsSync(abs); }

let proprietaryViolations = 0;
let internalViolations    = 0;
let leakViolations        = 0;

console.log(`validate-open-core: scanning ${ROOT}`);

// Returns true if any file inside `dir` (recursive) contains STUB_MARKER.
// Used to recognise a stubbed directory (e.g. stubs/community/src/app/.../wallet/page.js).
function dirContainsStubMarker(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return false; }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dirContainsStubMarker(abs)) return true;
    } else if (entry.isFile()) {
      try {
        const content = fs.readFileSync(abs, "utf8");
        if (content.includes(STUB_MARKER)) return true;
      } catch { /* unreadable file — skip */ }
    }
  }
  return false;
}

// Check 1: proprietary paths
for (const rel of PROPRIETARY_PATHS) {
  const abs   = path.join(ROOT, rel);
  const isDir = isDirEntry(rel);
  if (!exists(abs)) continue;

  if (ALLOW_STUBS) {
    if (isDir) {
      // A directory passes when at least one file inside it carries the stub marker.
      // build-community.cjs removes the original dir before copying the stub tree,
      // so the marker is the authoritative signal that the dir is fully stubbed.
      if (dirContainsStubMarker(abs)) {
        console.log(`  [stub]  ${rel}/  (stubbed directory)`);
        continue;
      }
    } else {
      const content = fs.readFileSync(abs, "utf8");
      if (content.includes(STUB_MARKER)) {
        console.log(`  [stub]  ${rel}`);
        continue;
      }
    }
  }

  console.error(`  [FAIL]  ${rel} — proprietary path present in open-core tree`);
  proprietaryViolations++;
}

// Check 2 (internal-only directories and files) runs inside walk() below, so a
// directory is caught wherever it sits rather than only at the tree root.

function walk(dir, relBase = "") {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (LEAK_SCAN_SKIP_DIRS.has(entry.name)) continue;
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isInternalDirName(entry.name) || isInternalRelPath(rel)) {
        console.error(`  [LEAK]  ${rel}/ — internal-only directory present in open-core tree`);
        internalViolations++;
        continue; // do not descend; one finding per directory, not one per file
      }
      walk(abs, rel);
      continue;
    }
    if (!entry.isFile()) continue;

    // file-name check
    if (isInternalFileName(entry.name)) {
      console.error(`  [LEAK]  ${rel} — internal-only filename`);
      internalViolations++;
    }

    // leak-pattern scan (Check 3). Every text file, decided by sniffing the
    // bytes — not by an extension allowlist, which is how a .ps1 carrying a
    // hardcoded checkout path shipped unscanned.
    const content = readScannableText(abs);
    if (content === null) continue;
    for (const pat of LEAK_PATTERNS) {
      if (!leakAppliesTo(pat, rel)) continue;
      pat.re.lastIndex = 0;
      const m = content.match(pat.re);
      if (m) {
        console.error(`  [LEAK]  ${rel} — ${pat.name} (${m.length}× e.g. "${m[0]}")`);
        leakViolations++;
        // No break. A file that carries two different needles used to report
        // only the first, so a scrub-and-rerun loop kept "discovering" the same
        // file and a reader could take one clean-looking line as the whole story.
      }
    }
  }
}

walk(ROOT);

// ── Summary ──────────────────────────────────────────────────────────────────
const total = proprietaryViolations + internalViolations + leakViolations;
console.log();
if (total === 0) {
  console.log("validate-open-core: PASS — no proprietary/internal/leak findings");
  process.exit(0);
}
console.error(`validate-open-core: FAIL — ${proprietaryViolations} proprietary, ${internalViolations} internal-leak, ${leakViolations} leak-pattern violation(s)`);
console.error("Run `npm run build:community` first (it stubs proprietary paths and excludes internal dirs).");
process.exit(1);
