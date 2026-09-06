#!/usr/bin/env node
/**
 * PR-time secret / internal-path gate.
 *
 * Runs as `npm run secrets:check`, which `.github/workflows/secrets-check.yml`
 * fires on every pull request, and which `npm run build` and
 * `npm run build:tauri-frontend` both run before compiling anything.
 *
 * WHAT CHANGED (adversarial review 2026-08-30, items 11 / 16h): this scanned
 * only `src/` and `open-sse/`, with secret-shaped patterns only. The internal
 * *path* patterns — a POSIX home directory, a Windows user profile and two
 * lettered development drives, all belonging to one operator's machines and all
 * defined in `scripts/leak-patterns.cjs` rather than spelled out here — lived
 * exclusively in `scripts/validate-open-core.cjs`, which
 * runs at TAG time against the built `community-dist` tree. So a foreign
 * absolute path could land on the branch and only be noticed during a release —
 * and two files were carrying one: the repo-root `server.js` (twice, in the
 * `nextConfig` snapshot Next baked on someone else's machine) and
 * `FREE-TIER-FILES-OVERVIEW.txt`. Neither is under `src/` or `open-sse/`, so
 * the PR-time gate could never have seen them.
 *
 * Both pattern families now run here, over the repo root as well.
 */

const fs = require("fs");
const path = require("path");

const root = process.cwd();

/** Trees walked recursively. */
const scanDirs = [path.join(root, "src"), path.join(root, "open-sse")];

/**
 * The repo ROOT itself, non-recursively. This is where `server.js`,
 * `run.js`, `next.config.mjs` and the overview .txt files live — outside every
 * recursive tree above, and exactly where a build-tool snapshot bakes a foreign
 * absolute path.
 */
const scanRootFiles = true;

const ignoreDirs = new Set([
  "node_modules", ".next", ".cache", "dist", "build",
  // Build outputs and internal-only trees. `docs/_internal` is excluded from
  // the public build by design and legitimately quotes internal paths when
  // reporting on them (an audit that cannot name the path it found is useless).
  "community-dist", "docs", "tests", ".git",
]);

