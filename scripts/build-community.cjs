#!/usr/bin/env node
/**
 * build-community.cjs — Windows-compatible community edition builder
 * Replaces build-community.sh (which requires rsync, unavailable on Windows).
 *
 * 1. Reads .zippy-private for the list of proprietary paths
 * 2. Copies source tree to community-dist/ (excluding private dirs)
 * 3. Replaces proprietary files with stubs/community/ equivalents
 * 4. Strips internal config from .env.example
 * 5. npm install + build:next to verify it compiles
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT        = path.resolve(__dirname, "..");
const PRIVATE_LIST = path.join(ROOT, ".zippy-private");
const STUBS_DIR   = path.join(ROOT, "stubs", "community");
const DIST_DIR    = path.join(ROOT, "community-dist");

const CYAN   = "\x1b[36m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const NC     = "\x1b[0m";

const info    = (...a) => console.log(`${CYAN}[community-build]${NC}`, ...a);
const success = (...a) => console.log(`${GREEN}[community-build]${NC}`, ...a);
const warn    = (...a) => console.log(`${YELLOW}[community-build] WARN:${NC}`, ...a);
const error   = (...a) => { console.error(`${RED}[community-build] ERROR:${NC}`, ...a); process.exit(1); };

// ── Preflight ─────────────────────────────────────────────────────────────────
if (!fs.existsSync(PRIVATE_LIST)) error(".zippy-private not found at", ROOT);
if (!fs.existsSync(STUBS_DIR))    error("stubs/community/ not found");

info("Starting Community Edition build...");
info("Repo:   ", ROOT);
info("Stubs:  ", STUBS_DIR);
info("Output: ", DIST_DIR);

// ── Helpers ──────────────────────────────────────────────────────────────────
// Directory names that must never be copied into community-dist. Anything internal,
// user-runtime, build-artifact, agent-scratchpad, or IDE-state goes here.
const {
  INTERNAL_DIR_NAMES,
  BUILD_ARTIFACT_DIRS,
  INTERNAL_REL_PATHS,
  INTERNAL_FILE_REGEXES,
  selfTest: exclusionsSelfTest,
} = require("./open-core-exclusions.cjs");

// A list that has silently stopped covering something builds a payload that
// looks clean. Prove the rules still hold before copying anything.
exclusionsSelfTest();

// Internal material plus build output. The two are kept apart in the shared
// module because the validator must fail on the first and ignore the second.
const EXCLUDE_DIRS = new Set([...INTERNAL_DIR_NAMES, ...BUILD_ARTIFACT_DIRS]);

const EXCLUDE_PATHS = new Set(INTERNAL_REL_PATHS.map((r) => path.join(...r.split("/"))));

const EXCLUDE_FILE_PATTERNS = INTERNAL_FILE_REGEXES;

function isExcluded(relPath, basename, isDirectory) {
  if (EXCLUDE_DIRS.has(basename)) return true;
  if (EXCLUDE_PATHS.has(relPath)) return true;
  if (!isDirectory) {
    for (const re of EXCLUDE_FILE_PATTERNS) if (re.test(basename)) return true;
  }
  return false;
}

function copyDir(src, dest, relBase = "") {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (isExcluded(rel, entry.name, entry.isDirectory())) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d, rel);
    } else if (entry.isSymbolicLink()) {
      // skip symlinks (data junction, etc.)
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function removeDir(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

// ── Step 1: Copy source tree ─────────────────────────────────────────────────
info("Copying source tree to community-dist...");
removeDir(DIST_DIR);
copyDir(ROOT, DIST_DIR);
info("  Copy complete.");

// ── Step 2: Replace proprietary paths with stubs ─────────────────────────────
const lines = fs.readFileSync(PRIVATE_LIST, "utf8").split(/\r?\n/);
let replaced = 0;
let missing  = 0;

for (const raw of lines) {
  const entry = raw.trim().replace(/\/$/, "");
  if (!entry || entry.startsWith("#")) continue;

  const srcPath  = path.join(DIST_DIR, entry);
  const stubPath = path.join(STUBS_DIR, entry);

  const stubIsDir  = fs.existsSync(stubPath) && fs.statSync(stubPath).isDirectory();
  const stubIsFile = fs.existsSync(stubPath) && fs.statSync(stubPath).isFile();

  if (stubIsDir) {
    if (fs.existsSync(srcPath)) {
      info("  Replacing directory:", entry);
      removeDir(srcPath);
      copyDir(stubPath, srcPath);
      replaced++;
    } else {
      warn("  Source directory not found (skipping):", entry);
    }
  } else if (stubIsFile) {
    if (fs.existsSync(srcPath)) {
      info("  Replacing file:", entry);
      fs.copyFileSync(stubPath, srcPath);
      replaced++;
    } else {
      warn("  Source file not found (skipping):", entry);
    }
  } else {
    warn("  No stub found for:", entry, `(expected at ${stubPath})`);
    missing++;
  }
}

success(`Replaced ${replaced} proprietary path(s) with community stubs`);
if (missing > 0) warn(`${missing} stub(s) missing — community build may be incomplete`);

// ── Step 3: Strip internal config from .env.example ─────────────────────────
info("Stripping internal configuration...");
const envExamplePath = path.join(DIST_DIR, ".env.example");
if (fs.existsSync(envExamplePath)) {
  const STRIP = /ZIPPY_CHAIN_RPC|ZIPPY_NODE_URL|ZIPPY_BEACON|ZIPPYCOIN|P2P_/;
  const cleaned = fs.readFileSync(envExamplePath, "utf8")
    .split(/\r?\n/)
    .filter(line => !STRIP.test(line))
    .join("\n");
  fs.writeFileSync(envExamplePath, cleaned + "\n\n# Community Edition\nZIPPYMESH_EDITION=community\n");
  info("  Cleaned .env.example");
}

// ── Step 4: npm install + build ──────────────────────────────────────────────
info("Installing dependencies in community-dist...");
try {
  execSync("npm install --prefer-offline", { cwd: DIST_DIR, stdio: "inherit" });
} catch {
  error("npm install failed in community-dist");
}

info("Building Next.js app...");
const env = { ...process.env, JWT_SECRET: process.env.JWT_SECRET || "build-time-placeholder-not-used-at-runtime" };
try {
  execSync("npm run build:next", { cwd: DIST_DIR, stdio: "inherit", env });
} catch {
  error("Next.js build failed — community edition has a compilation error");
}

// ── Step 5: Summary ──────────────────────────────────────────────────────────
console.log();
success("Community Edition build complete!");
success("Output directory:", DIST_DIR);
console.log();
console.log(`  ${CYAN}Next steps:${NC}`);
console.log("  1. Test:    cd community-dist && npm start");
console.log("  2. Verify:  curl http://localhost:20128/api/health");
console.log("  3. Publish: push community-dist/ to the public 'community' branch");
