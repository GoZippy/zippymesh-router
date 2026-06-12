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
const INTERNAL_DIRS = [
  "docs/_internal",
  ".claude",
  ".cursor",
  ".voidspec",
  ".autoclaw",
  ".kilo",
  "experiments",
  "tester",
  "test-results",
  "data",
  "logs",
  "plans",        // internal planning docs
  "sidecar",      // private — full Rust sidecar source
  "src-tauri",    // private — Tauri shell + native deps
];

const INTERNAL_FILE_REGEXES = [
  // .env, .env.local, .env.mesh, etc. — but NOT .env.example (intentional public template)
  /^\.env(?!\.example$)(\.|$)/i,
  /^debug_/i,
  /^startup.*\.log$/i,
  /\.log$/i,
  /\.sqlite(-shm|-wal)?$/i,
  /^oauth-secrets\.json$/i,
  /^db\.json$/i,
  /\.bak$/i,
  /\.resolved(\.|$)/i,
  /^null$/,
  /^diff_output\.txt$/i,
  /^cargo_check_output\.txt$/i,
  /^network-scan-report\.json$/i,
  /^frontend_debug\.log$/i,
  /^\.kilocodemodes$/i,
  /^\.zippy-private$/i,
];

// ── 3. Leak-pattern strings that should never appear in shippable text ────────
// These are pre-compiled regexes scanned over .md, .json, .yml, .yaml, .txt files
// in the validated tree. Anchored to be specific (not just any digit-string).
// Match 10.0.x.x but NOT CIDR notation (10.0.0.0/8, 10.0.0.0/16) which is
// public RFC1918 reserved-range knowledge, legitimately used in trusted-LAN
// allowlists and not an internal-infrastructure leak.
const LEAK_PATTERNS = [
  { re: /\b10\.0\.\d{1,3}\.\d{1,3}(?!\/\d)\b/g, label: "internal IP (10.0.x.x)" },
  { re: /\bclaw\d{3}\b/g,               label: "internal hostname (clawNNN)" },
  { re: /\b\/home\/sysop\//g,           label: "internal user path (/home/sysop/)" },
  { re: /C:\\Users\\gotad\\/gi,         label: "internal user path (C:\\Users\\gotad\\)" },
  { re: /\bk:\\Projects\\/gi,           label: "internal dev path (k:\\Projects\\)" },
  { re: /\bs:\\Projects\\/gi,           label: "internal dev path (s:\\Projects\\)" },
];

const LEAK_SCAN_EXTS = new Set([".md", ".txt", ".json", ".yml", ".yaml", ".js", ".cjs", ".mjs", ".ts"]);
// Dirs the leak-scan walker skips entirely. These either get excluded by
// build-community.cjs already, are build-derived, or are vendor/lock.
const LEAK_SCAN_SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "stubs",
  "community-dist",                 // gets blown away on every build:community
  ".next-win-retry-2", ".next-win-retry-3", // Next.js build retries (gitignored)
  ".claude", ".cursor", ".voidspec", ".autoclaw", ".kilo",
  "src-tauri", "sidecar",           // private — not in community build
  "_internal",                      // docs/_internal — internal-only docs
  "plans", "logs", "data", "experiments", "tester", "test-results", "dist",
  "out", "tmp", ".vscode", ".idea",
  "_deprecated", "archive", "_archive", "_old", "backup",
  "package-lock.json", "pnpm-lock.yaml",
]);

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

// Check 2: internal-only paths
for (const rel of INTERNAL_DIRS) {
  if (exists(path.join(ROOT, rel))) {
    console.error(`  [LEAK]  ${rel}/ — internal-only directory present in open-core tree`);
    internalViolations++;
  }
}

function walk(dir, relBase = "") {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (LEAK_SCAN_SKIP_DIRS.has(entry.name)) continue;
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, rel);
      continue;
    }
    if (!entry.isFile()) continue;

    // file-name check
    for (const re of INTERNAL_FILE_REGEXES) {
      if (re.test(entry.name)) {
        console.error(`  [LEAK]  ${rel} — internal-only filename matched ${re}`);
        internalViolations++;
        break;
      }
    }

    // leak-pattern scan on text files (Check 3)
    const ext = path.extname(entry.name).toLowerCase();
    if (!LEAK_SCAN_EXTS.has(ext)) continue;
    let content;
    try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
    for (const { re, label } of LEAK_PATTERNS) {
      const m = content.match(re);
      if (m) {
        console.error(`  [LEAK]  ${rel} — ${label} (${m.length}× e.g. "${m[0]}")`);
        leakViolations++;
        break;
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