const suspiciousPatterns = [
  { name: "hardcoded clientSecret", regex: /\bclientSecret\s*:\s*["'`]([^"'`]+)["'`]/g },
  { name: "hardcoded clientSecret assignment", regex: /\bclientSecret\s*=\s*["'`]([^"'`]+)["'`]/g },
  { name: "openai key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "google api key", regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: "gocspx secret", regex: /GOCSPX-[A-Za-z0-9_-]{8,}/g },
];

/**
 * Internal-infrastructure paths and hostnames that must never reach a shippable
 * file. The definition lives in scripts/leak-patterns.cjs and is shared with
 * scripts/validate-open-core.cjs, which gates the public push at tag time.
 *
 * It used to be a second copy here, with a comment promising it was kept
 * identical. It was not: the word-boundary that made the POSIX home pattern
 * unmatchable was removed here and never ported there, so the tag-time gate
 * stayed blind to the path this one had just been fixed to catch. One
 * definition, imported twice, is the only version of that promise a reader can
 * rely on.
 */
const {
  LEAK_PATTERNS,
  selfTest: leakSelfTest,
  appliesTo: leakAppliesTo,
} = require("./scripts/leak-patterns.cjs");

const { readScannableText } = require("./scripts/open-core-exclusions.cjs");

// A dead pattern is worse than no pattern: it reports PASS. Fail here instead.
leakSelfTest();

const pathPatterns = LEAK_PATTERNS.map((p) => ({
  name: p.name,
  regex: p.re,
  appliesTo: p.appliesTo,
}));

const allowedTokens = ["REDACTED_IN_SOURCE", "REDACTED", "PLACEHOLDER", "your-", "${", "process.env"];

/**
 * Files exempted from the path scan because they necessarily CONTAIN a needle.
 *
 * EMPTY, deliberately. scripts/leak-patterns.cjs assembles every needle from
 * inert fragments at runtime, so neither it nor either scanner holds one
 * contiguously and none of them needs skipping. That matters: an exemption is
 * not free. Whatever else lands in an exempted file is unscanned too, and these
 * three are exactly the files a leak would hide in most comfortably.
 *
 * If an entry ever has to come back, that is the signal that someone spelled a
 * needle in full again. Assemble it instead.
 */
const PATTERN_DEFINING_FILES = new Set([]);

/**
 * Known pre-existing findings, reported as a WARNING rather than a failure so
 * that turning this gate on does not break `npm run build` for everyone before
 * the owning change lands.
 *
 * Each entry MUST name a file, the pattern, and who is expected to clear it.
 * Delete an entry the moment its file is clean — an allowlist that outlives its
 * reason is how a gate stops meaning anything.
 */
const KNOWN_PREEXISTING = [
  // Empty: the localModelIndex.js docstring address was moved to the RFC 5737
  // documentation range (192.0.2.10) on 2026-08-30, so no exception is needed.
  // An entry here is a temporary bridge, never a permanent waiver.
];

function isKnownPreexisting(finding) {
  return KNOWN_PREEXISTING.some((k) => k.file === finding.file && k.name === finding.name);
}

// No extension allowlist. This used to be /\.(js|cjs|mjs|ts|tsx|json|md|txt|env|yml|yaml)$/,
// which meant the repo-root `start-interactive.ps1` — carrying one machine's
// hardcoded checkout path — was collected by neither gate. Collect every file
// and let readScannableText() skip the binaries by sniffing their bytes.

/**
 * The set of files git tracks, or null when git is unavailable.
 *
 * WHY. This gate exists to stop a leak reaching the branch, and only a tracked
 * file can. Scanning untracked ones means a contributor's stray runtime log or
 * scratch file fails `npm run build` on their machine for something that was
 * never going to ship — and the reflex fix for a gate that cries wolf is to
 * turn it off. When git cannot answer, scan everything: a noisy gate beats a
 * silent one.
 */
let trackedCache;
function trackedFiles() {
  if (trackedCache !== undefined) return trackedCache;
  try {
    const out = require("child_process").execFileSync(
      "git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const set = new Set(out.split("\0").filter(Boolean));
    trackedCache = set.size ? set : null;
  } catch {
    trackedCache = null;
  }
  return trackedCache;
}

function isTracked(absPath) {
  const set = trackedFiles();
  if (set === null) return true; // git unavailable: scan it rather than skip it
  return set.has(path.relative(root, absPath).replace(/\\/g, "/"));
}

function walkFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isTracked(fullPath)) continue;
    files.push(fullPath);
  }
  return files;
}

/** Files directly in the repo root — no recursion. */
function rootFiles() {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // Dotfiles at the root are config (.env, .gitignore); .env is gitignored
    // and scanning it would report the operator's own secrets back at them.
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(root, entry.name);
    if (!isTracked(abs)) continue;
    files.push(abs);
  }
  return files;
}

function hasAllowedSecret(token) {
  return allowedTokens.some((allowed) => token.includes(allowed));
}

function collectFiles() {
  const files = [];
  for (const rootDir of scanDirs) {
    if (fs.existsSync(rootDir)) files.push(...walkFiles(rootDir));
  }
  if (scanRootFiles) files.push(...rootFiles());
  return files;
}

function scan() {
  const secretFindings = [];
  const pathFindings = [];

  for (const filePath of collectFiles()) {
    const rel = path.relative(root, filePath).replace(/\\/g, "/");
    // Sniffs the bytes: binaries and oversized files are skipped, everything
    // else is scanned whatever its extension.
    const text = readScannableText(filePath);
    if (text === null) continue;

    for (const pattern of suspiciousPatterns) {
      for (const match of text.matchAll(pattern.regex)) {
        const token = match[0];
        if (hasAllowedSecret(token)) continue;
        const line = text.slice(0, match.index).split(/\r?\n/).length;
        secretFindings.push({ file: rel, line, token: token.slice(0, 24), name: pattern.name });
      }
    }

    if (!PATTERN_DEFINING_FILES.has(rel)) {
      for (const pattern of pathPatterns) {
        if (!leakAppliesTo(pattern, rel)) continue;
        for (const match of text.matchAll(pattern.regex)) {
          const line = text.slice(0, match.index).split(/\r?\n/).length;
          pathFindings.push({ file: rel, line, token: match[0], name: pattern.name });
        }
      }
    }
  }

  const knownPath = pathFindings.filter(isKnownPreexisting);
  const newPath = pathFindings.filter((f) => !isKnownPreexisting(f));

  let ok = true;

  if (secretFindings.length) {
    ok = false;
    console.error("[secrets-check] Potential hardcoded secret found in tracked source files.");
    for (const item of secretFindings) {
      console.error(` - ${item.file}:${item.line} (${item.name})`);
    }
  }

  if (knownPath.length) {
    console.warn("[secrets-check] Known pre-existing internal path/host (not blocking — see KNOWN_PREEXISTING):");
    for (const item of knownPath) {
      const entry = KNOWN_PREEXISTING.find((k) => k.file === item.file && k.name === item.name);
      console.warn(` - ${item.file}:${item.line} (${item.name}) -> ${item.token}`);
      if (entry) console.warn(`     ${entry.why}`);
    }
  }

  if (newPath.length) {
    ok = false;
    console.error("[secrets-check] Internal infrastructure path/host found in a shippable file.");
    for (const item of newPath) {
      console.error(` - ${item.file}:${item.line} (${item.name}) -> ${item.token}`);
    }
    console.error(
      "   These leak a developer's machine layout into a repo with an open-core publishing path.\n" +
        "   Replace with a relative path, process.cwd(), or a placeholder."
    );
  }

  return ok;
}

if (require.main === module) {
  if (!scan()) process.exit(1);
}

module.exports = {
  scan,
  collectFiles,
  pathPatterns,
  suspiciousPatterns,
  KNOWN_PREEXISTING,
  PATTERN_DEFINING_FILES,
};
